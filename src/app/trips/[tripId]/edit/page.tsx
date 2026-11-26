import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { tripFormValues } from "@/lib/trip-details";
import { loadTripMemory } from "@/lib/trip-memory-data";
import { getTrip } from "@/lib/trips";
import { updateTrip } from "../../mutations";
import { TripForm } from "../../trip-form";
import { TripLoadError } from "../../trip-load-error";

import { CoverEditor } from "./cover-editor";
import { saveTripCover } from "./cover-actions";

export const metadata = { title: "여행 편집" };

export default async function EditTripPage({ params }: PageProps<"/trips/[tripId]/edit">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const memory = await loadTripMemory(trip.id);
  const photos = memory?.photos.filter(photo => photo.phase === "ready") ?? [];
  const cover = photos.find(photo => photo.is_cover);
  const href = `/trips/${trip.id}`;
  const submit = updateTrip.bind(null, trip.id, trip.content_version);

  return (
    <>
      <Link href={href} className="quiet-link"><ArrowLeft size={17} aria-hidden="true" />여행 수첩으로</Link>
      <h1>여행 편집</h1>
      <TripForm action={submit} initial={tripFormValues(trip)} cancelHref={href} submitLabel="변경사항 저장" />
      <section className="trip-management" aria-labelledby="trip-cover-heading">
        <h2 id="trip-cover-heading">여행 표지</h2>
        {memory ? <CoverEditor action={saveTripCover.bind(null,trip.id,trip.content_version)} tripId={trip.id}
          destination={trip.destination_label} theme={trip.cover_theme} photos={photos} currentPhoto={cover?.id} />
          : <p role="alert">표지 사진을 불러오지 못했어요. 새로고침해 주세요.</p>}
        <Link href={href + "/memory"} className="quiet-link">앨범에서 대표 사진 고르기</Link>
      </section>
      <section className="trip-management" aria-labelledby="trip-management-heading">
        <h2 id="trip-management-heading">여행 관리</h2>
        <Link href={href + "/delete"} className="quiet-link danger-link">여행 삭제</Link>
      </section>
    </>
  );
}
