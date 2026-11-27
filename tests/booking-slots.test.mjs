import assert from "node:assert/strict";
import test from "node:test";
import { bookingSlots } from "../src/lib/booking-slots.ts";

const segment = (id, fields) => ({ id, airline_name: "가상항공", flight_number: null, departure_airport: null, arrival_airport: null,
  departure_local_date: null, arrival_local_date: null, departure_local_time: null, arrival_local_time: null,
  departure_timezone: null, arrival_timezone: null, ...fields });

test("each flight segment offers its Japan-local date and time only when the time zone settles it", () => {
  const slots = bookingSlots({ id: "b", kind: "FLIGHT", title: "왕복 항공", status: "CONFIRMED", shared_note: null, content_version: 1, segments: [
    segment("in", { departure_airport: "ICN", arrival_airport: "CTS", departure_local_date: "2027-02-17", departure_local_time: "08:30:00",
      departure_timezone: "Asia/Seoul", arrival_local_date: "2027-02-17", arrival_local_time: "11:20:00", arrival_timezone: "Asia/Tokyo" }),
    segment("domestic", { departure_airport: "CTS", arrival_airport: "HND", departure_local_date: "2027-02-19", departure_local_time: "09:00",
      departure_timezone: "Asia/Tokyo", arrival_local_date: "2027-02-19", arrival_local_time: "10:40", arrival_timezone: "Asia/Tokyo" }),
    segment("unknown", { departure_airport: "CTS", arrival_airport: "ICN", departure_local_date: "2027-02-21", departure_local_time: "17:00" }),
  ] });
  assert.deepEqual(slots[0], { key: "in", label: "1구간 ICN → CTS 일정에 추가", title: "왕복 항공 · ICN → CTS",
    local_date: "2027-02-17", time_mode: "FIXED", fixed_local_time: "11:20" });
  assert.deepEqual(slots[1], { key: "domestic", label: "2구간 CTS → HND 일정에 추가", title: "왕복 항공 · CTS → HND",
    local_date: "2027-02-19", time_mode: "FIXED", fixed_local_time: "09:00", end_local_time: "10:40" });
  assert.deepEqual(slots[2], { key: "unknown", label: "3구간 CTS → ICN 일정에 추가", title: "왕복 항공 · CTS → ICN" });
});

test("stays offer separate check-in and check-out drafts and tours use the start time", () => {
  const stay = bookingSlots({ id: "s", kind: "STAY", title: "가상 호텔", status: "PENDING", shared_note: null, content_version: 1, stay: {
    address_text: null, check_in_local_date: "2027-02-17", check_in_local_time: "15:00:00", check_out_local_date: "2027-02-21",
    check_out_local_time: null, guest_count: 2, room_count: 1 } });
  assert.deepEqual(stay.map(({ key, title, local_date, fixed_local_time }) => [key, title, local_date, fixed_local_time]), [
    ["check-in", "가상 호텔 체크인", "2027-02-17", "15:00"], ["check-out", "가상 호텔 체크아웃", "2027-02-21", undefined],
  ]);
  assert.equal(stay[1].time_mode, undefined);
  const tour = bookingSlots({ id: "t", kind: "TOUR", title: "오타루 투어", status: "CONFIRMED", shared_note: null, content_version: 1, tour: {
    event_local_date: "2027-02-19", event_local_time: "13:00", meeting_local_time: "12:40", meeting_place_name: null,
    meeting_address_text: null, meeting_latitude: null, meeting_longitude: null } });
  assert.deepEqual(tour, [{ key: "tour", label: "일정에 추가", title: "오타루 투어", local_date: "2027-02-19", time_mode: "FIXED", fixed_local_time: "13:00" }]);
  assert.deepEqual(bookingSlots({ id: "e", kind: "TOUR", title: "미정 투어", status: "NEEDS_BOOKING", shared_note: null, content_version: 1 }),
    [{ key: "tour", label: "일정에 추가", title: "미정 투어" }]);
});
