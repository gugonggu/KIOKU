import assert from "node:assert/strict";
import test from "node:test";
import { importPreview, parseTripImport } from "../src/lib/trip-import.ts";

test("schedule import validates shape, dates, time and rejects linked or unknown fields", () => {
  for (const input of [
    '{broken', '[]', '[{"title":"A","date":"2027-02-30"}]', '[{"title":"A","time":"11:20"}]',
    '[{"title":"A","place_id":"elsewhere"}]', '[{"title":"A","date":"2027-02-20","time":"24:15"}]',
  ]) assert.ok(parseTripImport(input).error);
  assert.deepEqual(parseTripImport('[{"title":"  후보  "}]').rows, [{
    title:"후보", local_date:null, time_mode:"UNSCHEDULED", fixed_local_time:null, period:null,
  }]);
});

test("import preview identifies existing and in-batch duplicates and out-of-range dates", () => {
  const { rows } = parseTripImport(JSON.stringify([
    { title:"Park", date:"2027-02-18", time:"10:00" },
    { title:"Café", date:"2027-02-19", period:"AFTERNOON" },
    { title:"café", date:"2027-02-19", period:"AFTERNOON" },
    { title:"Out", date:"2027-02-25" },
  ]));
  const existing = [{ ...rows[0], title:"park", fixed_local_time:"10:00:00" }];
  const trip = { start_date:"2027-02-17", end_date:"2027-02-21" };
  assert.deepEqual(importPreview(rows, existing, trip).map(({ status }) => status), ["duplicate","new","duplicate","outside"]);
});
