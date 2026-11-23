import { notFound } from "next/navigation";
import { requiresFragmentShareLinks } from "@/lib/auth-config";
import { isCalendarDate } from "@/lib/trip-details";
import { loadSharedTrip } from "@/lib/trip-share-data";
import { SharedGuide } from "../shared-guide";

export async function SharedPage({ token, day }: { token: string; day?: string }) {
  if (requiresFragmentShareLinks() || (day && !isCalendarDate(day))) notFound();
  const trip = await loadSharedTrip(token);
  if (!trip) notFound();
  return <SharedGuide trip={trip} requested={day} href={(date) => "/s/" + token + "/day/" + date + "#guide-itinerary"} />;
}
