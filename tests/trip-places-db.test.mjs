import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";

const database = await createTripsDatabase();
test.after(() => database.close());
const trip = async (actor = ownerA) => asUser(database, actor, async (tx) => (await tx.query(
  "insert into public.trips (title,destination_label) values ('Test itinerary','Japan') returning id",
)).rows[0].id);

test("M3 migration preserves a pre-existing place, memo and itinerary reference", async () => {
  const priorTrip = randomUUID();
  const priorPlace = randomUUID();
  const migrated = await createTripsDatabase({ async beforeMigration(db, file) {
    if (!file.endsWith("_complete_trip_places.sql")) return;
    await asUser(db, ownerA, async (tx) => {
      await tx.query("insert into public.trips (id,title,destination_label) values ($1,'Example','Japan')", [priorTrip]);
      await tx.query("insert into public.trip_places (id,trip_id,name,address,notes) values ($1,$2,'Old name','Old address','Old note')", [priorPlace,priorTrip]);
      await tx.query("insert into public.itinerary_items (trip_id,title,place_id) values ($1,'Visit',$2)", [priorTrip,priorPlace]);
    });
  } });
  try {
    await asUser(migrated, ownerA, async (tx) => {
      assert.deepEqual((await tx.query("select id,display_name,address_text,notes,provider from public.trip_places where id=$1", [priorPlace])).rows, [{
        id:priorPlace, display_name:"Old name", address_text:"Old address", notes:"Old note", provider:"MANUAL",
      }]);
      assert.equal((await tx.query("select place_id from public.itinerary_items where trip_id=$1", [priorTrip])).rows[0].place_id, priorPlace);
    });
  } finally { await migrated.close(); }
});

test("M3 place mutations enforce ownership, duplicate confirmation, stale edits and coordinates", async () => {
  const own = await trip();
  const first = randomUUID();
  const second = randomUUID();
  const fields = { display_name:"Test Sapporo", address_text:"Example address", name_ja:"札幌", latitude:43, longitude:141, provider:"MANUAL" };
  const save = (id, version, input = fields, confirm = null, actor = ownerA) => asUser(database, actor, async (tx) => (await tx.query(
    "select public.save_trip_place($1,$2,$3,$4,$5) as result", [own,id,version,input,confirm],
  )).rows[0].result);
  assert.equal((await save(first,null)).status,"saved");
  assert.equal((await save(first,null)).status,"existing");
  assert.deepEqual(await save(second,null), { status:"duplicate", id:first });
  assert.equal((await save(second,null,fields,first)).status,"saved");
  assert.equal((await save(first,1,{ ...fields, notes:"Updated" })).status,"saved");
  assert.equal((await save(first,1)).status,"changed");
  assert.equal((await save(first,2,fields,null,ownerB)).status,"changed");
  await assert.rejects(save(randomUUID(),null,{ ...fields, latitude:120 }), { code:"23514" });
  await assert.rejects(save(randomUUID(),null,{ ...fields, display_name:"Invalid provider metadata", provider:"GEOAPIFY" }), { code:"23514" });
  assert.equal((await save(randomUUID(),null,{ ...fields, display_name:"Provider result", provider:"GEOAPIFY", provider_place_id:"fixture-jp" })).status,"saved");
  await assert.rejects(asUser(database,null,(tx) => tx.query("select * from public.trip_places")), { code:"42501" });
  assert.equal((await asUser(database,ownerB,(tx) => tx.query("select id from public.trip_places where id=$1",[first]))).rows.length,0);
});

test("M3 deletion rechecks the impact and unlinks repeated visits without deleting schedules", async () => {
  const own = await trip();
  const elsewhere = await trip();
  const place = await asUser(database, ownerA, async (tx) => (await tx.query(
    "insert into public.trip_places (trip_id,display_name) values ($1,'Test place') returning id", [own],
  )).rows[0].id);
  await assert.rejects(asUser(database,ownerA,(tx) => tx.query(
    "insert into public.itinerary_items (trip_id,title,place_id) values ($1,'Other trip',$2)", [elsewhere,place],
  )), { code:"23503" });
  await asUser(database,ownerA,(tx) => tx.query(
    "insert into public.itinerary_items (trip_id,title,place_id,private_note) values ($1,'Visit one',$2,'Note'),($1,'Visit two',$2,'Note')", [own,place],
  ));
  const remove = (count, actor = ownerA) => asUser(database, actor, async (tx) => (await tx.query(
    "select public.delete_trip_place($1,$2,1,$3) as result", [own,place,count],
  )).rows[0].result);
  assert.equal((await remove(2,ownerB)).status,"changed");
  assert.deepEqual(await remove(1), { status:"preview", count:2 });
  const { rows: links } = await database.query("select place_id from public.itinerary_items where trip_id=$1 order by title", [own]);
  assert.deepEqual(links,[{ place_id:place },{ place_id:place }]);
  assert.equal((await remove(2)).status,"deleted");
  const { rows } = await database.query("select title,place_id,private_note,revision from public.itinerary_items where trip_id=$1 order by title", [own]);
  assert.deepEqual(rows,[
    { title:"Visit one",place_id:null,private_note:"Note",revision:2 },
    { title:"Visit two",place_id:null,private_note:"Note",revision:2 },
  ]);
});

test("M3 search counters enforce owner scope and a shared server cap", async () => {
  const own = await trip();
  const other = await trip(ownerB);
  const authorize = (id, owner, anonymous = false) => asUser(database, owner, async (tx) => (await tx.query(
    "select public.authorize_place_search($1) as allowed", [id],
  )).rows[0].allowed, anonymous);
  assert.equal(await authorize(own,ownerB),false);
  assert.equal(await authorize(own,ownerA,true),false);
  await assert.rejects(authorize(own,null), { code:"42501" });
  const { rows } = await asUser(database,ownerA,(tx) => tx.query(
    "select public.authorize_place_search($1) as allowed from generate_series(1,11)", [own],
  ));
  assert.equal(rows.filter((row) => row.allowed).length,10);
  await database.exec("update kioku_private.place_search_budget set calls=100 where scope='project'");
  assert.equal(await authorize(other,ownerB),false);
  await assert.rejects(asUser(database,ownerA,(tx) => tx.query("select * from kioku_private.place_search_budget")), { code:"42501" });
});
