import assert from "node:assert/strict";
import test from "node:test";
import { bookingOccursOn, parseBooking } from "../src/lib/trip-bookings.ts";
import { parseSchedule } from "../src/lib/trip-plan.ts";

test("dated bookings include both lodging endpoints and arrival dates while cancelled bookings stay out of today's list", () => {
  const stay = { kind: "STAY", status: "CONFIRMED", stay: { check_in_local_date: "2027-02-17", check_out_local_date: "2027-02-21" } };
  for (const date of ["2027-02-17", "2027-02-20", "2027-02-21"]) assert.equal(bookingOccursOn(stay, date), true);
  assert.equal(bookingOccursOn(stay, "2027-02-22"), false);
  assert.equal(bookingOccursOn({ ...stay, status: "CANCELLED" }, "2027-02-20", true), false);
  assert.equal(bookingOccursOn({ kind: "FLIGHT", status: "CONFIRMED", segments: [{ arrival_local_date: "2027-02-21" }] }, "2027-02-21"), true);
  assert.equal(bookingOccursOn({ kind: "TOUR", status: "PENDING" }, "2027-02-20", true), true);
});
function form(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}
const parse = (kind, fields) => parseBooking(form({ kind, title: "Synthetic booking", status: "NEEDS_BOOKING", ...fields }));

test("flight fields keep unknowns and each segment's airport time independent", () => {
  const value = parse("FLIGHT", { segment_count: "2", "flight.0.departure_airport": "cts",
    "flight.0.departure_local_date": "2027-02-17", "flight.1.departure_local_time": "12:30",
    "flight.1.arrival_local_time": "15:25", "flight.1.departure_timezone": "Asia/Tokyo", "flight.1.arrival_timezone": "Asia/Seoul" });
  assert.equal(value.detail[0].departure_airport, "CTS");
  assert.equal(value.detail[0].departure_local_time, null);
  assert.equal(value.detail[0].arrival_local_date, null);
  assert.equal(value.detail[1].departure_local_time, "12:30");
  assert.equal(value.detail[1].arrival_local_time, "15:25");
  assert.equal(value.detail[1].arrival_timezone, "Asia/Seoul");
  assert.equal(value.private, null);
  assert.equal(typeof parse("FLIGHT", { segment_count: "1", "flight.0.arrival_timezone": "+09:00" }), "string");
});

test("stay and tour preserve independent dates and clocks and validate private money", () => {
  const stay = parse("STAY", { check_out_local_date: "2027-02-21", check_in_local_time: "15:00" });
  assert.equal(stay.detail.check_in_local_date, null);
  assert.equal(stay.detail.check_in_local_time, "15:00");
  assert.equal(stay.detail.check_out_local_date, "2027-02-21");
  assert.equal(typeof parse("STAY", { check_in_local_date: "2027-02-22", check_out_local_date: "2027-02-21" }), "string");
  const tour = parse("TOUR", { event_local_time: "09:30", meeting_local_time: "08:15", amount: "0", currency: "jpy" });
  assert.equal(tour.detail.event_local_time, "09:30");
  assert.equal(tour.detail.meeting_local_time, "08:15");
  assert.equal(tour.private.amount, 0);
  assert.equal(tour.private.currency, "JPY");
  assert.equal(typeof parse("TOUR", { amount: "0" }), "string");
  assert.equal(typeof parse("TOUR", { meeting_latitude: "43" }), "string");
});

test("schedule updates distinguish an omitted booking field from an explicit detach", () => {
  const id = "1029f67a-eee8-4437-be1c-dca04b942013";
  const entry = { title: "Synthetic entry", kind: "BOOKING_REF" };
  assert.equal(parseSchedule(form({ ...entry, booking_id: id })).booking_id, id);
  assert.equal(parseSchedule(form({ ...entry, booking_id: "" })).kind, "NOTE");
  assert.equal(parseSchedule(form({ ...entry, booking_id: "" })).booking_id, null);
  assert.equal(Object.hasOwn(parseSchedule(form(entry)), "booking_id"), false);
  assert.equal(typeof parseSchedule(form({ ...entry, booking_id: "invalid" })), "string");
});
