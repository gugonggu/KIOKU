import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { sanitizeMemoryPhoto } from "../src/lib/memory-photo.ts";
import { readMemoryEntry, tripMemoryDays, visitStatuses } from "../src/lib/trip-memory.ts";

test("memory images validate decoded format, resize and strip EXIF metadata", async () => {
  const raw = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#51614f" } })
    .withExif({ IFD0: { Artist: "GALLERY_FIXTURE_ONLY" }, IFD3: { GPSLatitudeRef: "N" } }).jpeg().toBuffer();
  assert.ok((await sharp(raw).metadata()).exif);
  const image = await sanitizeMemoryPhoto(new File([raw], "fixture.jpg", { type: "image/jpeg" }));
  const metadata = await sharp(image.bytes).metadata();
  assert.equal(metadata.width, 1440);
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  await assert.rejects(sanitizeMemoryPhoto(new File(["not a JPEG"], "fixture.jpg", { type: "image/jpeg" })));
  await assert.rejects(sanitizeMemoryPhoto(new File([raw], "fixture.png", { type: "image/png" })));
});

test("journal entries can be standalone and timeline dates are sorted without auto-completing visits", () => {
  const form = new FormData();
  form.set("day", "2027-02-20");
  form.set("title", "  눈 오는 날  ");
  form.set("body", "가상 기록");
  assert.deepEqual(readMemoryEntry(form), { day: "2027-02-20", title: "눈 오는 날", body: "가상 기록", place_id: null, schedule_id: null });
  form.set("day", "2027-02-30");
  assert.equal(readMemoryEntry(form), null);
  assert.deepEqual(tripMemoryDays([{ day: "2027-02-20" }, { day: "2027-02-17" }], [{ day: "2027-02-20" }]), ["2027-02-17", "2027-02-20"]);
  assert.equal(visitStatuses.planned, "방문 예정");
});
