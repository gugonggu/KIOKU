import { notFound } from "next/navigation";
import { requiresFragmentShareLinks } from "@/lib/auth-config";
import { isCalendarDate } from "@/lib/trip-details";
import { loadSharedTrip } from "@/lib/trip-share-data";
import { SharedGuide } from "../shared-guide";
import { SharedUnavailable } from "../shared-unavailable";

export async function SharedPage({ token, day }: { token: string; day?: string }) {
  if (requiresFragmentShareLinks() || (day && !isCalendarDate(day))) notFound();
  const result = await loadSharedTrip(token);
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") return <SharedUnavailable />;
  return <SharedGuide trip={result.trip} requested={day} href={(date) => "/s/" + token + "/day/" + date + "#guide-itinerary"} />;
}
