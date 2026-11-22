import assert from "node:assert/strict";
import test from "node:test";
import { durationLabel, japanDate, parseTripDetails, tripStatus } from "../src/lib/trip-details.ts";

function form(values = {}) {
  const formData = new FormData();
  for (const [key, value] of Object.entries({ title: "  봄 여행 ", destination_label: " 교토 ", ...values })) {
    formData.set(key, value);
  }
  return formData;
}

test("validating trip form data trims text and preserves optional values as null", () => {
  assert.deepEqual(parseTripDetails(form()), {
    fields: {
      title: "봄 여행", destination_label: "교토", start_date: null, end_date: null, traveler_count: null,
    },
  });
  assert.equal(parseTripDetails(form({ traveler_count: "3" })).fields.traveler_count, 3);
  for (const traveler_count of ["0", "2.5", "1e3", "2147483648"]) {
    assert.ok(parseTripDetails(form({ traveler_count })).errors.traveler_count);
  }
  assert.ok(parseTripDetails(form({ title: "  " })).errors.title);
  assert.ok(parseTripDetails(form({ destination_label: "a".repeat(81) })).errors.destination_label);
});

test("invalid calendar dates and partial or reversed ranges are rejected", () => {
  assert.ok(parseTripDetails(form({ start_date: "2027-02-29", end_date: "2027-03-01" })).errors.start_date);
  assert.ok(parseTripDetails(form({ start_date: "2027-03-01" })).errors.end_date);
  assert.ok(parseTripDetails(form({ end_date: "2027-03-01" })).errors.start_date);
  assert.ok(parseTripDetails(form({ start_date: "2027-03-02", end_date: "2027-03-01" })).errors.end_date);
  assert.equal(parseTripDetails(form({ start_date: "2028-02-29", end_date: "2028-02-29" })).fields.start_date, "2028-02-29");
});

test("trip status changes at midnight in Japan and includes both endpoints", () => {
  const trip = { start_date: "2027-03-01", end_date: "2027-03-02" };
  assert.equal(japanDate(new Date("2027-02-28T14:59:59Z")), "2027-02-28");
  assert.equal(japanDate(new Date("2027-02-28T15:00:00Z")), "2027-03-01");
  assert.equal(tripStatus(trip, "2027-02-28"), "upcoming");
  assert.equal(tripStatus(trip, "2027-03-01"), "active");
  assert.equal(tripStatus(trip, "2027-03-02"), "active");
  assert.equal(tripStatus(trip, "2027-03-03"), "past");
  assert.equal(tripStatus({ start_date: null, end_date: null }, "2027-03-03"), "unscheduled");
  assert.equal(durationLabel("2027-03-01", "2027-03-01"), "당일치기");
  assert.equal(durationLabel("2027-02-27", "2027-03-02"), "3박 4일");
});
