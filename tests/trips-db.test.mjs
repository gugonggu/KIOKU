import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";

const database = await createTripsDatabase();
test.after(() => database.close());

const insert = (tx, id, title = "저녁 산책") => tx.query(
  "insert into public.trips (id, title, destination_label) values ($1, $2, '도쿄') returning *",
  [id, title],
);

test("two authenticated owners can create trips but cannot read, edit, or delete each other's rows", async () => {
  const first = randomUUID();
  const second = randomUUID();
  await asUser(database, ownerA, (tx) => insert(tx, first));
  await asUser(database, ownerB, (tx) => insert(tx, second));
  for (const [owner, own, other] of [[ownerA, first, second], [ownerB, second, first]]) {
    await asUser(database, owner, async (tx) => {
      assert.deepEqual((await tx.query("select id from public.trips where id in ($1, $2)", [own, other])).rows, [{ id: own }]);
      assert.equal((await tx.query("update public.trips set title = '다른 갈 곳' where id = $1 returning id", [other])).rows.length, 0);
      assert.equal((await tx.query("delete from public.trips where id = $1 returning id", [other])).rows.length, 0);
      assert.equal((await tx.query("update public.trips set title = '새 이름' where id = $1 returning content_version", [own])).rows[0].content_version, 2);
    });
  }
  assert.equal((await asUser(database, ownerB, (tx) => tx.query("delete from public.trips where id = $1 returning id", [second]))).rows.length, 1);
});

test("anonymous roles cannot access trips and client grants protect ownership columns", async () => {
  const id = randomUUID();
  await asUser(database, ownerA, (tx) => insert(tx, id));
  for (const sql of [
    "select * from public.trips",
    "insert into public.trips (title, destination_label) values ('새 여행', '교토')",
    "update public.trips set title = '수정'",
    "delete from public.trips",
  ]) {
    await assert.rejects(asUser(database, null, (tx) => tx.query(sql)), { code: "42501" });
  }
  await asUser(database, ownerA, async (tx) => {
    assert.deepEqual((await tx.query("select id from public.trips")).rows, []);
    assert.equal((await tx.query("update public.trips set title = '수정' returning id")).rows.length, 0);
    assert.equal((await tx.query("delete from public.trips returning id")).rows.length, 0);
  }, true);
  await assert.rejects(asUser(database, ownerA, (tx) => insert(tx, randomUUID()), true), { code: "42501" });
  await assert.rejects(asUser(database, ownerA, (tx) => tx.query(
    "insert into public.trips (owner_id, title, destination_label) values ($1, '새 여행', '교토')", [ownerB],
  )), { code: "42501" });
  await assert.rejects(asUser(database, ownerA, (tx) => tx.query("update public.trips set owner_id = $1 where id = $2", [ownerB, id])), { code: "42501" });
});

test("database constraints allow unset and one-day trips and reject invalid date ranges and headcounts", async () => {
  const { rows: [trip] } = await asUser(database, ownerA, (tx) => insert(tx, randomUUID()));
  assert.equal(trip.start_date, null);
  assert.equal(trip.end_date, null);
  assert.equal(trip.traveler_count, null);
  assert.equal(trip.country_code, "JP");
  assert.equal(trip.timezone, "Asia/Tokyo");
  assert.equal(trip.cover_photo_id, null);
  await asUser(database, ownerA, (tx) => tx.query(
    "update public.trips set start_date = '2027-03-01', end_date = '2027-03-01', traveler_count = 1 where id = $1", [trip.id],
  ));
  for (const update of ["end_date = null", "end_date = '2027-02-28'", "traveler_count = 0", "title = ''"]) {
    await assert.rejects(asUser(database, ownerA, (tx) => tx.query(`update public.trips set ${update} where id = $1`, [trip.id])), { code: "23514" });
  }
});

test("repeated inserts keep the first saved values and stale writes affect no rows", async () => {
  const id = randomUUID();
  const sql = "insert into public.trips (id, title, destination_label) values ($1, $2, '교토') on conflict (id) do nothing returning id";
  const save = (owner, title) => asUser(database, owner, (tx) => tx.query(sql, [id, title]));
  const replies = await Promise.all([save(ownerA, "첫 요청"), save(ownerA, "재시도")]);
  assert.equal(replies.flatMap(({ rows }) => rows).length, 1);
  assert.equal((await save(ownerB, "다른 소유자")).rows.length, 0);
  await asUser(database, ownerA, async (tx) => {
    assert.deepEqual((await tx.query("select title, content_version from public.trips where id = $1", [id])).rows, [
      { title: "첫 요청", content_version: 1 },
    ]);
    await tx.query("update public.trips set title = '변경됨' where id = $1 and content_version = 1", [id]);
    assert.equal((await tx.query("update public.trips set title = '이전 편집' where id = $1 and content_version = 1 returning id", [id])).rows.length, 0);
    assert.equal((await tx.query("delete from public.trips where id = $1 and content_version = 1 returning id", [id])).rows.length, 0);
  });
});
