import { redirect } from "next/navigation";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";

export default async function Page({ params }: PageProps<"/trips/[tripId]/budget">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  redirect(`/trips/${trip.id}`);
}
