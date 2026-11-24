import Link from "next/link";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../../trip-load-error";
import { TripTabs } from "../../editorial";
import { handleScheduleImport } from "./actions";
import { ScheduleImportForm } from "./import-form";

export const metadata = { title: "일정 가져오기" };

export default async function Page({ params }: PageProps<"/trips/[tripId]/itinerary/import">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const href = "/trips/" + tripId;
  return <div className="editorial-page suite-page">
    <header>
      <Link className="quiet-link" href={href + "/itinerary"}>여행 일정</Link>
      <h1>일정 가져오기</h1>
      <p>{trip.title}의 일정에 JSON 목록을 최대 30개 추가할 수 있어요. 같은 제목·날짜·시간의 일정은 건너뛰어요.</p>
    </header>
    <ScheduleImportForm action={handleScheduleImport.bind(null, tripId)} />
    <TripTabs href={href} active="itinerary" />
  </div>;
}
