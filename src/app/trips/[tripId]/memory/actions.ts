"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sanitizeMemoryPhoto } from "@/lib/memory-photo";
import { memoryPhotoInputError, selectedMemoryPhotos } from "@/lib/memory-photo-input";
import { memoryBucket, memoryPhotoKey, memoryStorageWriter } from "@/lib/trip-memory-data";
import { readMemoryEntry, readMemoryPhoto, visitStatuses, type MemoryPhoto, type VisitStatus } from "@/lib/trip-memory";
import { getTrip, isTripId, requireTripClient } from "@/lib/trips";

const failed = "기록을 저장하지 못했어요. 입력과 연결 항목을 확인해 주세요.";
const tooNew = "아직 다른 업로드가 진행 중일 수 있어요. 잠시 후 다시 확인해 주세요.";
const uploadDisabled = "사진 저장소가 준비되지 않았어요.";

function refresh(trip: string) {
  revalidatePath("/trips");
  revalidatePath("/trips/" + trip);
  revalidatePath("/trips/" + trip + "/edit");
  revalidatePath("/trips/" + trip + "/memory");
}

function goToDay(trip: string, day: string): never {
  refresh(trip);
  return redirect("/trips/" + trip + "/memory?date=" + day);
}

export async function saveMemoryEntry(trip: string, id: string, editing: boolean, _prior: string, form: FormData): Promise<string> {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return failed;
  const fields = readMemoryEntry(form);
  if (!fields) return "날짜, 제목과 본문을 확인해 주세요.";
  const result = editing
    ? await client.from("trip_memory_entries").update(fields).eq("trip_id", trip).eq("id", id).select("id").maybeSingle()
    : await client.from("trip_memory_entries").insert({ id, trip_id: trip, ...fields }).select("id").maybeSingle();
  if (result.error || !result.data) return failed;
  return goToDay(trip, fields.day);
}

export async function deleteMemoryEntry(trip: string, id: string, day: string): Promise<string> {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return failed;
  const result = await client.from("trip_memory_entries").delete().eq("trip_id", trip).eq("id", id).select("id").maybeSingle();
  if (result.error || !result.data) return "일기를 삭제하지 못했어요.";
  return goToDay(trip, day);
}

async function removeStoredPhoto(storage: NonNullable<ReturnType<typeof memoryStorageWriter>>, trip: string, id: string, phase: MemoryPhoto["phase"]) {
  if (phase !== "deleting") {
    const mark = await storage.from("trip_memory_photos").update({ phase: "deleting", is_cover: false })
      .eq("trip_id", trip).eq("id", id).eq("phase", phase).select("id").maybeSingle();
    if (mark.error || !mark.data) return false;
  }
  const removed = await storage.storage.from(memoryBucket).remove([memoryPhotoKey(trip, id)]);
  if (removed.error) return false;
  const record = await storage.from("trip_memory_photos").delete()
    .eq("trip_id", trip).eq("id", id).eq("phase", "deleting");
  return !record.error;
}

export async function saveMemoryPhoto(trip: string, id: string, editing: boolean, _prior: string, form: FormData): Promise<string> {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return failed;
  const fields = readMemoryPhoto(form);
  if (!fields) return "날짜, 사진 제목과 연결 항목을 확인해 주세요.";
  if (editing) {
    const result = await client.from("trip_memory_photos").update(fields)
      .eq("trip_id", trip).eq("id", id).eq("phase", "ready").select("id").maybeSingle();
    if (result.error || !result.data) return failed;
    return goToDay(trip, fields.day);
  }
  const storage = memoryStorageWriter();
  if (!storage) return uploadDisabled;
  const selected = selectedMemoryPhotos(form);
  const inputError = memoryPhotoInputError(selected);
  if (inputError) return inputError;
  const image = await sanitizeMemoryPhoto(selected[0]).catch(() => null);
  if (!image) return "3.8MB 이하의 JPEG, PNG 또는 WebP 사진을 선택해 주세요.";
  const reservation = await client.from("trip_memory_photos").insert({ id, trip_id: trip, ...fields }).select("id").maybeSingle();
  if (reservation.error?.code === "23505") return "이미 접수한 사진이에요. 페이지를 새로고침해 확인해 주세요.";
  if (reservation.error?.code === "23514") return "여행당 사진 24장, 계정당 120장까지 보관할 수 있어요.";
  if (reservation.error || !reservation.data) return failed;
  const uploaded = await storage.storage.from(memoryBucket).upload(memoryPhotoKey(trip, id), image.bytes, {
    upsert: false, contentType: "image/jpeg", cacheControl: "0",
  });
  if (uploaded.error) {
    await removeStoredPhoto(storage, trip, id, "pending");
    refresh(trip);
    return "사진을 보관하지 못했어요. 연결을 확인한 뒤 새로고침해 주세요.";
  }
  const result = await storage.from("trip_memory_photos").update({
    phase: "ready", width: image.width, height: image.height, bytes: image.bytes.byteLength,
  }).eq("trip_id", trip).eq("id", id).eq("phase", "pending").select("id").maybeSingle();
  if (result.error || !result.data) {
    // A lost response can hide a committed update. Delete only after an atomic pending-to-deleting transition.
    await removeStoredPhoto(storage, trip, id, "pending");
    refresh(trip);
    return "사진을 처리하지 못했어요. 새로고침해 보관 여부를 확인해 주세요.";
  }
  return goToDay(trip, fields.day);
}

export async function deleteMemoryPhoto(trip: string, id: string): Promise<string> {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return failed;
  const storage = memoryStorageWriter();
  if (!storage) return uploadDisabled;
  const { data: photo } = await client.from("trip_memory_photos").select("phase,day,created_at")
    .eq("trip_id", trip).eq("id", id).maybeSingle();
  if (!photo) return "이미 삭제됐거나 사진을 불러오지 못했어요.";
  if (photo.phase === "pending" && Date.now() - Date.parse(photo.created_at) < 15 * 60 * 1000) return tooNew;
  if (!await removeStoredPhoto(storage, trip, id, photo.phase)) {
    refresh(trip);
    return "삭제를 마치지 못했어요. 사진 정리를 다시 시도해 주세요.";
  }
  return goToDay(trip, photo.day);
}

export async function organizePhoto(trip: string, id: string, command: "earlier" | "later" | "cover"): Promise<string> {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return failed;
  const { data, error } = await client.rpc("organize_memory_photo", { p_trip: trip, p_id: id, p_command: command });
  if (error || !data) return "이 사진의 위치나 상태가 바뀌었어요. 새로고침해 주세요.";
  refresh(trip);
  return "";
}

export async function resetMemoryCover(trip: string, id: string): Promise<string> {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return failed;
  const result = await client.from("trip_memory_photos").update({ is_cover: false })
    .eq("trip_id", trip).eq("id", id).eq("phase", "ready").eq("is_cover", true).select("id").maybeSingle();
  if (result.error || !result.data) return "표지가 바뀌었어요. 최신 사진을 확인해 주세요.";
  refresh(trip);
  return "";
}

export async function saveVisit(trip: string, id: string, _prior: string, form: FormData): Promise<string> {
  const status = String(form.get("status")) as VisitStatus;
  const { client } = await requireTripClient();
  if (!Object.hasOwn(visitStatuses, status) || !isTripId(id) || !(await getTrip(trip)).data) return failed;
  const { error } = await client.rpc("set_trip_visit", { p_trip: trip, p_schedule: id, p_status: status });
  if (error) return failed;
  refresh(trip);
  revalidatePath("/trips/" + trip + "/itinerary");
  return "";
}

export async function sweepMemoryPhotos(trip: string): Promise<string> {
  const { client } = await requireTripClient();
  if (!(await getTrip(trip)).data) return failed;
  const storage = memoryStorageWriter();
  if (!storage) return uploadDisabled;
  const { data, error } = await client.from("trip_memory_photos").select("id,phase,created_at")
    .eq("trip_id", trip).in("phase", ["pending", "deleting"]);
  if (error) return failed;
  let left = false;
  for (const photo of data) {
    if (photo.phase === "pending" && Date.now() - Date.parse(photo.created_at) < 15 * 60 * 1000) {
      left = true;
      continue;
    }
    if (!await removeStoredPhoto(storage, trip, photo.id, photo.phase)) left = true;
  }
  refresh(trip);
  return left ? "처리 중인 일부 사진이 남았어요. 15분 뒤 다시 정리해 주세요." : "";
}
