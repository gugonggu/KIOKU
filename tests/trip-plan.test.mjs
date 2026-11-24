import assert from "node:assert/strict";
import test from "node:test";
import { nextFixedSchedule, parseSchedule, sortSchedule, outsideTrip, planDay, shiftDay } from "../src/lib/trip-plan.ts";

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

test("time modes distinguish a day, a clock time and a candidate", () => {
  const parse = (fields) => parseSchedule(form({ title: " 산책 ", ...fields }));
  assert.equal(parse({ local_date: "2028-02-29" }).time_mode, "UNSCHEDULED");
  assert.equal(parse({ local_date: "2028-02-29" }).local_date, "2028-02-29");
  assert.equal(parse({}).local_date, null);
  assert.equal(parse({ time_mode: "FIXED", local_date: "2028-02-29", fixed_local_time: "09:15" }).fixed_local_time, "09:15");
  assert.equal(typeof parse({ time_mode: "FIXED", local_date: "2028-02-29" }), "string");
  assert.equal(typeof parse({ time_mode: "FIXED", fixed_local_time: "09:15" }), "string");
  assert.equal(typeof parse({ time_mode: "PERIOD", local_date: "2027-02-29", period: "AFTERNOON" }), "string");
  assert.equal(typeof parse({ time_mode: "PERIOD", local_date: "2028-02-29" }), "string");
  assert.equal(parse({ time_mode: "PERIOD", local_date: "2028-02-29", period: "AFTERNOON" }).period, "AFTERNOON");
});

test("sort order is secondary to the fixed clock or period group", () => {
  const row = (id, sort_order, time_mode, fixed_local_time = null, period = null) => ({ id, sort_order, time_mode, fixed_local_time, period });
  const input = [
    row("late", 1, "FIXED", "11:00"), row("unscheduled", 2, "UNSCHEDULED"),
    row("evening", 3, "PERIOD", null, "EVENING"), row("afternoon", 4, "PERIOD", null, "AFTERNOON"),
    row("morning", 5, "PERIOD", null, "MORNING"), row("early2", 7, "FIXED", "09:00"), row("early1", 6, "FIXED", "09:00"),
  ];
  assert.deepEqual(sortSchedule(input).map(({ id }) => id), ["early1", "early2", "late", "morning", "afternoon", "evening", "unscheduled"]);
});

test("Japan calendar navigation and period boundaries ignore undated candidates", () => {
  const trip = { start_date: "2027-02-17", end_date: "2027-02-21" };
  assert.equal(planDay(trip, "2027-02-19", "2027-02-17"), "2027-02-19");
  assert.equal(shiftDay("2028-02-29", 1), "2028-03-01");
  assert.equal(shiftDay("9999-12-31", 1), null);
  assert.equal(outsideTrip(trip, null), false);
  assert.equal(outsideTrip(trip, "2027-02-16"), true);
  assert.equal(outsideTrip(trip, "2027-02-21"), false);
});

test("next schedule uses the Japan date and clock and keeps explicit same-time ordering", () => {
  const row = (id, local_date, fixed_local_time, sort_order, time_mode = "FIXED") => ({
    id, local_date, fixed_local_time, sort_order, time_mode, period: time_mode === "PERIOD" ? "MORNING" : null,
  });
  const input = [
    row("previous day", "2027-02-16", "23:59:00", 0),
    row("passed", "2027-02-17", "08:59:00", 0),
    row("same time second", "2027-02-17", "09:00:00", 2),
    row("same time first", "2027-02-17", "09:00:00", 1),
    row("period", "2027-02-17", null, 0, "PERIOD"),
    row("flexible", "2027-02-17", null, 0, "UNSCHEDULED"),
    row("another day", "2027-02-18", "00:00:00", 0),
  ];
  assert.equal(nextFixedSchedule(input, new Date("2027-02-16T15:00:00Z"))?.id, "passed");
  assert.equal(nextFixedSchedule(input, new Date("2027-02-17T00:00:25Z"))?.id, "same time first");
  assert.equal(nextFixedSchedule(input, new Date("2027-02-17T00:01:00Z")), undefined);
});
