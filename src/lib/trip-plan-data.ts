import type { PlaceRow, ScheduleRow } from "./database.types";
import { requireTripClient } from "./trips";

export const scheduleColumns = "id,title,kind,time_mode,local_date,fixed_local_time,period,place_id,private_note,shared_note,revision,sort_order,archived_date";
export const placeColumns = "id,name,address,latitude,longitude,notes,content_version";

export type PlanSchedule = Pick<ScheduleRow, "id" | "revision" | "sort_order" | "archived_date"> & import("./database.types").ScheduleFields;
export type PlanPlace = Omit<PlaceRow, "trip_id" | "updated_at">;

async function readRows<Row>(read: (start: number, end: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
  const rows: Row[] = [];
  const batchSize = 100;
  for (let start = 0; ; start += batchSize) {
    const { data, error } = await read(start, start + batchSize - 1);
    if (error || !data) return null;
    rows.push(...data);
    if (data.length < batchSize) return rows;
  }
}

export async function loadTripPlan(tripId: string) {
  const { client } = await requireTripClient();
  const [schedule, places] = await Promise.all([
    readRows((start, end) => client.from("itinerary_items").select(scheduleColumns).eq("trip_id", tripId)
      .order("local_date").order("id").range(start, end)),
    readRows((start, end) => client.from("trip_places").select("id,name,address").eq("trip_id", tripId)
      .order("name").order("id").range(start, end)),
  ]);
  return schedule && places ? { schedule, places } : null;
}
