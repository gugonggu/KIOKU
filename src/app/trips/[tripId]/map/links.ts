import type { PlaceFilter } from "@/lib/trip-places";

export type MapView = "list" | "map";
export type MapContext = { date?: string | null; filter?: PlaceFilter; place?: string; view?: MapView; query?: string; route?: boolean };

export function mapHref(tripId: string, options: MapContext & { mode?: "add" | "edit" | "delete" } = {}) {
  const query = new URLSearchParams();
  if (options.date) query.set("date", options.date);
  if (options.filter && options.filter !== "all") query.set("filter", options.filter);
  if (options.place) query.set("place", options.place);
  if (options.mode) query.set("mode", options.mode);
  if (options.view === "map" || (options.view === "list" && options.place)) query.set("view", options.view);
  if (options.query?.trim()) query.set("q", options.query);
  if (options.route) query.set("route", "1");
  const search = query.toString();
  return `/trips/${tripId}/map${search ? `?${search}` : ""}`;
}
