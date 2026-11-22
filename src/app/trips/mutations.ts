"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseTripDetails, type TripFieldErrors } from "@/lib/trip-details";
import { isTripId, requireTripClient } from "@/lib/trips";

export type TripMutationState = {
  message?: string;
  errors?: TripFieldErrors;
  conflict?: boolean;
  savedTripHref?: string;
};

const saveError = "여행을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
const changedTrip = "여행 정보가 바뀌었거나 여행을 찾을 수 없어요. 최신 정보를 확인해 주세요.";

export async function createTrip(id: string, _previous: TripMutationState, formData: FormData): Promise<TripMutationState> {
  const { client, ownerId } = await requireTripClient();
  if (!isTripId(id)) return { message: saveError };
  const input = parseTripDetails(formData);
  if ("errors" in input) return { message: "입력한 내용을 확인해 주세요.", errors: input.errors };

  const { error } = await client.from("trips").upsert(
    { id, ...input.fields }, { onConflict: "id", ignoreDuplicates: true, defaultToNull: false },
  );
  if (error) return { message: saveError };

  const { data } = await client.from("trips").select("id,title,destination_label,start_date,end_date,traveler_count")
    .eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (!data) return { message: saveError };

  const fields = input.fields;
  if (
    data.title !== fields.title || data.destination_label !== fields.destination_label
    || data.start_date !== fields.start_date || data.end_date !== fields.end_date
    || data.traveler_count !== fields.traveler_count
  ) {
    revalidatePath("/trips", "layout");
    return {
      message: "첫 요청으로 여행이 이미 저장됐어요. 저장된 여행에서 정보를 편집할 수 있어요.",
      conflict: true,
      savedTripHref: `/trips/${data.id}`,
    };
  }

  revalidatePath("/trips", "layout");
  redirect(`/trips/${data.id}`);
}

export async function updateTrip(
  id: string, version: number, _previous: TripMutationState, formData: FormData,
): Promise<TripMutationState> {
  const { client, ownerId } = await requireTripClient();
  if (!isTripId(id) || !Number.isInteger(version) || version < 1) return { message: changedTrip, conflict: true };
  const input = parseTripDetails(formData);
  if ("errors" in input) return { message: "입력한 내용을 확인해 주세요.", errors: input.errors };

  const { error, data } = await client.from("trips").update(input.fields)
    .eq("owner_id", ownerId).eq("id", id).eq("content_version", version).select("id").maybeSingle();
  if (error) return { message: saveError };
  if (!data) return { message: changedTrip, conflict: true };

  revalidatePath("/trips", "layout");
  redirect(`/trips/${data.id}`);
}

export async function deleteTrip(id: string, version: number): Promise<TripMutationState> {
  const { client, ownerId } = await requireTripClient();
  if (!isTripId(id) || !Number.isInteger(version) || version < 1) return { message: changedTrip, conflict: true };

  const { error, data } = await client.from("trips").delete()
    .eq("owner_id", ownerId).eq("id", id).eq("content_version", version).select("id").maybeSingle();
  if (error) return { message: "여행을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요." };
  if (!data) return { message: changedTrip, conflict: true };

  revalidatePath("/trips", "layout");
  redirect("/trips");
}
