import type { Booking } from "./trip-booking-data";

/** One explicit way to turn a booking into an itinerary draft. Values the booking does not settle stay empty. */
export type BookingSlot = {
  key: string;
  label: string;
  title: string;
  local_date?: string;
  time_mode?: "FIXED";
  fixed_local_time?: string;
  end_local_time?: string;
};

const japanZone = "Asia/Tokyo";
const time = (value: string | null | undefined) => value?.slice(0, 5) || undefined;
const titleLimit = 120;

function fixed(date: string | null | undefined, start: string | null | undefined, end?: string | null) {
  if (!date) return {};
  const from = time(start);
  if (!from) return { local_date: date };
  const until = time(end);
  return { local_date: date, time_mode: "FIXED" as const, fixed_local_time: from, ...(until && until > from && { end_local_time: until }) };
}

/**
 * Itinerary times are Japan local times. A flight segment gives a date and time only for the end that is
 * recorded in Asia/Tokyo; a domestic segment also gives its same-day arrival as the end time. Segments
 * without time zones give the title only, because the Japan-local date cannot be decided.
 */
export function bookingSlots(booking: Booking): BookingSlot[] {
  if (booking.kind === "FLIGHT") {
    return booking.segments.map((segment, index) => {
      const route = [segment.departure_airport, segment.arrival_airport].filter(Boolean).join(" → ");
      const flight = [segment.airline_name, segment.flight_number].filter(Boolean).join(" ");
      const title = [booking.title, route || flight].filter(Boolean).join(" · ").slice(0, titleLimit);
      const departsJapan = segment.departure_timezone === japanZone;
      const arrivesJapan = segment.arrival_timezone === japanZone;
      const values = departsJapan
        ? fixed(segment.departure_local_date, segment.departure_local_time,
          arrivesJapan && segment.arrival_local_date === segment.departure_local_date ? segment.arrival_local_time : null)
        : arrivesJapan ? fixed(segment.arrival_local_date, segment.arrival_local_time) : {};
      const label = (booking.segments.length > 1 ? `${index + 1}구간 ` : "") + (route || "항공편") + " 일정에 추가";
      return { key: segment.id, label, title, ...values };
    });
  }
  if (booking.kind === "STAY") {
    const stay = booking.stay;
    if (!stay) return [{ key: "stay", label: "일정에 추가", title: booking.title }];
    return [
      { key: "check-in", label: "체크인 일정 추가", title: `${booking.title} 체크인`.slice(0, titleLimit),
        ...fixed(stay.check_in_local_date, stay.check_in_local_time) },
      { key: "check-out", label: "체크아웃 일정 추가", title: `${booking.title} 체크아웃`.slice(0, titleLimit),
        ...fixed(stay.check_out_local_date, stay.check_out_local_time) },
    ];
  }
  const tour = booking.tour;
  return [{ key: "tour", label: "일정에 추가", title: booking.title, ...fixed(tour?.event_local_date, tour?.event_local_time) }];
}
