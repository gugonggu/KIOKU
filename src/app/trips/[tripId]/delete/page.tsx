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
      <p>일정, 장소, 예약, 준비 목록, 경비, 여행 기억도 함께 삭제되고 공유 링크가 끊겨요.</p>
      <p>사진이 남아 있다면 여행 기억에서 먼저 정리해 주세요.</p>
      <p>이 기기의 오프라인 수첩은 온라인에서 내 여행을 열면 정리돼요. 다른 기기는 각각 정리가 필요해요.</p>
      <DeleteTripForm action={submit} tripHref={`/trips/${trip.id}`} />
    </section>
  );
}
