import "server-only";
import type { Trip } from "./trip-details";
import { loadTripPlan, loadTripPlaces } from "./trip-plan-data";
import { loadBookings } from "./trip-booking-data";
import { travelSnapshot } from "./travel-snapshot";

export async function loadTravelSnapshot(trip: Trip) {
  const [plan, places, bookings] = await Promise.all([
    loadTripPlan(trip.id), loadTripPlaces(trip.id), loadBookings(trip.id),
  ]);
  return plan && places && bookings ? travelSnapshot(trip, plan.schedule, places.places, bookings) : null;
}
