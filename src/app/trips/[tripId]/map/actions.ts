"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parsePlace } from "@/lib/trip-places";
import { isTripId, requireTripClient } from "@/lib/trips";
import { mapHref } from "./links";
import { writeTripPlace } from "./place-write";

export type PlaceState = { error?: string; conflict?: boolean; duplicate?: string; existing?: string; linkCount?: number };
const changed = { error: "여행이나 장소가 다른 화면에서 변경됐어요. 최신 목록을 확인해 주세요.", conflict: true };
const failed = { error: "장소를 저장하지 못했어요. 잠시 후 다시 시도해 주세요." };

function valid(id: string, version: number | null) {
  return isTripId(id) && (version === null || (Number.isInteger(version) && version >= 1));
}

function complete(tripId: string, date: string | null, place?: string): never {
  revalidatePath(`/trips/${tripId}/map`);
  revalidatePath(`/trips/${tripId}/itinerary`);
  return redirect(mapHref(tripId, { date, place }));
}

export async function savePlace(
  tripId: string, id: string, version: number | null, date: string | null, _previous: PlaceState, form: FormData,
): Promise<PlaceState> {
  const { client } = await requireTripClient();
  if (!isTripId(tripId) || !valid(id, version)) return changed;
  const fields = parsePlace(form);
  if (typeof fields === "string") return { error: fields };
  const confirm = form.get("confirm_duplicate");
  const { data, error } = await writeTripPlace(client, tripId, id, version, fields,
    typeof confirm === "string" && isTripId(confirm) ? confirm : null);
  if (error || !data) return failed;
  if (data.status === "duplicate" && data.id) return { duplicate: data.id };
  if (data.status === "existing" && data.id) return { error: "이 장소는 이미 저장됐어요.", existing: data.id };
  if (data.status !== "saved") return changed;
  return complete(tripId, date, id);
}

export async function deletePlace(
  tripId: string, id: string, version: number, date: string | null, _previous: PlaceState, form: FormData,
): Promise<PlaceState> {
  const { client } = await requireTripClient();
  if (!isTripId(tripId) || !valid(id, version)) return changed;
  const count = form.get("confirm_count");
  if (typeof count !== "string" || !/^\d{1,9}$/.test(count)) return { error: "연결 일정 수를 확인해 주세요." };
  const { data, error } = await client.rpc("delete_trip_place", {
    p_trip: tripId, p_id: id, p_version: version, p_expected_count: Number(count),
  });
  if (error || !data) return { error: "장소를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요." };
  if (data.status === "preview") return { linkCount: data.count };
  if (data.status !== "deleted") return changed;
  return complete(tripId, date);
}
