import assert from "node:assert/strict";
import test from "node:test";
import { preparationProgress, preparationTemplate } from "../src/lib/trip-preparation.ts";

test("preparation templates are opt-in and each item has a stable source key", () => {
  const basic = preparationTemplate("japan");
  const winter = preparationTemplate("winter");
  assert.ok(basic.some(({ title }) => title === "여권 유효기간 확인"));
  assert.ok(winter.some(({ title }) => title === "방한 신발"));
  assert.equal(new Set([...basic, ...winter].map(({ source }) => source)).size, basic.length + winter.length);
  assert.deepEqual(preparationProgress([{ done: true }, { done: false }, { done: true }]), { total: 3, done: 2, percent: 67 });
  assert.deepEqual(preparationProgress([]), { total: 0, done: 0, percent: 0 });
});
