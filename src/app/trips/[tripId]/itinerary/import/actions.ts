"use server";

import { revalidatePath } from "next/cache";
import { importPreview, parseTripImport, type ImportPreviewRow } from "@/lib/trip-import";
import { loadTripPlan } from "@/lib/trip-plan-data";
import { getTrip, requireTripClient } from "@/lib/trips";

export type ScheduleImportState = {
  message?: string;
  input?: string;
  version?: number;
  preview?: ImportPreviewRow[];
  complete?: boolean;
};

export async function handleScheduleImport(tripId: string, previous: ScheduleImportState, form: FormData): Promise<ScheduleImportState> {
  const input = String(form.get("schedule_json") ?? "");
  const parsed = parseTripImport(input);
  if ("error" in parsed) return { message: parsed.error };
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return { message: "여행을 확인해 주세요." };

  if (form.get("intent") !== "apply") {
    const plan = await loadTripPlan(tripId);
    if (!plan) return { message: "기존 일정을 확인하지 못했어요. 다시 시도해 주세요." };
    return { input, version: trip.content_version, preview: importPreview(parsed.rows, plan.schedule, trip) };
  }
  if (previous.input !== input || previous.version !== trip.content_version || !previous.preview) {
    return { message: "기간이나 입력 내용이 바뀌었어요. 다시 미리보기 해 주세요." };
  }
  const { client } = await requireTripClient();
  const { data, error: saveError } = await client.rpc("import_trip_schedule", {
    p_trip: tripId, p_version: trip.content_version, p_rows: parsed.rows,
  });
  if (saveError || !data) return { message: "일정을 가져오지 못했어요. 미리보기부터 다시 확인해 주세요." };
  revalidatePath("/trips/" + tripId + "/itinerary");
  revalidatePath("/trips/" + tripId);
  return { message: `${data.inserted}개 추가 · 중복 ${data.skipped}개 건너뜀`, complete: true };
}
