import assert from "node:assert/strict";
import test from "node:test";
import { memoryPhotoInputError } from "../src/lib/memory-photo-input.ts";

const jpeg = new File([new Uint8Array(3_800_000)], "camera.jpg", { type: "image/jpeg" });

test("photo input sends exactly one supported file within the upload limit", () => {
  assert.equal(memoryPhotoInputError([jpeg]), "");
  assert.match(memoryPhotoInputError([]), /한 장/);
  assert.match(memoryPhotoInputError([jpeg, jpeg]), /한 장/);
  assert.match(memoryPhotoInputError([
    new File([new Uint8Array(3_800_001)], "large.jpg", { type: "image/jpeg" }),
  ]), /3\.8MB.*줄/);
});

test("HEIF source files get an export hint while a browser-provided JPEG is accepted", () => {
  assert.match(memoryPhotoInputError([new File(["data"], "capture.HEIC")]), /HEIC.*JPEG/);
  assert.match(memoryPhotoInputError([new File(["data"], "photo", { type: "image/heif" })]), /HEIF.*JPEG/);
  assert.equal(memoryPhotoInputError([new File(["data"], "capture.HEIC", { type: "image/jpeg" })]), "");
});
