import { ArrowLeft, CalendarDays, ChevronRight, MapPin, PencilLine, Share2, UsersRound } from "lucide-react";
import Link from "next/link";
import { Blossom } from "@/components/brand";
import { Cover } from "@/components/cover";
import { loadBookings, loadBookingSummaries } from "@/lib/trip-booking-data";
import { bookingKinds, bookingOccursOn } from "@/lib/trip-bookings";
import { dateLabel } from "@/lib/trip-details";
import { nextFixedSchedule, nextHomeRefresh, sortSchedule, tripHomeDay } from "@/lib/trip-plan";
import { loadTripPlan } from "@/lib/trip-plan-data";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../trip-load-error";
import { TripSummary } from "../trip-summary";
import { DayCards, timeLabel, TripTabs } from "./editorial";
import { itineraryEntryHref, itineraryHref } from "./itinerary/links";
import { mapHref } from "./map/links";
import { BookingBadge, BookingKindLabel } from "./bookings/booking-card";
import { bookingsHref } from "./bookings/links";
import { TripClock } from "./trip-clock";

export const metadata = { title: "여행 수첩" };

export default async function TripPage({ params }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const now = new Date();
  const { today, date, status, offset } = tripHomeDay(trip, now);
  const active = status === "active";
  const [plan, dailyBookings, bookingSummaries] = await Promise.all([
    loadTripPlan(trip.id), active ? loadBookings(trip.id) : null, active ? null : loadBookingSummaries(trip.id),
  ]);
  const bookings = active ? dailyBookings : bookingSummaries;
  const href = `/trips/${trip.id}`;
  const scheduleHref = itineraryHref(trip.id, date);
  const groups = new Map<string, string>();
  for (const item of sortSchedule(plan?.schedule ?? [])) {
    if (item.local_date && !groups.has(item.local_date)) groups.set(item.local_date, item.title);
  }
  const dayItems = date ? sortSchedule(plan?.schedule.filter((item) => item.local_date === date) ?? []) : [];
  const nextItem = active ? nextFixedSchedule(dayItems, now) : undefined;
  const nextPlace = nextItem?.place_id ? plan?.places.find((place) => place.id === nextItem.place_id) : undefined;
  const linkedBookings = new Set(dayItems.map(({ booking_id }) => booking_id));
  const todayBookings = dailyBookings?.filter((booking) => bookingOccursOn(booking, today, linkedBookings.has(booking.id)));
  const refreshAt = active || status === "upcoming" ? nextHomeRefresh(today, nextItem?.fixed_local_time) : null;
  const candidateCount = plan?.schedule.filter((item) => !item.local_date).length;
  const winterCover = /삿포로|홋카이도|札幌|北海道|sapporo|hokkaido/i.test(trip.destination_label);

  return <div className="editorial-page editorial-overview">
    {refreshAt !== null && <TripClock refreshAt={refreshAt} />}
    <div className="editorial-breadcrumb">
      <Link href="/trips" className="quiet-link"><ArrowLeft size={16} aria-hidden />내 여행으로</Link>
      <div className="state-actions">
        <Link href={`${href}/share`} className="quiet-link"><Share2 size={16} aria-hidden />여행 공유</Link>
        <Link href={`${href}/edit`} className="quiet-link"><PencilLine size={16} aria-hidden />여행 편집</Link>
      </div>
    </div>
    <article className="editorial-hero">
      <div role="img" aria-label={winterCover ? "겨울 거리의 기본 여행 표지" : "산 풍경의 기본 여행 표지"}
        className={`editorial-cover${winterCover ? "" : " editorial-cover-neutral"}`}>
        {!winterCover && <Cover />}
      </div>
      <div className="editorial-hero-content">
        <p className="editorial-kicker">일본 여행 수첩</p>
        <h1>{trip.title}</h1>
        {status === "upcoming" && <p className="plan-meta">출발까지 D-{offset}</p>}
        {active && <p className="plan-meta">Day {offset} · 일본 현지 오늘</p>}
        {status === "past" && <p className="plan-meta">여행 종료 · 기록 보기</p>}
        <TripSummary trip={trip} showTravelers={!plan} />
        {!date && <Link href={`${href}/edit#trip-dates`} className="quiet-link">날짜 정하기</Link>}
        {date && <Link href={scheduleHref} className="quiet-link editorial-hero-shortcut">
          {date === today ? "오늘 일정 바로가기" : "이날 일정 바로가기"}<ChevronRight size={15} aria-hidden />
        </Link>}
      </div>
    </article>
    {active && plan && <section className="editorial-paper editorial-up-next" aria-labelledby="trip-next-heading">
      <h2 id="trip-next-heading">다음 정시 일정</h2>
      {nextItem ? <Link className="quiet-link" href={itineraryEntryHref(trip.id, nextItem, date)}>
        <span className="editorial-time">{timeLabel(nextItem)}</span><strong>{nextItem.title}</strong>
        <ChevronRight size={16} aria-hidden />
      </Link> : <p className="plan-meta">{dayItems.length ? "오늘 남은 시간 지정 일정이 없어요." : "오늘 등록된 일정이 없어요."}</p>}
      {dayItems.some((item) => item.time_mode !== "FIXED") && <p className="plan-meta">시간대·시간 미정 일정은 오늘 일정에서 확인하세요.</p>}
      {nextPlace && <Link className="quiet-link" href={mapHref(trip.id, { date, filter: "date", place: nextPlace.id })}>
        <MapPin size={16} aria-hidden /><strong>{nextPlace.name}</strong>
      </Link>}
    </section>}
    {active && <section className="editorial-paper booking-home" aria-labelledby="today-bookings-heading">
      <h2 id="today-bookings-heading">오늘 확인할 예약</h2>
      {todayBookings?.length ? <ul>{todayBookings.map((booking) => <li key={booking.id}>
        <Link className="booking-home-entry" href={bookingsHref(trip.id, today, "view", booking.id)}>
          <span className="booking-home-kind"><BookingKindLabel kind={booking.kind} /></span>
          <strong>{booking.title}</strong><BookingBadge status={booking.status} />
        </Link>
      </li>)}</ul> : <p className="plan-meta">{todayBookings ? "오늘 확인할 예약이 없어요." : "오늘 예약을 불러오지 못했어요."}</p>}
    </section>}
    {plan ? <dl className="editorial-stats" aria-label="여행 요약">
      <div><CalendarDays aria-hidden /><dt>일정</dt><dd>{plan.schedule.length}개</dd></div>
      <div><MapPin aria-hidden /><dt>저장한 장소</dt><dd>{plan.places.length}개</dd></div>
      {trip.traveler_count !== null && <div><UsersRound aria-hidden /><dt>여행 인원</dt><dd>{trip.traveler_count}명</dd></div>}
    </dl> : <p className="notice notice-error" role="status">일정과 장소 요약을 불러오지 못했어요.</p>}
    <section className="editorial-section" aria-labelledby="trip-days-heading">
      <div className="editorial-section-heading">
        <h2 id="trip-days-heading">여행 일정 한눈에 보기</h2>
        <Link href={scheduleHref} className="quiet-link">일정 보기<ChevronRight size={15} aria-hidden /></Link>
      </div>
      {date ? <DayCards trip={trip} date={date} summaries={plan ? groups : undefined} /> :
        <p className="plan-empty">여행 날짜가 정해지면 날짜별 계획을 여기에서 볼 수 있어요.</p>}
    </section>
    <div className="editorial-overview-bottom">
      <section className="editorial-paper editorial-preview" aria-labelledby="trip-preview-heading">
        <Blossom className="editorial-sprig" />
        <h2 id="trip-preview-heading">{date === today ? "오늘 일정" : date ? "선택한 날의 일정" : "후보함"}</h2>
        {date && <p className="plan-meta">{dateLabel(date)} · 일본 현지 날짜</p>}
        {plan && dayItems.length > 0 ? <ul>{dayItems.slice(0, 3).map((item) =>
          <li key={item.id}><span className="editorial-time">{timeLabel(item)}</span><strong>{item.title}</strong></li>)}</ul>
          : plan && <p className="plan-meta">{date ? "이 날짜에 등록된 일정이 없어요." : `날짜를 정하지 않은 일정 ${candidateCount}개`}</p>}
        <Link href={date ? scheduleHref : itineraryHref(trip.id, null, undefined, undefined, true)} className="quiet-link">
          {date ? "이날 일정 열기" : "후보함 열기"}<ChevronRight size={16} aria-hidden />
        </Link>
      </section>
      <section className="editorial-paper editorial-home-places">
        <div className="editorial-icon"><MapPin size={22} aria-hidden /></div>
        <h2>장소와 지도</h2>
        {plan?.places.length ? <p className="plan-meta">{plan.places.slice(0, 3).map((place) => place.name).join(" · ")}</p> :
          plan && <p className="plan-meta">가보고 싶은 곳을 모아두세요.</p>}
        <Link href={`${href}/map`} className="quiet-link">장소와 지도<ChevronRight size={16} aria-hidden /></Link>
        <Link href={mapHref(trip.id, { date, filter: "candidates" })} className="quiet-link">후보 장소<ChevronRight size={16} aria-hidden /></Link>
      </section>
    </div>
    <section className="editorial-paper booking-home" aria-labelledby="booking-home-heading">
      <div className="editorial-section-heading">
        <h2 id="booking-home-heading">예약 한눈에 보기</h2>
        <Link href={bookingsHref(trip.id, date)} className="quiet-link">예약 전체 보기<ChevronRight size={16} aria-hidden /></Link>
      </div>
      {!bookings ? <p className="plan-meta">예약 요약을 불러오지 못했어요.</p> : bookings.length ? <ul>
        {(Object.keys(bookingKinds) as (keyof typeof bookingKinds)[]).map((kind) => {
          const group = bookings.filter((booking) => booking.kind === kind);
          const first = group[0];
          return first && <li key={kind}>
            <Link className="booking-home-entry" href={bookingsHref(trip.id, date, "view", first.id)}>
              <span className="booking-home-kind"><BookingKindLabel kind={kind} /></span>
              <strong>{first.title}</strong><BookingBadge status={first.status} />
              {group.length > 1 && <span className="plan-meta">외 {group.length - 1}건</span>}
            </Link>
          </li>;
        })}
      </ul> : <p className="plan-meta">예약 정보 미등록</p>}
    </section>
    <Link href={`${href}/delete`} className="quiet-link danger-link editorial-delete">여행 삭제</Link>
    <TripTabs href={href} active="home" date={date} />
  </div>;
}
