export type ItineraryMode = "add" | "edit" | "move" | "restore" | "delete";

export function itineraryHref(tripId: string, date: string | null, mode?: ItineraryMode, id?: string, candidates = false) {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  if (mode) query.set("mode", mode);
  if (id) query.set("id", id);
  if (candidates) query.set("view", "candidates");
  const search = query.toString();
  return `/trips/${tripId}/itinerary${search ? `?${search}` : ""}`;
}
