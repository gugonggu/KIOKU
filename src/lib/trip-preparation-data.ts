import "server-only";
import { readRows } from "./trip-plan-data";
import { requireTripClient } from "./trips";

export async function loadPreparation(tripId: string) {
  const { client } = await requireTripClient();
  return readRows((start, end) => client.from("trip_preparation").select("*").eq("trip_id", tripId)
    .order("sort_order").order("id").range(start, end));
}
