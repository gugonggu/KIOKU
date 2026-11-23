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

test("itinerary RLS and same-trip place links protect existing trips", async () => {
  const first = randomUUID();
  const sibling = randomUUID();
  const other = randomUUID();
  await asUser(database, ownerA, (tx) => insert(tx, first));
  await asUser(database, ownerA, (tx) => insert(tx, sibling));
  await asUser(database, ownerB, (tx) => insert(tx, other));
  const addPlace = (owner, trip) => asUser(database, owner, (tx) => tx.query(
    "insert into public.trip_places (trip_id, name) values ($1, 'Test place') returning id", [trip],
  ));
  const { rows: [place] } = await addPlace(ownerA, first);
  await assert.rejects(addPlace(ownerB, first), { code: "42501" });
  const add = (owner, trip, placeId, anonymous = false) => asUser(database, owner, (tx) => tx.query(
    "insert into public.itinerary_items (trip_id, title, place_id) values ($1, 'Test itinerary', $2) returning id", [trip, placeId],
  ), anonymous);
  await assert.rejects(add(ownerA, sibling, place.id), { code: "23503" });
  await assert.rejects(add(ownerB, other, place.id), { code: "23503" });
  await assert.rejects(add(ownerB, first, place.id), { code: "42501" });
  await assert.rejects(add(ownerA, first, place.id, true), { code: "42501" });
  const { rows: [item] } = await add(ownerA, first, place.id);
  await assert.rejects(asUser(database, null, (tx) => tx.query("select id from public.itinerary_items")), { code: "42501" });
  await assert.rejects(asUser(database, null, (tx) => tx.query(
    "select public.place_itinerary_item($1,$2,1,'delete',null,1)", [first, item.id],
  )), { code: "42501" });
  await asUser(database, ownerB, async (tx) => {
    assert.equal((await tx.query("select id from public.itinerary_items where trip_id = $1", [first])).rows.length, 0);
    assert.equal((await tx.query("update public.itinerary_items set title = 'Invalid' where id = $1 returning id", [item.id])).rows.length, 0);
    assert.equal((await tx.query("select public.place_itinerary_item($1,$2,1,'delete',null,1) as result", [first,item.id])).rows[0].result, false);
  });
  await asUser(database, ownerA, (tx) => tx.query("delete from public.trips where id = $1", [first]));
  assert.equal((await database.query("select id from public.itinerary_items where id = $1", [item.id])).rows.length, 0);
  assert.equal((await database.query("select id from public.trip_places where id = $1", [place.id])).rows.length, 0);
});

test("itinerary time constraints, duplicate and stale write prevention", async () => {
  const trip = randomUUID();
  const id = randomUUID();
  await asUser(database, ownerA, (tx) => insert(tx, trip));
  const save = (itemId, revision, fields, owner = ownerA, tripVersion = 1) => asUser(database, owner, async (tx) =>
    (await tx.query("select public.save_itinerary_item($1,$2,$3,$4,$5) as result",
      [trip, itemId, revision, tripVersion, { title: "Plan", kind: "NOTE", ...fields }])).rows[0].result,
  );
  for (const fields of [
    { time_mode: "FIXED", local_date: "2027-02-17" },
    { time_mode: "FIXED", fixed_local_time: "09:00" },
    { time_mode: "FIXED", local_date: "2027-02-17", fixed_local_time: "24:00" },
    { time_mode: "PERIOD", local_date: "2027-02-17" },
    { time_mode: "PERIOD", period: "MORNING" },
    { time_mode: "PERIOD", local_date: "2027-02-17", period: "ALL_DAY" },
    { time_mode: "UNSCHEDULED", period: "MORNING" },
  ]) await assert.rejects(save(randomUUID(), null, fields), { code: "23514" });
  const fields = { time_mode: "UNSCHEDULED", local_date: "2027-02-17", private_note: "Private", shared_note: "Shareable" };
  const replies = await Promise.all([save(id, null, fields), save(id, null, fields)]);
  assert.deepEqual(replies.sort(), ["existing", "saved"]);
  assert.equal(await save(id, 1, fields, ownerB), "changed");
  assert.equal(await save(id, 1, fields, ownerA, 2), "changed");
  assert.equal(await save(id, 1, { ...fields, local_date: null }), "changed");
  assert.equal(await save(id, 1, { ...fields, title: "Updated" }), "saved");
  assert.equal(await save(id, 1, fields), "changed");
  const { rows } = await asUser(database, ownerA, (tx) => tx.query(
    "select title,time_mode,local_date::text,private_note,shared_note,revision from public.itinerary_items where id = $1", [id],
  ));
  assert.deepEqual(rows, [{ title:"Updated", time_mode:"UNSCHEDULED", local_date:"2027-02-17", private_note:"Private", shared_note:"Shareable", revision:2 }]);
});

test("only the same date and group can swap and candidate restore preserves ranking and notes", async () => {
  const trip = randomUUID();
  await asUser(database, ownerA, (tx) => insert(tx, trip));
  const add = (time, date = "2027-02-17") => asUser(database, ownerA, async (tx) => (await tx.query(
    "insert into public.itinerary_items (trip_id,title,local_date,time_mode,fixed_local_time,private_note,shared_note) values ($1,'Clock',$2,'FIXED',$3,'Owner note','Shared note') returning id,sort_order",
    [trip,date,time],
  )).rows[0]);
  const first = await add("09:00");
  const second = await add("09:00");
  const later = await add("10:00");
  const tomorrow = await add("09:00","2027-02-18");
  const swap = (item) => asUser(database, ownerA, async (tx) => (await tx.query(
    "select public.swap_itinerary_items($1,$2,1,$3,1) as result", [trip,first.id,item.id],
  )).rows[0].result);
  assert.equal(await swap(later), false);
  assert.equal(await swap(tomorrow), false);
  assert.equal(await swap(second), true);
  assert.equal(await swap(second), false);

  const place = (version, command, date = null) => asUser(database, ownerA, async (tx) => (await tx.query(
    "select public.place_itinerary_item($1,$2,$3,$4,$5,1) as result", [trip,first.id,version,command,date],
  )).rows[0].result);
  const load = () => asUser(database, ownerA, async (tx) => (await tx.query(
    "select id,local_date::text,time_mode,fixed_local_time::text,private_note,shared_note,sort_order,archived_date::text from public.itinerary_items where id = $1", [first.id],
  )).rows[0]);

  assert.equal(await place(2, "archive"), true);
  assert.equal(await place(2, "restore"), false);
  const { sort_order: candidateOrder, ...candidate } = await load();
  assert.ok(candidateOrder > second.sort_order);
  assert.deepEqual(candidate, { id:first.id, local_date:null, time_mode:"UNSCHEDULED", fixed_local_time:null,
    private_note:"Owner note", shared_note:"Shared note", archived_date:"2027-02-17" });
  assert.equal(await place(3, "restore"), true);
  let restored = await load();
  assert.equal(restored.sort_order, second.sort_order);
  assert.equal(restored.fixed_local_time, "09:00:00");
  assert.equal(restored.archived_date, null);
  assert.equal(await place(4, "archive"), true);
  const changed = await add("09:00");
  await asUser(database, ownerA, (tx) => tx.query("update public.itinerary_items set sort_order=$2 where id=$1", [changed.id,second.sort_order]));
  assert.equal(await place(5, "restore"), true);
  restored = await load();
  assert.ok(restored.sort_order > changed.sort_order);
  assert.equal(await place(6, "move", "2027-02-19"), true);
  assert.equal((await load()).local_date, "2027-02-19");
  assert.equal(await place(7, "delete"), true);
  assert.equal(await load(), undefined);
});

test("period preview ignores candidates and refreshes if the affected dates change before confirmation", async () => {
  const trip = randomUUID();
  await asUser(database, ownerA, async (tx) => {
    await insert(tx, trip);
    await tx.query("update public.trips set start_date='2027-02-17', end_date='2027-02-21' where id=$1", [trip]);
    await tx.query(`insert into public.itinerary_items (trip_id,title,local_date) values
      ($1,'Candidate',null), ($1,'Inside','2027-02-17'), ($1,'Also inside','2027-02-17'), ($1,'Outside','2027-02-22')`, [trip]);
  });
  const fields = { title:"Trip", destination_label:"Japan", start_date:"2027-02-18", end_date:"2027-02-22" };
  const propose = (expected, owner = ownerA) => asUser(database, owner, async (tx) => (await tx.query(
    "select public.update_trip_period($1,2,$2,$3) as result", [trip,fields,expected === null ? null : JSON.stringify(expected)],
  )).rows[0].result);
  assert.deepEqual(await propose(null, ownerB), { status:"changed" });
  const earlier = await propose(null);
  assert.deepEqual(earlier, { status:"preview", entries:[
    { date:"2027-02-17", count:2, group:"OUTSIDE" }, { date:"2027-02-22", count:1, group:"DAY" },
  ] });
  await asUser(database, ownerA, (tx) => tx.query(
    "insert into public.itinerary_items (trip_id,title,local_date) values ($1,'Another','2027-02-17')", [trip],
  ));
  const latest = await propose(earlier.entries);
  assert.deepEqual(latest, { status:"preview", entries:[
    { date:"2027-02-17", count:3, group:"OUTSIDE" }, { date:"2027-02-22", count:1, group:"DAY" },
  ] });
  assert.deepEqual(await propose(latest.entries), { status:"saved" });
  const { rows: [{ result: cleared }] } = await asUser(database, ownerA, (tx) => tx.query(
    "select public.update_trip_period($1,3,$2,null) as result",
    [trip, { ...fields, start_date: null, end_date: null }],
  ));
  assert.deepEqual(cleared, { status:"preview", entries:[
    { date:"2027-02-17", count:3, group:"NO_RANGE" }, { date:"2027-02-22", count:1, group:"NO_RANGE" },
  ] });
  const { rows } = await database.query("select local_date::text,revision from public.itinerary_items where trip_id=$1 order by local_date nulls last", [trip]);
  assert.deepEqual(rows.map(({ local_date }) => local_date), ["2027-02-17","2027-02-17","2027-02-17","2027-02-22",null]);
  assert.ok(rows.every(({ revision }) => revision === 1));
});
