import { getTrip } from "@/lib/trips";
import { deleteTrip } from "../../mutations";
import { TripLoadError } from "../../trip-load-error";
import { DeleteTripForm } from "./delete-form";

export const metadata = { title: "여행 삭제" };

export default async function DeleteTripPage({ params }: PageProps<"/trips/[tripId]/delete">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const submit = deleteTrip.bind(null, trip.id, trip.content_version);

  return (
    <section className="delete-trip" aria-labelledby="delete-heading">
      <h1 id="delete-heading">여행을 삭제할까요?</h1>
      <p className="intro"><strong>{trip.title}</strong> 여행이 내 여행 목록에서 삭제돼요.</p>
      <p>삭제한 여행은 되돌릴 수 없어요.</p>
      <DeleteTripForm action={submit} tripHref={`/trips/${trip.id}`} />
    </section>
  );
}
