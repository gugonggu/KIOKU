"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCalendarDate, type Trip } from "@/lib/trip-details";
import { outsideTrip, parseSchedule } from "@/lib/trip-plan";
import { parsePlace } from "@/lib/trip-places";
import { getTrip, isTripId, requireTripClient } from "@/lib/trips";
import { writeTripPlace } from "../map/place-write";
import { itineraryHref } from "./links";

export type ItineraryState = { error?: string; refresh?: boolean; outside?: { key: string; date: string } };
type Revision = { id: string; revision: number };
type Placement = "archive" | "move" | "restore" | "delete";

const conflict = { error: "여행이나 일정이 다른 화면에서 변경됐어요. 최신 정보를 확인해 주세요.", refresh: true };
const saveError = { error: "일정을 저장하지 못했어요. 입력은 유지됐어요. 다시 시도해 주세요." };

function valid({ id, revision }: Revision) {
  return isTripId(id) && Number.isInteger(revision) && revision > 0;
}

function checkOutside(trip: Trip, date: string | null, form: FormData): ItineraryState | null {
  if (!date || !outsideTrip(trip, date)) return null;
  const key = `${trip.content_version}/${date}`;
  return form.get("outside_confirmation") === key ? null : { outside: { key, date } };
}

function finish(tripId: string, date: string | null, candidates = false): never {
  revalidatePath(`/trips/${tripId}/itinerary`);
  revalidatePath(`/trips/${tripId}`);
  return redirect(itineraryHref(tripId, date, undefined, undefined, candidates));
}

export async function saveItinerary(
  tripId: string, id: string, revision: number | null, currentDate: string | null, _state: ItineraryState, form: FormData,
): Promise<ItineraryState> {
  const { client } = await requireTripClient();
  if (!isTripId(tripId) || !isTripId(id) || (revision !== null && !valid({ id, revision }))) return conflict;
  const fields = parseSchedule(form);
  if (typeof fields === "string") return { error: fields };
  const { data: trip, error: tripError } = await getTrip(tripId);
  if (!trip || tripError) return saveError;
  const warning = checkOutside(trip, fields.local_date, form);
  if (warning) return warning;

  const searchPlaceId = form.get("search_place_id");
  if (searchPlaceId) {
    if (revision !== null || typeof searchPlaceId !== "string" || !isTripId(searchPlaceId) || fields.place_id) return conflict;
    const place = parsePlace(form);
    if (typeof place === "string") return { error: place };
    if (place.provider !== "GEOAPIFY") return { error: "검색 결과를 다시 선택해 주세요." };
    const saved = await writeTripPlace(client, tripId, searchPlaceId, null, place);
    if (saved.error || !saved.data?.id) return { error: "장소를 저장하지 못했어요. 입력은 유지됐어요. 다시 시도해 주세요." };
    if (saved.data.status === "existing") {
      const { data: existing } = await client.from("trip_places").select("provider,provider_place_id")
        .eq("trip_id", tripId).eq("id", saved.data.id).maybeSingle();
      if (existing?.provider !== place.provider || existing.provider_place_id !== place.provider_place_id) return conflict;
    } else if (saved.data.status !== "saved" && saved.data.status !== "duplicate") return conflict;
    fields.place_id = saved.data.id;
    revalidatePath(`/trips/${tripId}/map`);
    revalidatePath(`/trips/${tripId}`);
  }

  const { data, error } = await client.rpc("save_itinerary_item", {
    p_trip: tripId, p_item: id, p_revision: revision, p_trip_version: trip.content_version, p_fields: fields,
  });
  if (error?.code === "23503") return { error: "이 여행에 등록된 장소를 다시 선택해 주세요." };
  if (error) return saveError;
  if (data === "existing") return { error: "이 일정은 이미 저장됐어요. 목록에서 확인해 주세요.", refresh: true };
  if (data !== "saved") return conflict;
  return finish(tripId, outsideTrip(trip, fields.local_date) ? currentDate : fields.local_date ?? currentDate, !fields.local_date);
}

export async function changePlacement(
  tripId: string, item: Revision & { archivedDate: string | null; candidate: boolean }, command: Placement,
  currentDate: string | null, _state: ItineraryState, form: FormData,
): Promise<ItineraryState> {
  const { client } = await requireTripClient();
  if (!isTripId(tripId) || !valid(item)) return conflict;
  const requested = command === "move" ? form.get("local_date") : null;
  if (command === "move" && (typeof requested !== "string" || !isCalendarDate(requested))) return { error: "옮길 날짜를 입력해 주세요." };
  const date = command === "restore" ? item.archivedDate : typeof requested === "string" ? requested : null;
  const { data: trip, error: tripError } = await getTrip(tripId);
  if (!trip || tripError) return saveError;
  const warning = checkOutside(trip, date, form);
  if (warning) return warning;

  const { data, error } = await client.rpc("place_itinerary_item", {
    p_trip: tripId, p_item: item.id, p_revision: item.revision, p_command: command, p_date: date, p_trip_version: trip.content_version,
  });
  if (error) return saveError;
  if (!data) return conflict;
  const nextDate = date && !outsideTrip(trip, date) ? date : currentDate;
  return finish(tripId, nextDate, command === "archive" || (command === "delete" && item.candidate));
}

export async function reorderItinerary(tripId: string, first: Revision, second: Revision): Promise<ItineraryState> {
  const { client } = await requireTripClient();
  if (!isTripId(tripId) || !valid(first) || !valid(second)) return conflict;
  const { data, error } = await client.rpc("swap_itinerary_items", {
    p_trip: tripId, p_first: first.id, p_first_version: first.revision, p_second: second.id, p_second_version: second.revision,
  });
  if (error) return { error: "순서를 바꾸지 못했어요. 다시 시도해 주세요." };
  if (!data) return conflict;
  revalidatePath(`/trips/${tripId}/itinerary`);
  return {};
}
