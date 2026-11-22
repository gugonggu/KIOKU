import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { tripFormValues } from "@/lib/trip-details";
import { getTrip } from "@/lib/trips";
import { updateTrip } from "../../mutations";
import { TripForm } from "../../trip-form";
import { TripLoadError } from "../../trip-load-error";

export const metadata = { title: "여행 편집" };

export default async function EditTripPage({ params }: PageProps<"/trips/[tripId]/edit">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const href = `/trips/${trip.id}`;
  const submit = updateTrip.bind(null, trip.id, trip.content_version);

  return (
    <>
      <Link href={href} className="quiet-link"><ArrowLeft size={17} aria-hidden="true" />여행 수첩으로</Link>
      <h1>여행 편집</h1>
      <TripForm action={submit} initial={tripFormValues(trip)} cancelHref={href} submitLabel="변경사항 저장" />
    </>
  );
}
