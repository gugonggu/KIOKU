import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { tripFormValues } from "@/lib/trip-details";
import { memoryPhotoHref } from "@/lib/trip-memory";
import { loadMemoryCover } from "@/lib/trip-memory-data";
import { getTrip } from "@/lib/trips";
import { updateTrip } from "../../mutations";
import { TripForm } from "../../trip-form";
import { TripLoadError } from "../../trip-load-error";

import { resetMemoryCover } from "../memory/actions";
import { MemoryForm } from "../memory/memory-form";

export const metadata = { title: "여행 편집" };

export default async function EditTripPage({ params }: PageProps<"/trips/[tripId]/edit">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const cover = await loadMemoryCover(trip.id);
  const href = `/trips/${trip.id}`;
  const submit = updateTrip.bind(null, trip.id, trip.content_version);

  return (
    <>
      <Link href={href} className="quiet-link"><ArrowLeft size={17} aria-hidden="true" />여행 수첩으로</Link>
      <h1>여행 편집</h1>
      <TripForm action={submit} initial={tripFormValues(trip)} cancelHref={href} submitLabel="변경사항 저장" />
      <section className="trip-management" aria-labelledby="trip-cover-heading">
        <h2 id="trip-cover-heading">여행 표지</h2>
        {cover ? <>
          <Image unoptimized className="memory-image memory-preview" src={memoryPhotoHref(trip.id, cover.id)}
            alt={cover.title} width={cover.width ?? 240} height={cover.height ?? 160} />
          <MemoryForm action={resetMemoryCover.bind(null, trip.id, cover.id)} label="기본 표지로 되돌리기" />
        </> : <p>기본 표지를 사용 중이에요.</p>}
        <Link href={href + "/memory"} className="quiet-link">앨범에서 대표 사진 고르기</Link>
      </section>
      <section className="trip-management" aria-labelledby="trip-management-heading">
        <h2 id="trip-management-heading">여행 관리</h2>
        <Link href={href + "/delete"} className="quiet-link danger-link">여행 삭제</Link>
      </section>
    </>
  );
}
