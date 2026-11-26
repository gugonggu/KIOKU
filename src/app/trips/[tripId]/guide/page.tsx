import { scheduleTimeLabel } from "@/lib/trip-plan";
import Link from "next/link";
import { Blossom } from "@/components/brand";
import { expenseTotals, wonLabel } from "@/lib/trip-budget";
import { loadBudget } from "@/lib/trip-budget-data";
import { bookingKinds, bookingStatuses } from "@/lib/trip-bookings";
import { dateLabel } from "@/lib/trip-details";
import { directionsUrl } from "@/lib/trip-places";
import { loadPreparation } from "@/lib/trip-preparation-data";
import { preparationProgress } from "@/lib/trip-preparation";
import type { SharedBooking, SharedPlace } from "@/lib/trip-share-types";
import { guideDays, guideOptions, guideScope } from "@/lib/travel-guide";
import { loadTravelSnapshot } from "@/lib/travel-snapshot-data";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { TripTabs } from "../editorial";
import { PrintButton } from "./print-button";
import "./guide.css";

export const metadata = { title: "여행 가이드", robots: { index: false, follow: false } };

function PlaceDetails({ place }: { place: SharedPlace }) {
  const directions = directionsUrl({ latitude: place.latitude, longitude: place.longitude, address_text: place.address, address_ja: null });
  return <p>{place.name}{place.address && " · " + place.address}{directions && <> · <a href={directions} rel="noreferrer">지도</a></>}</p>;
}

function time(value: string | null) {
  return value?.slice(0, 5);
}

function bookingDetails(booking: SharedBooking) {
  if (booking.kind === "FLIGHT") return booking.detail.map((flight, index) => <p key={index}>
    {[flight.departureAirport, flight.departureDate, time(flight.departureTime), flight.departureZone].filter(Boolean).join(" ") || "출발 미정"}
    {" → "}
    {[flight.arrivalAirport, flight.arrivalDate, time(flight.arrivalTime), flight.arrivalZone].filter(Boolean).join(" ") || "도착 미정"}
  </p>);
  if (booking.kind === "STAY" && booking.detail) return <>
    {booking.detail.address && <p>{booking.detail.address}</p>}
    <p>체크인 {[booking.detail.checkInDate, time(booking.detail.checkInTime)].filter(Boolean).join(" ") || "미정"}</p>
    <p>체크아웃 {[booking.detail.checkOutDate, time(booking.detail.checkOutTime)].filter(Boolean).join(" ") || "미정"}</p>
  </>;
  if (booking.kind === "TOUR" && booking.detail) return <>
    {(booking.detail.date || booking.detail.time) && <p>{booking.detail.date} {time(booking.detail.time)}</p>}
    <p>집합 {time(booking.detail.meetingTime) ?? "시간 미정"}</p>
    {(booking.detail.meetingName || booking.detail.meetingAddress) && <PlaceDetails place={{
      name: booking.detail.meetingName ?? "집합 장소", address: booking.detail.meetingAddress,
      latitude: booking.detail.latitude, longitude: booking.detail.longitude,
    }} />}
  </>;
  return null;
}

export default async function Page({ params, searchParams }: PageProps<"/trips/[tripId]/guide">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const options = guideOptions(query);
  const [snapshot, items, ledger] = await Promise.all([
    loadTravelSnapshot(trip), options.preparation ? loadPreparation(tripId) : null, options.budget ? loadBudget(tripId) : null,
  ]);
  if (!snapshot) return <TripLoadError />;
  const { schedule, places, bookings } = guideScope(snapshot, options);
  const readiness = items && preparationProgress(items);
  const totals = ledger?.budget && expenseTotals(ledger.expenses);
  const days = guideDays(snapshot, options.date);
  const href = "/trips/" + tripId;
  const available = (!options.preparation || items !== null) && (!options.budget || ledger !== null);

  return <div className="editorial-page suite-page travel-guide">
    <header className="guide-controls">
      <Link className="quiet-link" href={href + "/more"}>더보기</Link>
      <h1>여행 가이드 내보내기</h1>
      <p>출력 범위를 적용한 뒤 인쇄 창에서 A4와 PDF로 저장을 선택하세요. 출력 전에 아래 미리보기를 확인하세요.</p>
    </header>
    <form action={href + "/guide"} method="get" className="guide-controls editorial-paper suite-form">
      <input type="hidden" name="options" value="1" />
      <label>특정 날짜만 인쇄 (비우면 전체)<input name="date" type="date" defaultValue={options.date} /></label>
      <fieldset className="budget-shares"><legend>출력에 포함할 정보</legend>
        <label><input type="checkbox" name="places" value="1" defaultChecked={options.places} />장소 정보</label>
        <label><input type="checkbox" name="bookings" value="1" defaultChecked={options.bookings} />예약 일정</label>
        <label><input type="checkbox" name="preparation" value="1" defaultChecked={options.preparation} />준비 체크리스트 요약</label>
        <label><input type="checkbox" name="budget" value="1" defaultChecked={options.budget} />경비 요약 (소유자용)</label>
      </fieldset>
      <div className="suite-row"><button type="submit" className="quiet-link">미리보기 갱신</button>{available && <PrintButton budget={options.budget} />}</div>
      {!available && <p role="alert">선택한 일부 정보를 불러오지 못했어요. 다시 시도하거나 해당 항목을 해제해 주세요.</p>}
      {options.budget && <p role="status">이번 출력에 여행 전체의 소유자용 경비 요약이 포함돼요. 공유하기 전에 확인하세요.</p>}
    </form>
    <article className="guide-paper editorial-paper" aria-label="인쇄 미리보기">
      <header className="guide-cover">
        <Blossom className="guide-blossom" />
        <p className="editorial-kicker">記憶 · 일본 여행 수첩</p>
        <h2>{snapshot.title}</h2>
        <p>{snapshot.destination}</p>
        <p>{snapshot.startDate && snapshot.endDate ? snapshot.startDate + " ~ " + snapshot.endDate : "여행 날짜 미정"}</p>
        <p>{options.date ? dateLabel(options.date) + " 일정" : "전체 일정"}</p>
      </header>
      <section className="guide-block"><h3>여행 개요</h3>
        <p>일정 {schedule.length}개{trip.traveler_count ? " · " + trip.traveler_count + "명" : ""} · 일본 현지 시각 기준</p>
      </section>
      {!days.length && <section className="guide-block"><h3>날짜별 일정</h3><p>날짜를 지정한 일정이 없어요.</p></section>}
      {days.map((date) => <section className="guide-day" key={date}><h3>{dateLabel(date)}</h3>
        {schedule.some((item) => item.date === date) ? <ul>{schedule.filter((item) => item.date === date).map((item, index) =>
          <li className="guide-entry" key={index}>
            <h4><span>{scheduleTimeLabel(item)}</span> {item.title}</h4>
            {options.places && item.place && <PlaceDetails place={item.place} />}
            {item.note && <p>{item.note}</p>}
          </li>)}</ul> : <p>이 날짜에 저장된 일정이 없어요.</p>}
      </section>)}
      {!!places.length && <section className="guide-day"><h3>여행 장소</h3>
        <ul>{places.map((place, index) => <li className="guide-entry" key={index}><PlaceDetails place={place} /></li>)}</ul>
      </section>}
      {!!bookings.length && <section className="guide-day"><h3>항공 · 숙소 · 투어</h3>
        <ul>{bookings.map((booking, index) => <li className="guide-entry" key={index}>
          <h4>{bookingKinds[booking.kind]} · {booking.title} <span>({bookingStatuses[booking.status]})</span></h4>
          {bookingDetails(booking)}
        </li>)}</ul>
      </section>}
      {readiness && <section className="guide-block"><h3>여행 준비</h3><p>{readiness.total}개 중 {readiness.done}개 완료 · {readiness.percent}%</p></section>}
      {options.budget && <section className="guide-block"><h3>경비 요약 (소유자용)</h3>
        {totals && ledger?.budget ? <><p>예산 {ledger.budget.budget_krw ? wonLabel(ledger.budget.budget_krw) : "미설정"} · 지출 {wonLabel(totals.total)} · 사전 결제 {wonLabel(totals.prepaid)}</p>
          {!totals.complete && <p>일부 환산 · 환율 미확정 {totals.pendingCount}건, {totals.pendingJpy.toLocaleString("ko-KR")}엔 제외</p>}</> : <p>표시할 경비가 없어요.</p>}
      </section>}
    </article>
    <TripTabs href={href} active="more" />
  </div>;
}
