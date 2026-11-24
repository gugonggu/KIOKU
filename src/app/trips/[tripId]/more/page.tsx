import Link from "next/link";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { TripTabs } from "../editorial";

export default async function Page({ params }: PageProps<"/trips/[tripId]/more">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const href = "/trips/" + tripId;
  return <div className="editorial-page suite-page">
    <header><Link href={href} className="quiet-link">여행 홈</Link><h1>더보기</h1><p>{trip.title}</p></header>
    <nav aria-label="여행 관리" className="editorial-paper suite-stack">
      <Link className="quiet-link" href={href + "/preparation"}>여행 준비</Link>
      <Link className="quiet-link" href={href + "/offline"}>오프라인 수첩</Link>
      <Link className="quiet-link" href={href + "/budget"}>예산과 경비</Link>
      <Link className="quiet-link" href={href + "/edit"}>여행 정보</Link>
      <Link className="quiet-link" href={href + "/share"}>동행자 공유</Link>
    </nav>
    <TripTabs href={href} active="more" />
  </div>;
}
