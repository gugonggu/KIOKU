import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";
import { issueShareToken, readShareToken, shareProof } from "../src/lib/trip-share-token.ts";

let db;
before(async () => { db = await createTripsDatabase(); });
after(async () => { await db?.close(); });

const query = (tx, sql, args) => tx.query("select " + sql + " as value", args).then(({ rows }) => rows[0].value);

test("share capabilities enforce scope, explicit projections, revocation, expiry and ownership", async () => {
  const trip = randomUUID();
  const otherTrip = randomUUID();
  const booking = randomUUID();
  const place = randomUUID();
  const key = randomBytes(32);
  await asUser(db, ownerA, async (tx) => {
    await tx.query("insert into public.trips (id,title,destination_label) values ($1,'Visible trip','Japan')", [trip]);
    await tx.query("insert into public.trip_places (id,trip_id,display_name,address_text,notes) values ($1,$2,'Public stop','Sample address','SECRET_PLACE')", [place,trip]);
    await query(tx, "public.save_booking($1,$2,null,$3)", [trip, booking, {
      kind: "TOUR", title: "Public booking", status: "NEEDS_BOOKING", shared_note: "Share tour note",
      detail: { meeting_local_time: "08:01" }, private: { confirmation_reference: "SECRET_REF", private_note: "SECRET_BOOKING", amount: 12345678, currency: "JPY" },
    }]);
    await tx.query("insert into public.itinerary_items (trip_id,title,local_date,place_id,shared_note,private_note) values ($1,'Public plan','2027-02-18',$2,'Share plan note','SECRET_PLAN'),($1,'UNDATED_DRAFT',null,null,null,null)", [trip, place]);
    await tx.query("insert into public.itinerary_items (trip_id,title,local_date,time_mode,fixed_local_time) values ($1,'Clock time first','2027-02-18','FIXED','08:00')", [trip]);
  });
  await asUser(db, ownerB, (tx) => tx.query("insert into public.trips (id,title,destination_label) values ($1,'OTHER_TRIP','Japan')", [otherTrip]));
  const settings = (actor, preview = false) => asUser(db, actor, (tx) => query(tx, "public.read_share_settings($1,$2)", [trip, preview]));
  const read = (proof, actor = null) => asUser(db, actor, (tx) => query(tx, "public.read_shared_trip($1)", [proof]));
  const write = (actor, rev, mode, value, scope = [true, false], expire = null) => asUser(db, actor, (tx) =>
    query(tx, "public.write_share_settings($1,$2,$3,$4,$5,$6,$7,$8)", [trip, rev, mode, expire, ...scope, value?.hash ?? null, value?.encryptedToken ?? null]));
  const issue = () => issueShareToken(trip, key);
  const first = issue();
  const proof = (value) => shareProof(readShareToken(value.encryptedToken, trip, key));
  assert.deepEqual(await settings(ownerA), { enabled: false, encryptedToken: null, expired: false, expiresOn: null, bookings: true, notes: false, revision: 0 });
  assert.equal((await settings(ownerA, true)).title, "Visible trip");
  assert.equal(await settings(ownerB), null);
  assert.equal(await settings(ownerB, true), null);
  const anonymousPreview = asUser(db, null, (tx) => query(tx, "public.read_share_settings($1,true)", [trip]));
  await assert.rejects(anonymousPreview, { code: "42501" });
  await assert.rejects(write(null, 0, "issue", first), { code: "42501" });
  assert.equal(await write(ownerB, 0, "issue", first), false);
  assert.equal(await read(proof(first)), null);
  assert.equal(await write(ownerA, 0, "issue", first), true);
  assert.equal(await read(first.hash), null);
  const shared = await read(proof(first), ownerB);
  assert.equal(shared.title, "Visible trip");
  assert.deepEqual(shared.schedule.map(({ title }) => title), ["Clock time first", "Public plan"]);
  assert.deepEqual(shared.schedule[1].place, { name: "Public stop", address: "Sample address", latitude: null, longitude: null });
  assert.equal(shared.bookings[0].detail.meetingTime, "08:01:00");
  assert.doesNotMatch(JSON.stringify(shared), /SECRET|12345678|Share .*note|UNDATED_DRAFT|OTHER_TRIP|encryptedToken|token_hash/);
  assert.equal(await write(ownerA, 0, "stop"), false);
  assert.equal(await write(ownerA, 1, "settings", null, [false, true]), true);
  const changed = await read(proof(first));
  assert.equal(changed.bookings, null);
  assert.equal(changed.schedule[1].note, "Share plan note");
  const rotated = issue();
  assert.equal(await write(ownerA, 2, "issue", rotated), true);
  assert.equal(await read(proof(first)), null);
  assert.equal((await read(proof(rotated))).title, "Visible trip");
  assert.equal(await write(ownerA, 3, "stop"), true);
  assert.equal(await read(proof(rotated)), null);
  const expired = issue();
  assert.equal(await write(ownerA, 4, "issue", expired, [true, false], "2000-01-01"), true);
  assert.equal(await read(proof(expired)), null);
  assert.equal((await settings(ownerA)).expired, true);
  assert.equal(await write(ownerA, 5, "settings", null, [true, false]), true);
  assert.equal(await read(proof(expired)), null);
  for (const relation of ["public.trips", "public.bookings", "kioku_private.trip_share_links"]) {
    await assert.rejects(asUser(db, null, (tx) => tx.query("select * from " + relation)), { code: "42501" });
  }
  await assert.rejects(asUser(db, ownerB, (tx) => tx.query("select * from kioku_private.trip_share_links")), { code: "42501" });
  await assert.rejects(asUser(db, null, (tx) => query(tx, "kioku_private.shared_trip_payload($1,true,true)", [trip])), { code: "42501" });
});
