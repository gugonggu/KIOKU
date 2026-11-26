import Link from "next/link";
import { BookImage, CalendarCheck, Settings } from "lucide-react";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { TripTabs } from "../editorial";

const tabRoutes = new Set(["/itinerary", "/map", "/bookings"]);

export default async function Page({ params }: PageProps<"/trips/[tripId]/more">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const href = "/trips/" + tripId;
  const groups = [
    { label: "여행 준비", icon: CalendarCheck, links: [
      { path: "/preparation", title: "준비 목록", detail: "체크리스트와 일본 여행 템플릿" },
      { path: "/share", title: "동행자 공유", detail: "링크와 공개 범위" },
      { path: "/bookings", title: "예약", detail: "항공·숙소·투어 일정" },
      { path: "/itinerary", title: "여행 일정", detail: "날짜별 일정과 후보함" },
      { path: "/map", title: "장소와 지도", detail: "저장한 장소와 길찾기" },
    ] },
    { label: "여행 수첩", icon: BookImage, links: [
      { path: "/offline", title: "오프라인 수첩", detail: "이 기기에 일정과 장소 저장" },
      { path: "/memory", title: "여행 기억", detail: "일기·사진·방문 기록" },
      { path: "/guide", title: "여행 가이드 내보내기", detail: "인쇄 또는 PDF 저장" },
    ] },
    { label: "관리", icon: Settings, links: [
      { path: "/edit", title: "여행 설정", detail: "여행 정보와 관리" },
    ] },
  ];
  return <div className="editorial-page suite-page">
    <header><Link href={href} className="quiet-link">여행 홈</Link><h1>더보기</h1><p>{trip.title}</p></header>
    <nav aria-label="여행 도구" className="editorial-paper more-groups">
      {groups.map(({ label, icon: Icon, links }) => <section className="more-group" key={label} aria-label={label}>
        <h2><Icon size={19} aria-hidden />{label}</h2>
        <ul>{links.map(({ path, title, detail }) => <li key={path} className={tabRoutes.has(path) ? "more-tab-route" : undefined}>
          <Link className="quiet-link more-entry" href={href + path}>
            <strong>{title}</strong><span className="plan-meta">{detail}</span>
          </Link>
        </li>)}</ul>
      </section>)}
    </nav>
    <TripTabs href={href} active="more" />
  </div>;
}
