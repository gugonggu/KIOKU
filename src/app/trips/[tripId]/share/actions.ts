"use server";

import { revalidatePath } from "next/cache";
import { getAuthConfig, requiresFragmentShareLinks } from "@/lib/auth-config";
import { isCalendarDate } from "@/lib/trip-details";
import { loadShareSettings } from "@/lib/trip-share-data";
import { issueShareToken, readShareToken, shareKey } from "@/lib/trip-share-token";
import { getTrip, isTripId, requireTripClient } from "@/lib/trips";

export type ShareActionState = { error?: string; message?: string };

export async function saveShare(tripId: string, revision: number, _state: ShareActionState,
  form: FormData): Promise<ShareActionState> {
  if (!isTripId(tripId) || !Number.isSafeInteger(revision) || revision < 0) return { error: "공유 상태를 다시 확인해 주세요." };
  const mode = form.get("mode");
  if (mode !== "issue" && mode !== "settings" && mode !== "stop") return { error: "공유 작업을 다시 선택해 주세요." };
  const expiry = form.get("expiry");
  if (mode !== "stop" && expiry && (typeof expiry !== "string" || !isCalendarDate(expiry))) {
    return { error: "만료일을 확인해 주세요." };
  }
  const { data: trip, error: tripError } = await getTrip(tripId);
  if (!trip || tripError) return { error: "여행을 확인하지 못했어요." };
  const key = mode === "issue" ? shareKey() : null;
  if (mode === "issue" && !key) return { error: "공유 링크 암호화 설정을 확인해 주세요." };
  const issued = key ? issueShareToken(tripId, key) : null;
  const { client } = await requireTripClient();
  const { data, error } = await client.rpc("write_share_settings", {
    p_trip: tripId, p_revision: revision, p_mode: mode, p_expiry: mode !== "stop" && typeof expiry === "string" ? expiry || null : null,
    p_bookings: form.has("bookings"), p_notes: form.has("notes"), p_hash: issued?.hash ?? null, p_cipher: issued?.encryptedToken ?? null,
  });
  if (error) return { error: "공유 상태를 저장하지 못했어요. 다시 시도해 주세요." };
  revalidatePath("/trips/" + tripId + "/share");
  if (!data) return { error: "공유 상태가 바뀌었어요. 최신 설정을 확인한 뒤 다시 시도해 주세요." };
  return { message: mode === "issue" ? "공유 링크를 발급했어요." : mode === "stop" ? "온라인 공유를 중지했어요." : "공유 설정을 저장했어요." };
}

export async function revealShare(tripId: string) {
  if (!isTripId(tripId)) return { error: "링크를 확인할 수 없어요." };
  const settings = await loadShareSettings(tripId);
  if (!settings?.enabled || settings.expired || !settings.encryptedToken) return { error: "사용할 수 있는 공유 링크가 없어요." };
  const key = shareKey();
  const config = getAuthConfig();
  const token = key ? readShareToken(settings.encryptedToken, tripId, key) : null;
  if (!token || !config) return { error: "링크를 다시 표시할 수 없어요. 암호화 키를 확인하거나 새 링크를 발급해 주세요." };
  return { url: new URL((requiresFragmentShareLinks(config.appUrl) ? "/s#" : "/s/") + token, config.appUrl).href };
}
