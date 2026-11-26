import assert from "node:assert/strict";
import test from "node:test";
import { uploadPhotoQueue, photoFingerprint } from "../src/lib/photo-queue.ts";

test("uploads run sequentially, keep failed IDs and skip successes on retry", async () => {
  const rows = [{id:"a",status:"queued"},{id:"b",status:"queued"},{id:"c",status:"queued"}];
  let active = 0, max = 0;
  const calls = [];
  const update = (row) => Object.assign(rows.find(item => item.id === row.id),row);
  await uploadPhotoQueue(rows,async row => {
    active++; max=Math.max(max,active); calls.push(row.id);
    await new Promise(resolve => setTimeout(resolve,2)); active--;
    return row.id === "b" ? "업로드 실패" : "";
  },update);
  assert.equal(max,1);
  assert.deepEqual(rows.map(row=>row.status),["saved","failed","saved"]);
  await uploadPhotoQueue(rows,async row => {calls.push(row.id);return "";},update);
  assert.deepEqual(calls,["a","b","c","b"]);
  assert.equal(rows[1].status,"saved");
});
test("file identity detects repeated selection of the same source", () => {
  assert.equal(photoFingerprint({name:"a.jpg",size:12,type:"image/jpeg",lastModified:3}),photoFingerprint({name:"a.jpg",size:12,type:"image/jpeg",lastModified:4}));
  assert.notEqual(photoFingerprint({name:"a.jpg",size:12,lastModified:3}),photoFingerprint({name:"a.jpg",size:14,lastModified:3}));
});
