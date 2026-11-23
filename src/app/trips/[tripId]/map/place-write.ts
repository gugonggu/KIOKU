import type { PlaceFields } from "@/lib/database.types";
import type { requireTripClient } from "@/lib/trips";

type TripClient = Awaited<ReturnType<typeof requireTripClient>>["client"];

export function writeTripPlace(client: TripClient, tripId: string, id: string, version: number | null,
  fields: PlaceFields, confirm: string | null = null) {
  return client.rpc("save_trip_place", { p_trip: tripId, p_id: id, p_version: version, p_fields: fields, p_confirm: confirm });
}
