import { ArrowLeft, PencilLine } from "lucide-react";
import Link from "next/link";
import { Cover } from "@/components/cover";
import { japanDate, tripStatus, tripStatuses } from "@/lib/trip-details";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../trip-load-error";
import { TripSummary } from "../trip-summary";

export const metadata = { title: "여행 수첩" };

export default async function TripPage({ params }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const status = tripStatus(trip, japanDate());
  const href = `/trips/${trip.id}`;

  return (
    <>
      <Link href="/trips" className="quiet-link"><ArrowLeft size={17} aria-hidden="true" />내 여행으로</Link>
      <article className="trip-home">
        <Cover compact label="산과 해가 그려진 기본 여행 표지" />
        <div className="trip-home-body">
          {status !== "unscheduled" && <span className="trip-status">{tripStatuses[status].label}</span>}
          <h1>{trip.title}</h1>
          <TripSummary trip={trip} />
          <div className="state-actions">
            {status === "unscheduled" && <Link href={`${href}/edit#trip-dates`} className="primary-button">날짜 정하기</Link>}
            <Link href={`${href}/edit`} className={status === "unscheduled" ? "quiet-link" : "primary-button"}>
              <PencilLine size={17} aria-hidden="true" />여행 편집
            </Link>
          </div>
        </div>
      </article>
      <div className="state-actions">
        <Link href={`${href}/itinerary`} className="primary-button">일정 보기</Link>
        <Link href={`${href}/itinerary?view=candidates`} className="quiet-link">후보함</Link>
        <Link href={`${href}/map`} className="quiet-link">장소와 지도</Link>
      </div>
      <Link href={`${href}/delete`} className="quiet-link danger-link">여행 삭제</Link>
    </>
  );
}
