import assert from "node:assert/strict";
import test from "node:test";
import { defaultCoverTheme } from "../src/lib/trip-cover.ts";
test("legacy destination defaults and explicit themes use the same resolution", () => {
  assert.equal(defaultCoverTheme(undefined,"札幌"),"winter");
  assert.equal(defaultCoverTheme("auto","Osaka"),"mountain");
  assert.equal(defaultCoverTheme("sea","札幌"),"sea");
  assert.equal(defaultCoverTheme("unknown","Tokyo"),"mountain");
});
