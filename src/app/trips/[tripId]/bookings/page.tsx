import { randomUUID } from "node:crypto";
import { ArrowLeft, CalendarPlus, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialDialog } from "@/components/editorial-dialog";
import type { BookingKind } from "@/lib/database.types";
import { loadBookingLinks, loadBookings, loadPrivateBooking } from "@/lib/trip-booking-data";
import { bookingKinds } from "@/lib/trip-bookings";
import { dateLabel, isCalendarDate, japanDate } from "@/lib/trip-details";
import { planDay } from "@/lib/trip-plan";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { timeLabel, TripTabs } from "../editorial";
import { itineraryHref } from "../itinerary/links";
import { deleteBooking, saveBooking } from "./actions";
import { BookingBadge, BookingCard, BookingFacts, BookingKindLabel, BookingPrivate } from "./booking-card";
import { BookingDelete, BookingEditor } from "./booking-editor";
import { bookingsHref } from "./links";

export const metadata = { title: "예약" };

export default async function BookingsPage({ params, searchParams }: PageProps<"/trips/[tripId]/bookings">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const rows = await loadBookings(trip.id);
  const groups = (Object.keys(bookingKinds) as BookingKind[])
    .map((kind) => ({ kind, bookings: rows?.filter((booking) => booking.kind === kind) ?? [] }))
    .filter(({ bookings }) => bookings.length > 0);
  const date = planDay(trip, typeof query.date === "string" && isCalendarDate(query.date) ? query.date : undefined, japanDate());
  const home = "/trips/" + trip.id;
  const back = bookingsHref(trip.id, date);
  const { mode } = query;
  const item = mode === "view" || mode === "edit" || mode === "delete" ? rows?.find(({ id }) => id === query.id) : undefined;
  if (rows && (mode === "view" || mode === "edit" || mode === "delete") && !item) notFound();
  const itemHref = bookingsHref(trip.id, date, "view", item?.id);
  const [privateResult, links] = item ? await Promise.all([
    mode !== "delete" ? loadPrivateBooking(trip.id, item.id) : null,
    loadBookingLinks(trip.id, item.id),
  ]) : [null, null];
  const linkDetails = links?.length ? <ul className="booking-impact-list">{links.map((entry) =>
    <li key={entry.id}><span>{entry.title}</span><span className="plan-meta">
      {entry.local_date ? dateLabel(entry.local_date) : "날짜 미정"} · {timeLabel(entry)}
    </span></li>)}</ul> : null;
  const linkWarning = !links && <p className="notice notice-error" role="alert">연결된 일정을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.</p>;

  return <div className="editorial-page bookings-page">
    <header className="editorial-itinerary-header places-header">
      <div>
        <Link href={home} className="quiet-link editorial-back"><ArrowLeft size={16} aria-hidden />{trip.title}</Link>
        <h1>예약</h1>
      </div>
      {rows && <Link className="primary-button places-add" href={bookingsHref(trip.id, date, "add")} scroll={false} data-itinerary-add>
        <Plus size={18} aria-hidden />예약 추가
      </Link>}
    </header>
    {!rows ? <div className="notice notice-error" role="alert">
      <p>예약을 불러오지 못했어요.</p>
      <form method="get" action={bookingsHref(trip.id)}>
        {date && <input type="hidden" name="date" value={date} />}
        <button className="quiet-link">다시 불러오기</button>
      </form>
    </div> : !rows.length ? <section className="editorial-paper booking-empty">
      <h2>예약 정보 미등록</h2>
      <p className="plan-meta">항공편, 숙소, 투어를 한곳에 모아 여행 중 확인하세요.</p>
    </section> : <>
      {groups.length > 1 && <nav className="booking-jump" aria-label="예약 유형으로 이동">
        {groups.map(({ kind }) => <a key={kind} className="quiet-link" href={"#booking-" + kind}>
          <BookingKindLabel kind={kind} />
        </a>)}
      </nav>}
      <div className="booking-groups">
        {groups.map(({ kind, bookings }) => <section key={kind} aria-labelledby={"booking-" + kind}>
          <h2 id={"booking-" + kind}><BookingKindLabel kind={kind} /></h2>
          <div className="booking-cards">{bookings.map((booking) => <BookingCard key={booking.id} booking={booking}
            href={bookingsHref(trip.id, date, "view", booking.id)} />)}</div>
        </section>)}
      </div>
    </>}
    <TripTabs href={home} active="bookings" date={date} />

    {rows && mode === "add" && <EditorialDialog title="예약 추가" back={back}>
      <BookingEditor key="add" back={back} action={saveBooking.bind(null, trip.id, randomUUID(), null, date)} />
    </EditorialDialog>}
    {item && mode === "view" && <EditorialDialog title={item.title} back={back}>
      <div className="booking-detail">
        <div className="booking-detail-heading"><span><BookingKindLabel kind={item.kind} /></span><BookingBadge status={item.status} /></div>
        <BookingFacts booking={item} detailed />
        {item.shared_note && <div><h3>공유용 메모</h3><p className="plan-notes">{item.shared_note}</p></div>}
        {privateResult?.data && <BookingPrivate data={privateResult.data} />}
        {privateResult?.error && <p className="notice notice-error" role="alert">비공개 정보를 불러오지 못했어요.</p>}
        {linkDetails && <div><h3>연결된 일정</h3>{linkDetails}</div>}
        <Link className="primary-button booking-schedule-add"
          href={itineraryHref(trip.id, date, "add", undefined, !date) + "&booking=" + item.id}>
          <CalendarPlus size={17} aria-hidden />일정에 추가
        </Link>
        <div className="state-actions booking-manage">
          <Link className="quiet-link" href={bookingsHref(trip.id, date, "edit", item.id)} scroll={false}>예약 수정</Link>
          <Link className="quiet-link danger-link" href={bookingsHref(trip.id, date, "delete", item.id)} scroll={false}>예약 삭제</Link>
        </div>
      </div>
    </EditorialDialog>}
    {item && mode === "edit" && <EditorialDialog title="예약 수정" back={itemHref}>
      {privateResult?.error ? <p className="notice notice-error" role="alert">비공개 정보를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.</p>
        : linkWarning || <BookingEditor key={item.id} back={itemHref} item={item} privateDetails={privateResult?.data}
          impact={linkDetails && <div className="booking-impact"><h3>연결된 일정</h3>{linkDetails}
            <p className="plan-meta">예약을 수정해도 일정 날짜와 시각은 유지됩니다.</p></div>}
          action={saveBooking.bind(null, trip.id, item.id, item.content_version, date)} />}
    </EditorialDialog>}
    {item && mode === "delete" && <EditorialDialog title="예약 삭제" back={itemHref}>
      {links ? <BookingDelete back={itemHref} action={deleteBooking.bind(null, trip.id, item.id, item.content_version, date, links.map(({ id }) => id))}>
        <p><strong>{item.title}</strong> 예약을 삭제할까요?</p>
        {linkDetails && <div className="booking-impact"><h3>연결된 일정 {links.length}개</h3>{linkDetails}
          <p className="plan-meta">예약 연결만 해제되고 일정과 날짜·시각은 그대로 유지됩니다.</p></div>}
      </BookingDelete> : linkWarning}
    </EditorialDialog>}
  </div>;
}
