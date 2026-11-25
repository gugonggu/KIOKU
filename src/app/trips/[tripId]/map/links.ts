import type { PlaceFilter } from "@/lib/trip-places";

export function mapHref(tripId: string, options: { date?: string | null; filter?: PlaceFilter; place?: string; mode?: "add" | "edit" | "delete"; view?: "map" } = {}) {
  const query = new URLSearchParams();
  if (options.date) query.set("date", options.date);
  if (options.filter && options.filter !== "all") query.set("filter", options.filter);
  if (options.place) query.set("place", options.place);
  if (options.mode) query.set("mode", options.mode);
  if (options.view) query.set("view", options.view);
  const search = query.toString();
  return `/trips/${tripId}/map${search ? `?${search}` : ""}`;
}
