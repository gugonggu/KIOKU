import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";

let db;
before(async () => { db = await createTripsDatabase(); });
after(async () => { await db?.close(); });

test("memory is owner-only and rejects cross-trip links and unprocessed uploads", async () => {
  const a = randomUUID(), b = randomUUID(), note = randomUUID(), foreign = randomUUID(), schedule = randomUUID();
  const photo = randomUUID(), next = randomUUID();
  await asUser(db, ownerA, async (tx) => {
    await tx.query("insert into public.trips(id,title,destination_label) values ($1,'A','Japan'),($2,'B','Japan')", [a,b]);
    await tx.query("insert into public.itinerary_items(id,trip_id,title,local_date) values ($1,$2,'Visit','2027-02-19')", [schedule,a]);
    await tx.query("insert into public.trip_memory_entries(id,trip_id,day,title,body,schedule_id) values ($1,$2,'2027-02-19','Diary','Private fixture',$3)", [note,a,schedule]);
    await tx.query("insert into public.trip_memory_entries(id,trip_id,day,title,body) values ($1,$2,'2027-02-19','Elsewhere','Fixture')", [foreign,b]);
    assert.equal((await tx.query("select status from public.trip_visit_marks")).rows.length, 0);
    await tx.query("select public.set_trip_visit($1,$2,'visited')", [a,schedule]);
    for (const id of [photo,next]) {
      await tx.query("insert into public.trip_memory_photos(id,trip_id,day,title,entry_id) values ($1,$2,'2027-02-19','Photo',$3)", [id,a,note]);
    }
  });
  await assert.rejects(asUser(db,ownerA,(tx)=>tx.query("select public.set_trip_visit($1,$2,'missed')", [b,schedule])), {code:"23503"});
  await assert.rejects(asUser(db,ownerA,(tx)=>tx.query("insert into public.trip_memory_photos(id,trip_id,day,title,entry_id) values ($1,$2,'2027-02-19','Wrong',$3)", [randomUUID(),a,foreign])), {code:"23503"});
  await assert.rejects(asUser(db,ownerA,(tx)=>tx.query("update public.trip_memory_photos set phase='ready' where id=$1", [photo])), {code:"42501"});
  await assert.rejects(asUser(db,ownerA,(tx)=>tx.query("delete from public.trips where id=$1", [a])),
    (error) => ["23001", "23503"].includes(error.code) && error.constraint === "trip_memory_photos_trip_id_fkey");
  await db.query("update public.trip_memory_photos set phase='ready',width=100,height=70,bytes=1000 where trip_id=$1", [a]);
  await db.query("insert into storage.objects(bucket_id,name) values ('trip-memory',$1)", [a+"/"+photo+".jpg"]);
  await asUser(db, ownerA, async (tx) => {
    assert.equal((await tx.query("select name from storage.objects")).rows.length, 1);
    assert.equal((await tx.query("select public.organize_memory_photo($1,$2,'earlier') as moved", [a,next])).rows[0].moved, true);
    assert.equal((await tx.query("select id from public.trip_memory_photos order by sort_order")).rows[0].id, next);
    await tx.query("select public.organize_memory_photo($1,$2,'cover')", [a,photo]);
    await tx.query("select public.organize_memory_photo($1,$2,'cover')", [a,next]);
    assert.equal((await tx.query("select id from public.trip_memory_photos where is_cover")).rows[0].id, next);
    await tx.query("delete from public.trip_memory_entries where id=$1", [note]);
    assert.equal((await tx.query("select entry_id from public.trip_memory_photos where id=$1", [photo])).rows[0].entry_id, null);
    await tx.query("delete from public.itinerary_items where id=$1", [schedule]);
    assert.equal((await tx.query("select status from public.trip_visit_marks")).rows.length, 0);
  });
  await asUser(db, ownerB, async (tx) => {
    for (const name of ["public.trip_memory_entries", "public.trip_memory_photos", "storage.objects"]) {
      assert.equal((await tx.query("select * from " + name)).rows.length, 0);
    }
  });
  await assert.rejects(asUser(db,null,(tx)=>tx.query("select * from public.trip_memory_entries")), {code:"42501"});
  const bucket=(await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='trip-memory'")).rows[0];
  assert.deepEqual(bucket, {public:false,file_size_limit:524288,allowed_mime_types:["image/jpeg"]});
  await assert.rejects(asUser(db,ownerA,(tx)=>tx.query("insert into public.trip_memory_photos(id,trip_id,day,title) select gen_random_uuid(),$1,'2027-02-19','Quota' from generate_series(1,23)", [a])), {code:"23514"});
});
