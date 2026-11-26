"use server";
import { revalidatePath } from "next/cache";
import { coverThemes } from "@/lib/trip-cover";
import { isTripId, requireTripClient } from "@/lib/trips";

export async function saveTripCover(trip: string, version: number, _state: string, form: FormData): Promise<string> {
  const { client } = await requireTripClient();
  const choice = form.get("reset") === "1" ? "theme:auto" : String(form.get("cover"));
  const [kind, value] = choice.split(":");
  if (!isTripId(trip) || (kind !== "theme" && kind !== "photo") ||
      (kind === "theme" ? !Object.hasOwn(coverThemes,value) : !isTripId(value))) return "표지를 다시 선택해 주세요.";
  const { data, error } = await client.rpc("set_trip_cover", {
    p_trip: trip, p_version: version, p_theme: kind === "theme" ? value : "auto", p_photo: kind === "photo" ? value : null,
  });
  if (error || !data) return "표지를 저장하지 못했어요. 최신 화면에서 다시 선택해 주세요.";
  for (const path of ["/trips", `/trips/${trip}`, `/trips/${trip}/edit`, `/trips/${trip}/memory`]) revalidatePath(path);
  return "표지를 저장했어요.";
}
