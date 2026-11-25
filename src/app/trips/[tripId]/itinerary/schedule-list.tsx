"use client";

import { EllipsisVertical, Footprints, MapPin, NotebookPen, Pencil, ChevronUp, ChevronDown, GripVertical, Ticket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { dateLabel } from "@/lib/trip-details";
import { scheduleGroup, sortSchedule } from "@/lib/trip-plan";
import { visitStatuses, type VisitStatus } from "@/lib/trip-memory";
import type { PlanSchedule } from "@/lib/trip-plan-data";
import type { BookingSummary } from "@/lib/trip-booking-data";
import { timeLabel } from "../editorial";
import { BookingBadge } from "../bookings/booking-card";
import { mapHref } from "../map/links";
import { bookingsHref } from "../bookings/links";
import { changePlacement, reorderItinerary } from "./actions";
import { saveVisit } from "../memory/actions";
import { ArchiveButton } from "./forms";
import { itineraryHref } from "./links";

type Place = { id: string; name: string; address: string | null };
const versionOf = (item: PlanSchedule) => ({ id: item.id, revision: item.revision });

function ScheduleVisit({ tripId, item, status }: { tripId: string; item: PlanSchedule; status: VisitStatus }) {
  const [message, submit, pending] = useActionState(saveVisit.bind(null, tripId, item.id), "");
  return <details className="schedule-visit" data-visited={status === "visited" || undefined}>
    <summary className="quiet-link" aria-label={item.title + " 방문 상태: " + visitStatuses[status]}>{visitStatuses[status]}</summary>
    <form className="suite-row" action={submit}>
      {(["planned", "visited", "missed"] as const).map((value) => <button key={value} type="submit" className="quiet-link"
        name="status" value={value} aria-pressed={value === status} disabled={pending}>{visitStatuses[value]}</button>)}
    </form>
    {message && <p className="notice notice-error" role="alert">{message}</p>}
  </details>;
}

export function ScheduleList({ items, tripId, date, places, bookings, visits, candidate = false, showDates = false }: {
  items: PlanSchedule[]; tripId: string; date: string | null; places: Place[]; bookings: BookingSummary[]; visits?: Record<string, VisitStatus> | null; candidate?: boolean; showDates?: boolean;
}) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const [dragId, setDragId] = useState<string>();
  const [notice, setNotice] = useState("");
  const rows = sortSchedule(items);
  const placeById = new Map(places.map((place) => [place.id, place]));
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const sameGroup = (first: PlanSchedule, second?: PlanSchedule) =>
    Boolean(second && first.local_date === second.local_date && scheduleGroup(first) === scheduleGroup(second));

  function move(first: PlanSchedule, second: PlanSchedule) {
    if (pending || first.id === second.id || !sameGroup(first, second)) return;
    setNotice("");
    transition(async () => {
      try {
        const state = await reorderItinerary(tripId, versionOf(first), versionOf(second));
        if (state.error) setNotice(state.error);
        if (!state.error || state.refresh) router.refresh();
      } catch {
        setNotice("순서를 바꾸지 못했어요. 다시 시도해 주세요.");
      }
    });
  }

  return <div className="plan-list">
    {notice && <p className="notice notice-error" role="alert">{notice}</p>}
    {pending && <span className="sr-only" role="status">일정 순서를 저장하는 중이에요.</span>}
    <ol className="editorial-timeline">
      {rows.map((item, index) => {
        const previous = rows[index - 1];
        const next = rows[index + 1];
        const canMoveUp = sameGroup(item, previous);
        const canMoveDown = sameGroup(item, next);
        const place = item.place_id ? placeById.get(item.place_id) : undefined;
        const booking = item.booking_id ? bookingById.get(item.booking_id) : undefined;
        const Icon = item.kind === "MOVE" ? Footprints : item.kind === "PLACE" || place ? MapPin : NotebookPen;
        const placement = { ...versionOf(item), archivedDate: item.archived_date, candidate };
        const href = (mode: "edit" | "copy" | "move" | "restore" | "delete") => itineraryHref(tripId, date, mode, item.id, candidate);
        return <li key={item.id} id={`schedule-${item.id}`} className="editorial-entry plan-entry" data-schedule-id={item.id}
          onDragOver={(event) => {
            const source = rows.find((row) => row.id === dragId);
            if (source && source.id !== item.id && sameGroup(source, item)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            const source = rows.find((row) => row.id === dragId);
            setDragId(undefined);
            if (source) move(source, item);
          }}>
          <div className="editorial-entry-time">
            {showDates && item.local_date && <time dateTime={item.local_date}>{dateLabel(item.local_date)}</time>}
            <span className="editorial-time" data-mode={item.time_mode}>{timeLabel(item)}</span>
          </div>
          <div className="editorial-entry-card">
            <span className="editorial-entry-icon"><Icon size={20} aria-hidden /></span>
            <div className="editorial-entry-copy">
              <h3>{item.title}</h3>
              {candidate && item.archived_date && <p className="plan-meta">원래 날짜 {dateLabel(item.archived_date)}</p>}
              {place && <Link className="editorial-place-link" aria-label="지도에서 장소 보기" href={mapHref(tripId, { place: place.id,
                date: item.local_date, filter: item.local_date ? "date" : "candidates" })}>
                <MapPin size={14} aria-hidden /><span><strong>{place.name}</strong>
                  {place.address && <span className="editorial-entry-address" title={place.address}>{place.address}</span>}
                </span>
              </Link>}
              {booking && <div className="editorial-entry-booking">
                <Link className="editorial-place-link" href={bookingsHref(tripId, date, "view", booking.id)}>
                  <Ticket size={14} aria-hidden /><span><strong>예약 · {booking.title}</strong></span>
                </Link>
                <BookingBadge status={booking.status} />
              </div>}
              {visits && !candidate && item.kind !== "MOVE" && (item.kind === "PLACE" || place) &&
                <ScheduleVisit key={visits[item.id] ?? "planned"} tripId={tripId} item={item} status={visits[item.id] ?? "planned"} />}
              {item.private_note && <p className="plan-notes">개인 메모 · {item.private_note}</p>}
              {item.shared_note && <p className="plan-notes">공유용 메모 · {item.shared_note}</p>}
            </div>
            <div className="editorial-entry-controls">
              <Link className="editorial-icon-button editorial-entry-edit" href={href("edit")} aria-label={`${item.title} 일정 수정`}><Pencil size={15} aria-hidden /></Link>
              <details className="editorial-entry-menu" name="editorial-schedule-menu">
                <summary className="editorial-icon-button" aria-label={`${item.title} 일정 메뉴`}><EllipsisVertical size={18} aria-hidden /></summary>
                <div className="editorial-menu-content">
                  <Link className="quiet-link editorial-menu-edit" href={href("edit")} aria-label={`${item.title} 일정 수정`}>수정</Link>
                  <Link className="quiet-link" href={href("copy")} aria-label={`${item.title} 일정 복사`}>복사</Link>
                  <Link className="quiet-link" href={href("move")} aria-label={`${item.title} 날짜 이동`}>날짜 이동</Link>
                  {candidate ? item.archived_date && <Link className="quiet-link" href={href("restore")}>복원</Link> :
                    <ArchiveButton action={changePlacement.bind(null, tripId, placement, "archive", date)} />}
                  <Link className="quiet-link danger-link" href={href("delete")} aria-label={`${item.title} 일정 삭제`}>삭제</Link>
                </div>
              </details>
            </div>
          {(canMoveUp || canMoveDown) && <div className="editorial-entry-order">
            {canMoveUp && <button type="button" className="quiet-link" disabled={pending}
              aria-label={`${item.title} 위로`} onClick={() => move(item, previous)}><ChevronUp size={17} aria-hidden /></button>}
            {canMoveDown && <button type="button" className="quiet-link" disabled={pending}
              aria-label={`${item.title} 아래로`} onClick={() => move(item, next)}><ChevronDown size={17} aria-hidden /></button>}
            <span draggable={!pending} className="itinerary-drag"
              aria-hidden="true" onDragStart={(event) => {
                setDragId(item.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
              }} onDragEnd={() => setDragId(undefined)}><GripVertical size={18} />끌어서 이동</span>
          </div>}
          </div>
        </li>;
      })}
    </ol>
  </div>;
}
