import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";

let db;
before(async () => { db = await createTripsDatabase(); });
after(async () => { await db?.close(); });

async function trip(user) {
  const id = randomUUID();
  await asUser(db, user, (tx) => tx.query("insert into public.trips (id,title,destination_label) values ($1,'Test trip','Tokyo')", [id]));
  return id;
}

const save = (tx, tripId, id, revision, fields) =>
  tx.query("select public.save_booking($1,$2,$3,$4) as result", [tripId, id, revision, fields]).then(({ rows }) => rows[0].result);

test("booking writes are atomic, versioned and owner-only, with separate private details", async () => {
  const tripId = await trip(ownerA);
  const id = randomUUID();
  const fields = { kind: "FLIGHT", title: "Test flights", status: "NEEDS_BOOKING", detail: [
    { departure_airport: "AAA", arrival_airport: "BBB", departure_local_date: "2027-02-17" },
    { departure_airport: "BBB", arrival_airport: "AAA", flight_number: "TEST2", departure_local_date: "2027-02-21",
      departure_local_time: "12:30", departure_timezone: "Asia/Tokyo", arrival_local_time: "15:25" },
  ], private: { private_note: "synthetic-only" } };
  assert.equal(await asUser(db, ownerA, (tx) => save(tx, tripId, id, null, fields)), "saved");
  assert.equal(await asUser(db, ownerA, (tx) => save(tx, tripId, id, null, fields)), "existing");
  await assert.rejects(asUser(db, ownerA, (tx) => save(tx, tripId, id, 1, { ...fields,
    status: "CONFIRMED", detail: [{ departure_airport: "invalid" }] })), { code: "23514" });
  const actual = await asUser(db, ownerA, async (tx) => ({
    booking: (await tx.query("select * from public.bookings where id=$1", [id])).rows[0],
    segments: (await tx.query(`select flight_number,departure_local_time::text,arrival_local_time::text,
      departure_utc::text from public.flight_segments where booking_id=$1 order by segment_order`, [id])).rows,
    private: (await tx.query("select private_note from public.booking_private_details where booking_id=$1", [id])).rows,
  }));
  assert.equal(actual.booking.status, "NEEDS_BOOKING");
  assert.equal(actual.booking.content_version, 1);
  assert.equal(Object.hasOwn(actual.booking, "private_note"), false);
  assert.equal(actual.segments.length, 2);
  assert.equal(actual.segments[0].departure_local_time, null);
  assert.equal(actual.segments[1].departure_local_time, "12:30:00");
  assert.equal(actual.segments[1].arrival_local_time, "15:25:00");
  assert.match(actual.segments[1].departure_utc, /03:30:00/);
  assert.equal(actual.private[0].private_note, "synthetic-only");
  for (const table of ["bookings", "flight_segments", "stay_details", "tour_details", "booking_private_details"]) {
    assert.deepEqual(await asUser(db, ownerB, (tx) => tx.query(`select * from public.${table} where trip_id=$1`, [tripId]).then(({ rows }) => rows)), []);
    await assert.rejects(asUser(db, null, (tx) => tx.query(`select * from public.${table}`)), { code: "42501" });
  }
  assert.equal(await asUser(db, ownerA, (tx) => save(tx, tripId, id, 1, { ...fields, status: "CONFIRMED" })), "saved");
  assert.equal(await asUser(db, ownerA, (tx) => save(tx, tripId, id, 1, fields)), "changed");
  assert.equal(await asUser(db, ownerB, (tx) => save(tx, tripId, id, 2, fields)), "changed");
  assert.deepEqual(await asUser(db, ownerA, (tx) => tx.query("select id from public.bookings"), true).then(({ rows }) => rows), []);
  await assert.rejects(asUser(db, null, (tx) => save(tx, tripId, id, 2, fields)), { code: "42501" });
  await assert.rejects(asUser(db, ownerB, (tx) => tx.query(
    "insert into public.booking_private_details (booking_id,trip_id,private_note) values ($1,$2,'denied')", [id, tripId])), { code: "42501" });
});

test("cross-trip references are refused and booking deletion only detaches unchanged itinerary rows", async () => {
  const tripId = await trip(ownerA);
  const other = await trip(ownerA);
  const id = randomUUID();
  const item = randomUUID();
  const secondItem = randomUUID();
  const fields = { kind: "STAY", title: "Test stay", status: "CONFIRMED", detail: {
    check_in_local_date: "2027-02-17", check_in_local_time: "15:00",
    check_out_local_date: "2027-02-21", check_out_local_time: "11:00",
  } };
  await asUser(db, ownerA, (tx) => save(tx, tripId, id, null, fields));
  const insert = (tx, source, itemId) => tx.query(`insert into public.itinerary_items (id,trip_id,title,kind,local_date,time_mode,fixed_local_time,booking_id)
    values ($1,$2,'Test schedule','BOOKING_REF','2027-02-18','FIXED','08:00',$3)`, [itemId, source, id]);
  await assert.rejects(asUser(db, ownerA, (tx) => insert(tx, other, item)), { code: "23503" });
  const scheduleFields = { title: "Test schedule", kind: "BOOKING_REF", time_mode: "FIXED",
    local_date: "2027-02-18", fixed_local_time: "08:00" };
  const saveSchedule = (tx, source, revision, changes) => tx.query(
    "select public.save_itinerary_item($1,$2,$3,1,$4) as result", [source, item, revision, changes]).then(({ rows }) => rows[0].result);
  assert.equal(await asUser(db, ownerA, (tx) => saveSchedule(tx, other, null, { ...scheduleFields, booking_id: id })), "invalid_booking");
  await asUser(db, ownerA, async (tx) => {
    await insert(tx, tripId, item);
    await tx.query("delete from public.itinerary_items where id=$1", [item]);
    assert.equal((await tx.query("select id from public.bookings where id=$1", [id])).rows.length, 1);
    await insert(tx, tripId, item);
    await insert(tx, tripId, secondItem);
    assert.equal(await saveSchedule(tx, tripId, 1, scheduleFields), "saved");
    assert.equal((await tx.query("select booking_id from public.itinerary_items where id=$1", [item])).rows[0].booking_id, id);
  });
  const remove = (tx, expected) => tx.query("select public.delete_booking($1,$2,1,$3) as result", [tripId, id, expected]).then(({ rows }) => rows[0].result);
  assert.equal(await asUser(db, ownerB, (tx) => remove(tx, [item, secondItem])), "changed");
  assert.equal(await asUser(db, ownerA, (tx) => remove(tx, [item])), "preview");
  assert.equal(await asUser(db, ownerA, (tx) => remove(tx, [item, secondItem])), "deleted");
  const { rows } = await asUser(db, ownerA, (tx) => tx.query(`select kind,booking_id,local_date::text,fixed_local_time::text,revision
    from public.itinerary_items where trip_id=$1 order by revision`, [tripId]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { kind: "NOTE", booking_id: null, local_date: "2027-02-18", fixed_local_time: "08:00:00", revision: 2 });
  assert.deepEqual(rows[1], { ...rows[0], revision: 3 });
});
