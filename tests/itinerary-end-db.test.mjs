import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";

const legacyTrip = randomUUID(), legacyItem = randomUUID(), legacyPlace = randomUUID(), legacyBooking = randomUUID();
const db = await createTripsDatabase({ beforeMigration: async (database, file) => {
  if (file !== "20261126000750_itinerary_end_time.sql") return;
  await asUser(database,ownerA,async tx => {
    await tx.query("insert into public.trips(id,title,destination_label) values ($1,'Legacy fixture','Tokyo')",[legacyTrip]);
    await tx.query("insert into public.trip_places(id,trip_id,display_name) values ($1,$2,'Legacy park')", [legacyPlace, legacyTrip]);
    await tx.query("select public.save_booking($1,$2,null,$3)", [legacyTrip, legacyBooking, {
      kind: "STAY", title: "Legacy stay", status: "CONFIRMED", detail: { check_in_local_date: "2027-02-17" },
      private: { amount: 11000, currency: "JPY" },
    }]);
    await tx.query("insert into public.itinerary_items(id,trip_id,title,local_date,time_mode,fixed_local_time,place_id,booking_id) values ($1,$2,'Legacy walk','2027-02-17','FIXED','09:00',$3,$4)", [legacyItem,legacyTrip,legacyPlace,legacyBooking]);
    await tx.query("select public.save_trip_budget($1,500000,91234,array['A','B'])", [legacyTrip]);
    await tx.query("insert into public.trip_expenses(id,trip_id,title,amount,refund,currency,rate,spent_on,category,payer,shares,prepaid,booking_id) values ($1,$2,'Legacy expense',11000,100,'JPY',91234,'2027-02-17','stay',1,array[1,2],true,$3)", [randomUUID(),legacyTrip,legacyBooking]);
  });
}});
test.after(() => db.close());
test("v1.0 data survives incremental migrations without an invented end time", async () => {
  await asUser(db, ownerA, async tx => {
    const { rows } = await tx.query("select i.title,i.fixed_local_time::text,i.end_local_time::text,p.display_name,b.amount::float8,b.currency from public.itinerary_items i join public.trip_places p on p.id=i.place_id join public.booking_private_details b on b.booking_id=i.booking_id where i.id=$1", [legacyItem]);
    assert.deepEqual(rows, [{title:"Legacy walk",fixed_local_time:"09:00:00",end_local_time:null,display_name:"Legacy park",amount:11000,currency:"JPY"}]);
    const ledger = await tx.query("select e.amount,e.refund,e.rate,e.payer,e.shares,e.booking_id,b.budget_krw,b.people from public.trip_expenses e join public.trip_budgets b using(trip_id) where trip_id=$1", [legacyTrip]);
    assert.deepEqual(ledger.rows, [{amount:11000,refund:100,rate:91234,payer:1,shares:[1,2],booking_id:legacyBooking,budget_krw:500000,people:["A","B"]}]);
  });
});
test("end time survives legacy writes, move, archive and restore with owner isolation", async () => {
  const trip = randomUUID(), item = randomUUID();
  await asUser(db, ownerA, tx => tx.query("insert into public.trips(id,title,destination_label) values ($1,'Fixture','Tokyo')", [trip]));
  const fields = { title: "Walk", kind: "NOTE", time_mode: "FIXED", local_date: "2027-02-17", fixed_local_time: "09:00", end_local_time: "10:30", period: null };
  const save = (user, revision, input) => asUser(db, user, tx => tx.query("select public.save_itinerary_item($1,$2,$3,(select content_version from public.trips where id=$1),$4) value", [trip,item,revision,input]));
  const read = () => asUser(db, ownerA, tx => tx.query("select end_local_time::text,revision from public.itinerary_items where id=$1", [item]).then(r => r.rows[0]));
  assert.equal((await save(ownerA, null, fields)).rows[0].value, "saved");
  assert.equal((await read()).end_local_time, "10:30:00");
  const legacy = { ...fields };
  delete legacy.end_local_time;
  await save(ownerA, (await read()).revision, legacy);
  assert.equal((await read()).end_local_time, "10:30:00");
  assert.equal((await save(ownerB, (await read()).revision, fields)).rows[0].value, "changed");
  for (const [command, date, expected] of [["move","2027-02-18","10:30:00"],["archive",null,null],["restore",null,"10:30:00"]]) {
    const revision = (await read()).revision;
    await asUser(db, ownerA, tx => tx.query("select public.place_itinerary_item($1,$2,$3,$4,$5,(select content_version from public.trips where id=$1))", [trip,item,revision,command,date]));
    assert.equal((await read()).end_local_time, expected);
  }
  await assert.rejects(save(ownerA,(await read()).revision,{...fields,end_local_time:"08:00"}));
  await save(ownerA,(await read()).revision,{...fields,end_local_time:null});
  assert.equal((await read()).end_local_time,null);
});

test("import persists end times and preserves the old duplicate key; share exposes only safe timing", async () => {
  const trip = randomUUID();
  await asUser(db,ownerA,tx => tx.query("insert into public.trips(id,title,destination_label) values ($1,'Fixture','Tokyo')",[trip]));
  const rows = [{title:"Park",local_date:"2027-02-17",time_mode:"FIXED",fixed_local_time:"10:00",end_local_time:"11:15",period:null}];
  const run = (input) => asUser(db,ownerA,tx => tx.query("select public.import_trip_schedule($1,(select content_version from public.trips where id=$1),$2) value",[trip,JSON.stringify(input)]));
  assert.deepEqual((await run(rows)).rows[0].value,{inserted:1,skipped:0});
  assert.deepEqual((await run([{...rows[0],end_local_time:"11:45"}])).rows[0].value,{inserted:0,skipped:1});
  await assert.rejects(run([{...rows[0],title:"Bad",end_local_time:"09:00"}]));
  const payload = (await db.query("select kioku_private.shared_trip_payload($1,true,true) value",[trip])).rows[0].value;
  assert.equal(payload.schedule[0].end_local_time,"11:15:00");
  assert.equal(payload.schedule[0].private_note,undefined);
  await assert.rejects(asUser(db,null,tx=>tx.query("select end_local_time from public.itinerary_items")),{code:"42501"});
});
