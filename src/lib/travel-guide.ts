import { isCalendarDate } from "./trip-details.ts";
import { shiftDay } from "./trip-plan.ts";
import type { SharedTrip } from "./trip-share-types";

export function guideOptions(query: Record<string, string | string[] | undefined>) {
  const defaults = query.options !== "1";
  return {
    date: typeof query.date === "string" && isCalendarDate(query.date) ? query.date : "",
    places: defaults || query.places === "1",
    bookings: defaults || query.bookings === "1",
    preparation: defaults || query.preparation === "1",
    budget: !defaults && query.budget === "1",
  };
}

export function guideScope(snapshot: SharedTrip, options: ReturnType<typeof guideOptions>) {
  const date = options.date;
  const schedule = snapshot.schedule.filter((item) => !date || item.date === date);
  const bookings = options.bookings ? snapshot.bookings ?? [] : [];
  return {
    schedule,
    places: options.places && !date ? snapshot.places : [],
    bookings: !date ? bookings : bookings.flatMap((booking): typeof bookings => {
      const { detail } = booking;
      if (!detail) return [];
      if (booking.kind === "FLIGHT") {
        const segments = booking.detail.filter(({ departureDate, arrivalDate }) => departureDate === date || arrivalDate === date);
        return segments.length ? [{ ...booking, detail: segments }] : [];
      }
      if (booking.kind === "TOUR") return booking.detail?.date === date ? [booking] : [];
      const inDate = booking.detail?.checkInDate;
      const outDate = booking.detail?.checkOutDate;
      return (inDate && outDate ? inDate <= date && date <= outDate : inDate === date || outDate === date) ? [booking] : [];
    }),
  };
}

export function guideDays(snapshot: SharedTrip, date: string) {
  if (date) return [date];
  const dates = new Set(snapshot.schedule.map((item) => item.date));
  if (snapshot.startDate && snapshot.endDate) {
    const first = Date.parse(snapshot.startDate);
    const last = Date.parse(snapshot.endDate);
    if ((last - first) / 86400000 < 366) {
      for (let day: string | null = snapshot.startDate; day && day <= snapshot.endDate; day = shiftDay(day, 1)) {
        dates.add(day);
        if (day === snapshot.endDate) break;
      }
    }
  }
  return [...dates].sort();
}
