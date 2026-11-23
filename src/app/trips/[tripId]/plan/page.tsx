import { redirect } from "next/navigation";
import { isCalendarDate } from "@/lib/trip-details";
import { itineraryHref } from "../itinerary/links";

export default async function OldPlanPage({ params, searchParams }: PageProps<"/trips/[tripId]/plan">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const date = typeof query.day === "string" && isCalendarDate(query.day) ? query.day : null;
  redirect(itineraryHref(encodeURIComponent(tripId), date));
}
