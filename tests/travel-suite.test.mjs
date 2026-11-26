import assert from "node:assert/strict";
import test from "node:test";
import { preparationProgress, preparationTemplate } from "../src/lib/trip-preparation.ts";
import { travelSnapshot } from "../src/lib/travel-snapshot.ts";
import { expenseTotals, parseRate, settleExpenses } from "../src/lib/trip-budget.ts";
import { guideDays, guideOptions, guideScope } from "../src/lib/travel-guide.ts";

test("guide output includes privacy-safe defaults and filters by the selected date", () => {
  const defaults = guideOptions({});
  assert.deepEqual(defaults, { date: "", places: true, bookings: true, preparation: true, budget: false });
  const options = guideOptions({ options: "1", date: "2027-02-19", bookings: "1", budget: ["1", "0"] });
  const place = { name: "小樽運河" };
  const result = guideScope({
    schedule: [{ date: "2027-02-18", place }, { date: "2027-02-19", place }],
    places: [place],
    bookings: [
      { kind: "STAY", detail: { checkInDate: "2027-02-17", checkOutDate: "2027-02-21" } },
      { kind: "TOUR", detail: { date: "2027-02-20" } },
      { kind: "FLIGHT", detail: [{ departureDate: "2027-02-19" }, { departureDate: "2027-02-21" }] },
    ],
  }, options);
  assert.equal(result.schedule.length, 1);
  assert.equal(result.places.length, 0);
  assert.equal(result.bookings.length, 2);
  assert.equal(result.bookings[1].detail.length, 1);
  assert.equal(options.budget, false);
  assert.deepEqual(guideDays({ schedule: [], startDate: "2027-02-17", endDate: "2027-02-21" }, ""),
    ["2027-02-17", "2027-02-18", "2027-02-19", "2027-02-20", "2027-02-21"]);
});

test("fixed point conversion and settlement conserve won after refunds and remainder splits", () => {
  assert.equal(parseRate("9.1234"), 91234);
  assert.equal(parseRate("9.12345"), null);
  const expenses = [
    { amount: 300000, refund: 0, currency: "KRW", rate: 10000, payer: 1, shares: [1, 2, 3], prepaid: true, category: "stay" },
    { amount: 105, refund: 5, currency: "JPY", rate: 91234, payer: 2, shares: [3, 2, 1], prepaid: false, category: "food" },
  ];
  const totals = expenseTotals(expenses);
  assert.equal(totals.total, BigInt(300912));
  assert.equal(totals.jpy, BigInt(100));
  const settlement = settleExpenses(3, expenses);
  assert.deepEqual(settlement.people.map(({ due }) => due), [100304, 100304, 100304].map(BigInt));
  assert.deepEqual(settlement.people.map(({ yenDue }) => yenDue), [34, 33, 33].map(BigInt));
  assert.deepEqual(settlement.transfers.map(({ from, to, amount }) => [from, to, Number(amount)]), [[2, 1, 99392], [3, 1, 100304]]);
  const remainder = settleExpenses(3, [{ ...expenses[0], amount: 2, shares: [3, 2, 1] }]);
  assert.deepEqual(remainder.people.map(({ due }) => Number(due)), [1, 1, 0]);
});

test("preparation templates are opt-in and each item has a stable source key", () => {
  const basic = preparationTemplate("japan");
  const winter = preparationTemplate("winter");
  assert.ok(basic.some(({ title }) => title === "여권 유효기간 확인"));
  assert.ok(winter.some(({ title }) => title === "방한 신발"));
  assert.equal(new Set([...basic, ...winter].map(({ source }) => source)).size, basic.length + winter.length);
  assert.deepEqual(preparationProgress([{ done: true }, { done: false }, { done: true }]), { total: 3, done: 2, percent: 67 });
  assert.deepEqual(preparationProgress([]), { total: 0, done: 0, percent: 0 });
});

test("portable travel snapshots whitelist itinerary and flight fields", () => {
  const trip = { title: "Fixture", destination_label: "札幌", start_date: "2027-02-17", end_date: "2027-02-21", owner_id: "PLACEHOLDER_PRIVATE" };
  const places = [{ id: "p", display_name: "公園", address_text: "札幌市", address_ja: null, latitude: 43, longitude: 141, notes: "PLACEHOLDER_PRIVATE" }];
  const schedule = [{ id: "a", title: "산책", place_id: "p", local_date: "2027-02-17", fixed_local_time: "10:30:00", time_mode: "FIXED",
    end_local_time: "12:00:00", period: null, sort_order: 1, private_note: "PLACEHOLDER_PRIVATE", shared_note: "공유 가능" }];
  const bookings = [{ kind: "FLIGHT", title: "가상 항공", status: "CONFIRMED", confirmation_reference: "PLACEHOLDER_PRIVATE",
    shared_note: "PLACEHOLDER_PRIVATE", segments: [{ departure_airport: "CTS", departure_local_time: "10:15", departure_timezone: "Asia/Tokyo",
      flight_number: "PLACEHOLDER_PRIVATE" }] }];
  const result = travelSnapshot(trip, schedule, places, bookings);
  assert.doesNotMatch(JSON.stringify(result), /PLACEHOLDER_PRIVATE|"owner_id"|"place_id"/);
  assert.equal(result.schedule[0].place.name, "公園");
  assert.equal(result.schedule[0].note, "공유 가능");
  assert.equal(result.schedule[0].end_local_time, "12:00:00");
  assert.equal(result.bookings[0].detail[0].departureZone, "Asia/Tokyo");
});
