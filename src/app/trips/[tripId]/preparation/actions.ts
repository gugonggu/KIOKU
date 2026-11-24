"use server";

import { revalidatePath } from "next/cache";
import { isCalendarDate } from "@/lib/trip-details";
import { preparationCategories, preparationTemplate, type PreparationCategory } from "@/lib/trip-preparation";
import { getTrip, isTripId, requireTripClient } from "@/lib/trips";

export async function updatePreparation(tripId: string, _message: string, data: FormData) {
  const trip = await getTrip(tripId);
  if (trip.error || !trip.data) return "여행을 불러오지 못했어요.";
  const { client } = await requireTripClient();
  const command = data.get("command");
  const id = String(data.get("id") ?? "");
  if (command !== "add" && command !== "japan" && command !== "winter" && !isTripId(id)) return "항목을 다시 선택해 주세요.";
  let result;
  if (command === "japan" || command === "winter") {
    result = await client.rpc("apply_preparation_template", { p_trip: tripId, p_items: preparationTemplate(command) });
  } else if (command === "delete") {
    result = await client.from("trip_preparation").delete().eq("trip_id", tripId).eq("id", id);
  } else if (command === "up" || command === "down") {
    result = await client.rpc("move_preparation", { p_trip: tripId, p_id: id, p_direction: command === "up" ? -1 : 1 });
  } else if (command === "done" || command === "open") {
    result = await client.from("trip_preparation").update({ done: command === "done" }).eq("trip_id", tripId).eq("id", id);
  } else if (command === "add" || command === "edit") {
    const title = String(data.get("title") ?? "").trim();
    const category = String(data.get("category") ?? "");
    const note = String(data.get("note") ?? "").trim();
    const date = String(data.get("due_date") ?? "");
    if (!title || title.length > 120 || note.length > 600 || !Object.hasOwn(preparationCategories, category) || (date && !isCalendarDate(date))) {
      return "이름, 분류, 메모와 마감일을 확인해 주세요.";
    }
    const fields = { title, category: category as PreparationCategory, note: note || null, due_date: date || null };
    result = command === "add" ? await client.from("trip_preparation").insert({ ...fields, trip_id: tripId }) :
      await client.from("trip_preparation").update(fields).eq("trip_id", tripId).eq("id", id);
  } else {
    return "항목을 다시 선택해 주세요.";
  }
  if (result.error) return "준비 목록을 저장하지 못했어요. 다시 시도해 주세요.";
  revalidatePath("/trips/" + tripId + "/preparation");
  revalidatePath("/trips/" + tripId);
  return "준비 목록을 저장했어요.";
}
