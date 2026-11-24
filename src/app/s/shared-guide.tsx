import { ArrowRight, CalendarDays, MapPin, Navigation, NotebookPen, Ticket } from "lucide-react";
import { Cover } from "@/components/cover";
import { dateLabel, japanDate } from "@/lib/trip-details";
import { directionsUrl } from "@/lib/trip-places";
import { planDay } from "@/lib/trip-plan";
import type { SharedBooking, SharedPlace, SharedTrip } from "@/lib/trip-share-types";
import { BookingBadge, BookingKindLabel } from "../trips/[tripId]/bookings/booking-card";
import { dayNumber, timeLabel, tripDays } from "../trips/[tripId]/editorial";
import { SharedMap } from "./shared-map";
import { SharedSectionLink } from "./shared-section-link";

function clock(date?: string | null, time?: string | null) {
  return [date ? dateLabel(date) : "날짜 미입력", time ? time.slice(0, 5) : "시각 미입력"].join(" · ");
}

function Directions({ place }: { place: SharedPlace }) {
  const href = directionsUrl({ address_text: place.address, address_ja: null, latitude: place.latitude, longitude: place.longitude });
  return href && <a className="quiet-link" href={href} rel="noopener noreferrer" referrerPolicy="no-referrer" target="_blank">
    <Navigation size={15} aria-hidden />Google Maps 길찾기
  </a>;
}

function BookingSummary({ booking }: { booking: SharedBooking }) {
  return <article className="editorial-paper booking-card">
    <div className="share-card-heading"><span className="booking-home-kind"><BookingKindLabel kind={booking.kind} /></span>
      <BookingBadge status={booking.status} /></div>
    <h3>{booking.title}</h3>
    {booking.kind === "FLIGHT" && (booking.detail.length ? <ol className="booking-flight-list">
      {booking.detail.map((segment, index) => <li className="booking-flight" key={index}>
        <div className="booking-flight-route">{segment.departureAirport ?? "미입력"}<ArrowRight size={16} aria-hidden />{segment.arrivalAirport ?? "미입력"}</div>
        <dl className="booking-facts">
          <div><dt>출발 현지</dt><dd>{clock(segment.departureDate, segment.departureTime)}{segment.departureZone && <small>{segment.departureZone}</small>}</dd></div>
          <div><dt>도착 현지</dt><dd>{clock(segment.arrivalDate, segment.arrivalTime)}{segment.arrivalZone && <small>{segment.arrivalZone}</small>}</dd></div>
        </dl>
      </li>)}</ol> : <p className="plan-meta">항공 구간 미입력</p>)}
    {booking.kind === "STAY" && <><dl className="booking-facts">
      <div><dt>체크인</dt><dd>{clock(booking.detail?.checkInDate, booking.detail?.checkInTime)}</dd></div>
      <div><dt>체크아웃</dt><dd>{clock(booking.detail?.checkOutDate, booking.detail?.checkOutTime)}</dd></div>
    </dl>{booking.detail?.address && <><p>{booking.detail.address}</p>
      <Directions place={{ name: booking.title, address: booking.detail.address, latitude: null, longitude: null }} /></>}</>}
    {booking.kind === "TOUR" && <><dl className="booking-facts">
      <div><dt>투어 시작</dt><dd>{clock(booking.detail?.date, booking.detail?.time)}</dd></div>
      <div><dt>집합 시각</dt><dd>{booking.detail?.meetingTime?.slice(0, 5) ?? "시각 미입력"}</dd></div>
    </dl>{booking.detail?.meetingName && <p>{booking.detail.meetingName}</p>}{booking.detail?.meetingAddress && <p>{booking.detail.meetingAddress}</p>}
      {booking.detail && <Directions place={{ name: booking.detail.meetingName ?? booking.title, address: booking.detail.meetingAddress,
        latitude: booking.detail.latitude, longitude: booking.detail.longitude }} />}</>}
    {booking.note && <p className="plan-notes">{booking.note}</p>}
  </article>;
}

function datesFor(trip: SharedTrip, requested?: string) {
  const scheduled = [...new Set(trip.schedule.map(({ date }) => date))];
  const range = { start_date: trip.startDate, end_date: trip.endDate };
  const today = japanDate();
  const date = requested ?? planDay(range, undefined, today) ?? scheduled[0];
  const inRange = planDay(range, date, today);
  const nearby = inRange ? tripDays(range, inRange) : [];
  const edges = [date, trip.startDate, trip.endDate].filter((value): value is string => Boolean(value));
  return { date, dates: [...new Set([...nearby, ...scheduled, ...edges])].sort() };
}

export function SharedGuide({ trip, requested, href, preserveFragment = false }: {
  trip: SharedTrip; requested?: string; href: (day: string) => string; preserveFragment?: boolean;
}) {
  const { date, dates } = datesFor(trip, requested);
  const entries = trip.schedule.filter((item) => item.date === date);
  const winter = /삿포로|홋카이도|札幌|北海道|sapporo|hokkaido/i.test(trip.destination);
  return <div className="editorial-page shared-guide">
    <article className="editorial-hero" id="guide-home">
      <div className={"editorial-cover" + (winter ? "" : " editorial-cover-neutral")} aria-hidden="true">{!winter && <Cover />}</div>
      <div className="editorial-hero-content">
        <p className="plan-meta">공유 받은 여행</p>
        <h1>{trip.title}</h1>
        <p>{trip.destination}</p>
        <p className="plan-meta">{trip.startDate && trip.endDate ? dateLabel(trip.startDate) + " – " + dateLabel(trip.endDate) : "여행 날짜 미정"}</p>
      </div>
    </article>
    <nav className="shared-sections" aria-label="공유 여행 바로가기">
      <SharedSectionLink section="guide-itinerary" preserveFragment={preserveFragment}><CalendarDays size={17} aria-hidden />일정</SharedSectionLink>
      <SharedSectionLink section="guide-places" preserveFragment={preserveFragment}><MapPin size={17} aria-hidden />장소</SharedSectionLink>
      {trip.bookings && <SharedSectionLink section="guide-bookings" preserveFragment={preserveFragment}><Ticket size={17} aria-hidden />예약</SharedSectionLink>}
    </nav>
    <section id="guide-itinerary" className="editorial-section">
      <h2 tabIndex={preserveFragment ? -1 : undefined}>날짜별 일정</h2>
      {dates.length > 0 && <nav className="editorial-days" aria-label="공유 일정 날짜">
        {dates.map((day) => <a className="editorial-day" href={href(day)} key={day} aria-current={date === day ? "date" : undefined}>
          {trip.startDate && trip.endDate && day >= trip.startDate && day <= trip.endDate && <strong>Day {dayNumber(trip.startDate, day)}</strong>}
          <time dateTime={day}>{dateLabel(day)}</time>
        </a>)}
      </nav>}
      {entries.length ? <ol className="editorial-timeline">{entries.map((entry, index) => <li className="editorial-entry plan-entry" key={index}>
        <div className="editorial-entry-time"><span className="editorial-time">{timeLabel(entry)}</span></div>
        <div className="editorial-entry-card">
          <span className="editorial-entry-icon"><NotebookPen size={19} aria-hidden /></span>
          <div className="editorial-entry-copy">
            <h3>{entry.title}</h3>
            {entry.place && <><p className="plan-meta">{entry.place.name}{entry.place.address && " · " + entry.place.address}</p>
              <Directions place={entry.place} /></>}
            {entry.note && <p className="plan-notes">{entry.note}</p>}
          </div>
        </div>
      </li>)}</ol> : <p className="plan-empty">{date ? "이 날짜에 공유된 일정이 없어요." : "날짜가 정해진 일정이 없어요."}</p>}
    </section>
    <section id="guide-places" className="editorial-section">
      <h2 tabIndex={preserveFragment ? -1 : undefined}>장소와 지도</h2>
      {trip.places.length ? <div className="shared-places">
        <SharedMap places={trip.places} />
        <ol className="places-cards">{trip.places.map((place, index) => <li key={index} className="editorial-paper shared-place">
          <strong>{index + 1}. {place.name}</strong>
          <p className="plan-meta">{place.address ?? "주소 미입력"}</p>
          <Directions place={place} />
        </li>)}</ol>
      </div> : <p className="plan-empty">저장된 장소가 없어요.</p>}
    </section>
    {trip.bookings && <section id="guide-bookings" className="editorial-section">
      <h2 tabIndex={preserveFragment ? -1 : undefined}>예약 일정</h2>
      {trip.bookings.length ? <div className="shared-bookings">{trip.bookings.map((booking, index) => <BookingSummary key={index} booking={booking} />)}</div> :
        <p className="plan-empty">등록된 예약이 없어요.</p>}
    </section>}
  </div>;
}
