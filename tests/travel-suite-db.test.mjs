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
