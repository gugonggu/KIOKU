import type { PlaceRow, ScheduleRow } from "./database.types";
import { requireTripClient } from "./trips";

export const scheduleColumns = "id,title,kind,time_mode,local_date,fixed_local_time,period,place_id,booking_id,private_note,shared_note,revision,sort_order,archived_date";
export const placeColumns = "id,display_name,name_ko,name_ja,name_en,address_text,address_ja,latitude,longitude,notes,provider,provider_place_id,content_version";

export type PlanSchedule = Pick<ScheduleRow, "id" | "revision" | "sort_order" | "archived_date" | "booking_id"> & import("./database.types").ScheduleFields;
export type PlanPlace = Omit<PlaceRow, "trip_id" | "created_at" | "updated_at">;
export type PlaceVisit = Pick<ScheduleRow, "id" | "place_id" | "local_date" | "title" | "time_mode" | "fixed_local_time" | "period" | "sort_order">;

export async function readRows<Row>(read: (start: number, end: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
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
    readRows((start, end) => client.from("trip_places").select("id,name:display_name,address:address_text").eq("trip_id", tripId)
      .order("display_name").order("id").range(start, end)),
  ]);
  return schedule && places ? { schedule, places } : null;
}

export async function loadTripPlaces(tripId: string) {
  const { client } = await requireTripClient();
  const [places, links] = await Promise.all([
    readRows((start, end) => client.from("trip_places").select(placeColumns).eq("trip_id", tripId)
      .order("display_name").order("id").range(start, end)),
    readRows((start, end) => client.from("itinerary_items").select("id,place_id,local_date,title,time_mode,fixed_local_time,period,sort_order").eq("trip_id", tripId)
      .not("place_id", "is", null).order("local_date").order("id").range(start, end)),
  ]);
  return places && links ? { places, links } : null;
}
