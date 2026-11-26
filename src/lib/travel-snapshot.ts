import type { Trip } from "./trip-details";
import type { PlanPlace, PlanSchedule } from "./trip-plan-data";
import type { Booking } from "./trip-booking-data";
import type { SharedBooking, SharedPlace, SharedTrip } from "./trip-share-types";
import { sortSchedule } from "./trip-plan.ts";

function bookingSnapshot(booking: Booking): SharedBooking {
  const fields = { title: booking.title, status: booking.status };
  if (booking.kind === "FLIGHT") return { ...fields, kind: "FLIGHT", detail: booking.segments.map((segment) => ({
    departureAirport: segment.departure_airport ?? null, departureDate: segment.departure_local_date ?? null,
    departureTime: segment.departure_local_time ?? null, departureZone: segment.departure_timezone ?? null,
    arrivalAirport: segment.arrival_airport ?? null, arrivalDate: segment.arrival_local_date ?? null,
    arrivalTime: segment.arrival_local_time ?? null, arrivalZone: segment.arrival_timezone ?? null,
  })) };
  if (booking.kind === "STAY") {
    const stay = booking.stay;
    return { ...fields, kind: "STAY", detail: stay ? {
      address: stay.address_text, checkInDate: stay.check_in_local_date, checkInTime: stay.check_in_local_time,
      checkOutDate: stay.check_out_local_date, checkOutTime: stay.check_out_local_time,
    } : null };
  }
  const tour = booking.tour;
  return { ...fields, kind: "TOUR", detail: tour ? {
    date: tour.event_local_date, time: tour.event_local_time, meetingTime: tour.meeting_local_time,
    meetingName: tour.meeting_place_name, meetingAddress: tour.meeting_address_text,
    latitude: tour.meeting_latitude, longitude: tour.meeting_longitude,
  } : null };
}

export function travelSnapshot(
  trip: Pick<Trip, "title" | "destination_label" | "start_date" | "end_date">,
  schedule: PlanSchedule[], places: PlanPlace[], bookings: Booking[],
): SharedTrip {
  const placeById = new Map<string, SharedPlace>(places.map((place) => [place.id, {
    name: place.display_name, address: place.address_ja || place.address_text,
    latitude: place.latitude, longitude: place.longitude,
  }]));
  return {
    title: trip.title, destination: trip.destination_label, startDate: trip.start_date, endDate: trip.end_date,
    places: [...placeById.values()], bookings: bookings.map(bookingSnapshot),
    schedule: sortSchedule(schedule).flatMap((item) => item.local_date ? [{
      title: item.title, date: item.local_date, fixed_local_time: item.fixed_local_time, end_local_time: item.end_local_time ?? null, period: item.period,
      place: item.place_id ? placeById.get(item.place_id) ?? null : null, note: item.shared_note,
    }] : []).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
