import "server-only";

import type { BookingFields, FlightFields, StayFields, TourFields } from "./database.types";
import { readRows } from "./trip-plan-data";
import { requireTripClient } from "./trips";

const bookingColumns = "id,kind,title,status,shared_note,content_version";
const flightColumns = "booking_id,id,segment_order,airline_name,flight_number,departure_airport,arrival_airport,departure_local_date,arrival_local_date,departure_local_time,arrival_local_time,departure_timezone,arrival_timezone";
const stayColumns = "booking_id,address_text,check_in_local_date,check_out_local_date,check_in_local_time,check_out_local_time,guest_count,room_count";
const tourColumns = "booking_id,event_local_date,event_local_time,meeting_local_time,meeting_place_name,meeting_address_text,meeting_latitude,meeting_longitude";
const privateColumns = "confirmation_reference,amount,currency,private_note";

export type BookingSummary = Omit<BookingFields, "shared_note"> & { id: string };
export type Booking = BookingFields & { id: string; content_version: number } & (
  { kind: "FLIGHT"; segments: (FlightFields & { id: string })[] } |
  { kind: "STAY"; stay?: StayFields } | { kind: "TOUR"; tour?: TourFields }
);

export async function loadBookingSummaries(tripId: string) {
  const { client } = await requireTripClient();
  return readRows((start, end) => client.from("bookings").select("id,kind,title,status")
    .eq("trip_id", tripId).order("title").order("id").range(start, end));
}

export async function loadBookings(tripId: string) {
  const { client } = await requireTripClient();
  const [bookings, flights, stays, tours] = await Promise.all([
    readRows((start, end) => client.from("bookings").select(bookingColumns).eq("trip_id", tripId).order("id").range(start, end)),
    readRows((start, end) => client.from("flight_segments").select(flightColumns)
      .eq("trip_id", tripId).order("booking_id").order("segment_order").range(start, end)),
    readRows((start, end) => client.from("stay_details").select(stayColumns).eq("trip_id", tripId).order("booking_id").range(start, end)),
    readRows((start, end) => client.from("tour_details").select(tourColumns).eq("trip_id", tripId).order("booking_id").range(start, end)),
  ]);
  if (!bookings || !flights || !stays || !tours) return null;
  const segments = new Map<string, typeof flights>();
  for (const flight of flights) {
    const group = segments.get(flight.booking_id) ?? [];
    group.push(flight);
    segments.set(flight.booking_id, group);
  }
  const staysById = new Map(stays.map((row) => [row.booking_id, row]));
  const toursById = new Map(tours.map((row) => [row.booking_id, row]));
  const rows = bookings.map((row): Booking => {
    if (row.kind === "FLIGHT") return { ...row, kind: "FLIGHT", segments: segments.get(row.id) ?? [] };
    if (row.kind === "STAY") return { ...row, kind: "STAY", stay: staysById.get(row.id) };
    return { ...row, kind: "TOUR", tour: toursById.get(row.id) };
  });
  return rows.sort((a, b) => startDate(a).localeCompare(startDate(b)) || a.title.localeCompare(b.title, "ko"));
}

function startDate(booking: Booking) {
  if (booking.kind === "FLIGHT") return booking.segments.find((segment) => segment.departure_local_date)?.departure_local_date ?? "~";
  return (booking.kind === "STAY" ? booking.stay?.check_in_local_date : booking.tour?.event_local_date) ?? "~";
}

export async function loadPrivateBooking(tripId: string, id: string) {
  const { client } = await requireTripClient();
  return client.from("booking_private_details").select(privateColumns)
    .eq("trip_id", tripId).eq("booking_id", id).maybeSingle();
}

export async function loadBookingLinks(tripId: string, id: string) {
  const { client } = await requireTripClient();
  return readRows((start, end) => client.from("itinerary_items").select("id,title,local_date,time_mode,fixed_local_time,end_local_time,period")
    .eq("trip_id", tripId).eq("booking_id", id).order("local_date").order("id").range(start, end));
}
