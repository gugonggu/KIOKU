import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";

let db;
before(async () => { db = await createTripsDatabase(); });
after(async () => { await db?.close(); });

test("checklists support idempotent templates and isolate both reads and mutations", async () => {
  const trip = randomUUID();
  await asUser(db, ownerA, async (tx) => {
    await tx.query("insert into public.trips(id,title,destination_label) values ($1,'Fixture','Japan')", [trip]);
    const template = [{ source: "japan-0", category: "entry", title: "Fixture item" }];
    for (let count = 0; count < 2; count++) {
      await tx.query("select public.apply_preparation_template($1,$2)", [trip, JSON.stringify(template)]);
    }
    const { rows } = await tx.query("select id,done from public.trip_preparation where trip_id=$1", [trip]);
    assert.equal(rows.length, 1);
    await tx.query("update public.trip_preparation set done=true where id=$1", [rows[0].id]);
  });
  await asUser(db, ownerB, async (tx) => {
    assert.equal((await tx.query("select id from public.trip_preparation where trip_id=$1", [trip])).rows.length, 0);
    assert.equal((await tx.query("delete from public.trip_preparation where trip_id=$1 returning id", [trip])).rows.length, 0);
  });
  await assert.rejects(asUser(db, null, (tx) => tx.query("select id from public.trip_preparation")), { code: "42501" });
});

test("budgets isolate owners, guard amount and participants, and prevent cross-trip or duplicate bookings", async () => {
  const trip = randomUUID();
  const other = randomUUID();
  const booking = randomUUID();
  const otherBooking = randomUUID();
  const expense = randomUUID();
  await asUser(db, ownerA, async (tx) => {
    await tx.query("insert into public.trips(id,title,destination_label) values ($1,'Fixture','Japan'),($2,'Second','Japan')", [trip, other]);
    await tx.query("select public.save_trip_budget($1,500000,91234,array['A','B','C'])", [trip]);
  });
  await db.query("insert into public.bookings(id,trip_id,title,kind,status) values ($1,$2,'Stay','STAY','CONFIRMED'),($3,$4,'Other','STAY','CONFIRMED')", [booking, trip, otherBooking, other]);
  const insert = (id, reference, refund = 0, shares = [1, 2, 3]) => asUser(db, ownerA, (tx) =>
    tx.query("insert into public.trip_expenses(id,trip_id,title,amount,refund,currency,rate,spent_on,category,payer,shares,prepaid,booking_id)" +
      " values ($1,$2,'Expense',300000,$3,'KRW',10000,'2027-02-17','stay',1,$4,true,$5)", [id, trip, refund, shares, reference]));
  await assert.rejects(insert(randomUUID(), otherBooking), { code: "23503" });
  await assert.rejects(insert(randomUUID(), booking, 300001), { code: "23514" });
  await assert.rejects(insert(randomUUID(), booking, 0, [1, 1]), { code: "23514" });
  await assert.rejects(insert(randomUUID(), booking, 0, [4]), { code: "23514" });
  await insert(expense, booking);
  await assert.rejects(insert(randomUUID(), booking), { code: "23505" });
  await assert.rejects(asUser(db, ownerA, (tx) => tx.query("select public.save_trip_budget($1,500000,90000,array['A','B'])", [trip])), { code: "23514" });
  await assert.rejects(asUser(db, ownerA, (tx) => tx.query("select public.save_trip_budget($1,500000,90000,array['B','A','C'])", [trip])), { code: "23514" });
  await assert.rejects(asUser(db, ownerA, (tx) => tx.query("update public.trip_budgets set people=array['New A','B','C'] where trip_id=$1", [trip])), { code: "23514" });
  await asUser(db, ownerA, async (tx) => {
    await tx.query("select public.save_trip_budget($1,450000,90000,array['A','B','C','D'])", [trip]);
    const { rows } = await tx.query("select people,payer,shares from public.trip_budgets join public.trip_expenses using (trip_id) where trip_id=$1", [trip]);
    assert.deepEqual(rows, [{ people: ["A", "B", "C", "D"], payer: 1, shares: [1, 2, 3] }]);
  });
  await asUser(db, ownerB, async (tx) => {
    assert.equal((await tx.query("select * from public.trip_budgets where trip_id=$1", [trip])).rows.length, 0);
    assert.equal((await tx.query("delete from public.trip_expenses where trip_id=$1 returning id", [trip])).rows.length, 0);
  });
  await assert.rejects(asUser(db, null, (tx) => tx.query("select id from public.trip_expenses")), { code: "42501" });
  await db.query("delete from public.bookings where id=$1", [booking]);
  const { rows } = await asUser(db, ownerA, (tx) => tx.query("select booking_id,amount,revision from public.trip_expenses where id=$1", [expense]));
  assert.deepEqual(rows, [{ booking_id: null, amount: 300000, revision: 2 }]);
});
