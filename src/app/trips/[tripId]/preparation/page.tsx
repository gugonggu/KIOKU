import Link from "next/link";
import { loadBookingSummaries } from "@/lib/trip-booking-data";
import { loadPreparation } from "@/lib/trip-preparation-data";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { BookingBadge, BookingKindLabel } from "../bookings/booking-card";
import { TripTabs } from "../editorial";
import { PreparationList } from "./preparation-list";

export const metadata = { title: "여행 준비", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/trips/[tripId]/preparation">) {
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const [items, bookings] = await Promise.all([loadPreparation(tripId), loadBookingSummaries(tripId)]);
  return <div className="editorial-page suite-page prep-page">
    <header><Link className="quiet-link" href={"/trips/" + tripId + "/more"}>여행 더보기</Link><h1>여행 준비</h1><p>{trip.title}</p></header>
    {items ? <PreparationList tripId={tripId} items={items} /> : <p role="alert">준비 목록을 불러오지 못했어요.</p>}
    <section className="editorial-paper suite-stack">
      <h2>예약 상태 참고</h2>
      {bookings?.length ? <ul className="suite-stack">{bookings.map((booking) => <li key={booking.id} className="suite-row">
        <span className="booking-home-kind"><BookingKindLabel kind={booking.kind} /></span>
        <span>{booking.title}</span><BookingBadge status={booking.status} />
      </li>)}</ul> : <p>{bookings ? "등록된 예약이 없어요." : "예약을 불러오지 못했어요."}</p>}
      <Link href={"/trips/" + tripId + "/bookings"} className="quiet-link">예약 보기</Link>
    </section>
    <TripTabs href={"/trips/" + tripId} active="more" />
  </div>;
}
