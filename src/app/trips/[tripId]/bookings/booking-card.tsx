import { ArrowRight, BedDouble, ChevronRight, MapPin, Mountain, Plane } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { BookingKind, BookingStatus, PrivateBookingFields } from "@/lib/database.types";
import type { Booking } from "@/lib/trip-booking-data";
import { bookingKinds, bookingStatuses } from "@/lib/trip-bookings";
import { dateLabel } from "@/lib/trip-details";
import { directionsUrl } from "@/lib/trip-places";
import { BookingLocation } from "./booking-location";

export const bookingIcons = { FLIGHT: Plane, STAY: BedDouble, TOUR: Mountain };
export function BookingBadge({ status }: { status: BookingStatus }) {
  return <span className="booking-badge" data-status={status}>{bookingStatuses[status]}</span>;
}

export function BookingKindLabel({ kind }: { kind: BookingKind }) {
  const Icon = bookingIcons[kind];
  return <><Icon size={18} aria-hidden />{bookingKinds[kind]}</>;
}

function Clock({ day, time, zone }: { day?: string | null; time?: string | null; zone?: string | null }) {
  return <><span>{day ? dateLabel(day) : "날짜 미입력"}</span>
    <strong>{time ? time.slice(0, 5) : "시각 미입력"}</strong>
    {zone && <small>{zone}</small>}</>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function BookingFacts({ booking, detailed = false }: { booking: Booking; detailed?: boolean }) {
  if (booking.kind === "FLIGHT") {
    return booking.segments.length ? <ol className="booking-flight-list">
      {booking.segments.map((segment, index) => <li className="booking-flight" key={segment.id}>
        <div className="booking-flight-label">
          {booking.segments.length > 1 && <span className="plan-meta">{index + 1}구간</span>}
          {(segment.airline_name || segment.flight_number) && <span>{[segment.airline_name, segment.flight_number].filter(Boolean).join(" · ")}</span>}
        </div>
        <div className="booking-flight-route">
          <strong>{segment.departure_airport ?? "미입력"}</strong><ArrowRight size={18} aria-hidden /><strong>{segment.arrival_airport ?? "미입력"}</strong>
        </div>
        <dl className="booking-facts">
          <Fact label="출발 현지"><Clock day={segment.departure_local_date} time={segment.departure_local_time} zone={detailed ? segment.departure_timezone : null} /></Fact>
          <Fact label="도착 현지"><Clock day={segment.arrival_local_date} time={segment.arrival_local_time} zone={detailed ? segment.arrival_timezone : null} /></Fact>
        </dl>
      </li>)}
    </ol> : <p className="plan-meta">항공 구간 미입력</p>;
  }

  const address = booking.kind === "STAY" ? booking.stay?.address_text : booking.tour?.meeting_address_text;
  const coordinates = booking.kind === "TOUR" ? booking.tour : undefined;
  const directions = directionsUrl({ address_text: address ?? null, address_ja: null,
    latitude: coordinates?.meeting_latitude ?? null, longitude: coordinates?.meeting_longitude ?? null });
  return <>
    {booking.kind === "STAY" ? <dl className="booking-facts">
      <Fact label="체크인"><Clock day={booking.stay?.check_in_local_date} time={booking.stay?.check_in_local_time} /></Fact>
      <Fact label="체크아웃"><Clock day={booking.stay?.check_out_local_date} time={booking.stay?.check_out_local_time} /></Fact>
    </dl> : <dl className="booking-facts">
      <Fact label="투어 시작"><Clock day={booking.tour?.event_local_date} time={booking.tour?.event_local_time} /></Fact>
      <Fact label="집합 시각"><strong>{booking.tour?.meeting_local_time?.slice(0, 5) ?? "시각 미입력"}</strong></Fact>
    </dl>}
    <div className="booking-address">
      <MapPin size={17} aria-hidden />
      <div>
        {booking.kind === "TOUR" && <strong>{booking.tour?.meeting_place_name || "집합 장소 미입력"}</strong>}
        {address ? <p>{address}</p> : booking.kind === "STAY" && <p className="plan-meta">주소 미입력</p>}
      </div>
    </div>
    {detailed && booking.kind === "STAY" && (booking.stay?.guest_count || booking.stay?.room_count) &&
      <p className="plan-meta">{[booking.stay.guest_count && booking.stay.guest_count + "명",
        booking.stay.room_count && "객실 " + booking.stay.room_count + "개"].filter(Boolean).join(" · ")}</p>}
    {detailed && (address || directions) && <BookingLocation address={address} directions={directions} />}
  </>;
}

export function BookingCard({ booking, href }: { booking: Booking; href: string }) {
  return <article className="editorial-paper booking-card">
    <header><h3>{booking.title}</h3><BookingBadge status={booking.status} /></header>
    <BookingFacts booking={booking} />
    <footer><Link href={href} className="quiet-link" scroll={false} aria-label={booking.title + " 상세 보기"}>
      상세 보기<ChevronRight size={16} aria-hidden />
    </Link></footer>
  </article>;
}

export function BookingPrivate({ data }: { data: PrivateBookingFields }) {
  return <details className="booking-private">
    <summary className="quiet-link">비공개 정보</summary>
    <dl className="booking-facts">
      {data.confirmation_reference && <Fact label="예약번호"><strong>{data.confirmation_reference}</strong></Fact>}
      {data.amount !== null && <Fact label="결제금액"><strong>{Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(data.amount)} {data.currency}</strong></Fact>}
      {data.private_note && <Fact label="개인 메모"><span className="plan-notes">{data.private_note}</span></Fact>}
    </dl>
  </details>;
}
