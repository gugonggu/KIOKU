"use client";

import { BedDouble, Mountain, Plane, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, type ComponentProps, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import type { BookingKind, PrivateBookingFields } from "@/lib/database.types";
import type { Booking } from "@/lib/trip-booking-data";
import { bookingKinds, bookingStatuses, flightRules, maxFlightSegments, privateRules, stayRules, tourRules } from "@/lib/trip-bookings";
import { planCalendar } from "@/lib/trip-plan";
import type { BookingState } from "./actions";

const kindIcons = { FLIGHT: Plane, STAY: BedDouble, TOUR: Mountain };
const titleLabels = { FLIGHT: "항공 예약 이름", STAY: "숙소명", TOUR: "투어명" };
type Action = (state: BookingState, form: FormData) => Promise<BookingState>;

function inputValue(value: unknown, field: string) {
  if (value === null || value === undefined) return "";
  return field.endsWith("_time") ? String(value).slice(0, 5) : String(value);
}

function fieldProps(rule: string | number): ComponentProps<"input"> {
  if (typeof rule === "number") return { maxLength: rule };
  switch (rule) {
    case "date": return planCalendar;
    case "time": return { type: "time" };
    case "airport": return { maxLength: 4, autoCapitalize: "characters", placeholder: "예: CTS" };
    case "zone": return { maxLength: 64, placeholder: "예: Asia/Tokyo", autoCapitalize: "none", spellCheck: false };
    case "count": return { type: "number", min: 1, max: 999, inputMode: "numeric" };
    case "currency": return { maxLength: 3, placeholder: "예: JPY", autoCapitalize: "characters" };
    default: return { inputMode: "decimal" };
  }
}

function Footer({ back, state, pending, danger }: {
  back: string; state: BookingState; pending: boolean; danger?: boolean;
}) {
  return <>
    {state.error && !pending && <div className="notice notice-error" role="alert">{state.error}
      {state.refresh && <button type="button" className="quiet-link" onClick={() => window.location.reload()}>최신 정보 보기</button>}
    </div>}
    <div className="state-actions editorial-form-actions">
      <button type="submit" disabled={pending || state.refresh} className={danger ? "primary-button danger-button" : "primary-button"}>
        {pending ? "처리 중…" : danger ? "예약 삭제 확인" : "예약 저장"}
      </button>
      <Link className="quiet-link" href={back} scroll={false}>취소</Link>
    </div>
  </>;
}

export function BookingEditor({ action, back, item, privateDetails, impact }: {
  action: Action; back: string; item?: Booking; privateDetails?: PrivateBookingFields | null; impact?: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [kind, setKind] = useState<BookingKind | undefined>(item?.kind);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const detail = item?.kind === "STAY" ? item.stay : item?.kind === "TOUR" ? item.tour : undefined;
    return {
      ...Object.fromEntries(Object.entries({ ...detail, ...privateDetails }).map(([key, value]) => [key, inputValue(value, key)])),
      title: item?.title ?? "", status: item?.status ?? "NEEDS_BOOKING", shared_note: item?.shared_note ?? "",
    };
  });
  const [segments, setSegments] = useState<Record<string, string>[]>(() =>
    item?.kind === "FLIGHT" && item.segments.length ? item.segments.map((segment) =>
      Object.fromEntries(Object.entries(segment).map(([key, value]) => [key, inputValue(value, key)]))) : [{ id: "initial" }]);
  const set = (key: string, value: string) => setValues((previous) => ({ ...previous, [key]: value }));
  function field(key: string, [label, format]: readonly [string, string | number], index?: number) {
    const name = index === undefined ? key : "flight." + index + "." + key;
    return <label className="form-field"><span>{label}</span><Input name={name}
      value={(index === undefined ? values[key] : segments[index][key]) ?? ""}
      onChange={(event) => {
        const value = event.target.value;
        if (index === undefined) set(key, value);
        else setSegments((previous) => previous.map((segment, position) => position === index ? { ...segment, [key]: value } : segment));
      }} {...fieldProps(format)} /></label>;
  }
  function note(key: "shared_note" | "private_note", label: string) {
    return <label className="form-field"><span>{label}</span><textarea className="plan-input" name={key} rows={3} maxLength={1500}
      value={values[key] ?? ""} onChange={(event) => set(key, event.target.value)} /></label>;
  }

  return <form className="booking-editor editorial-quick-form" action={dispatch} noValidate>
    <fieldset className="plan-fields" disabled={pending}>
      {!item && <div className="editorial-sources" role="group" aria-label="예약 유형">
        {(Object.keys(bookingKinds) as BookingKind[]).map((key) => {
          const Icon = kindIcons[key];
          return <button type="button" key={key} aria-pressed={kind === key} onClick={() => setKind(key)}>
            <Icon size={17} aria-hidden />{bookingKinds[key]}
          </button>;
        })}
      </div>}
      {kind && <>
        <input type="hidden" name="kind" value={kind} />
        <label className="form-field"><span>{titleLabels[kind]}</span>
          <Input name="title" value={values.title} onChange={(event) => set("title", event.target.value)} required maxLength={100} />
        </label>
        <label className="form-field"><span>예약 상태</span><select className="plan-input" name="status"
          value={values.status} onChange={(event) => set("status", event.target.value)}>
          {Object.entries(bookingStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {kind === "FLIGHT" && <>
          <input type="hidden" name="segment_count" value={segments.length} />
          {segments.map((segment, index) => <section key={segment.id} className="booking-segment" aria-label={(index + 1) + "구간"}>
            <header><h3>{index + 1}구간</h3>
              {segments.length > 1 && <button type="button" className="quiet-link" aria-label={(index + 1) + "구간 삭제"}
                onClick={() => setSegments((previous) => previous.filter((_, position) => position !== index))}><Trash2 size={16} aria-hidden /></button>}
            </header>
            <div className="plan-pair">{field("departure_airport", flightRules.departure_airport, index)}
              {field("arrival_airport", flightRules.arrival_airport, index)}</div>
            <details>
              <summary className="quiet-link">항공편 · 현지 날짜와 시각</summary>
              <div className="plan-fields">
                <div className="plan-pair">{field("airline_name", flightRules.airline_name, index)}{field("flight_number", flightRules.flight_number, index)}</div>
                <div className="plan-pair">{field("departure_local_date", flightRules.departure_local_date, index)}{field("departure_local_time", flightRules.departure_local_time, index)}</div>
                {field("departure_timezone", flightRules.departure_timezone, index)}
                <div className="plan-pair">{field("arrival_local_date", flightRules.arrival_local_date, index)}{field("arrival_local_time", flightRules.arrival_local_time, index)}</div>
                {field("arrival_timezone", flightRules.arrival_timezone, index)}
              </div>
            </details>
          </section>)}
          <button type="button" className="quiet-link booking-add-segment" disabled={segments.length >= maxFlightSegments}
            onClick={() => {
              const id = crypto.randomUUID();
              setSegments((previous) => [...previous, { id }]);
            }}><Plus size={16} aria-hidden />항공 구간 추가</button>
        </>}
        {kind === "STAY" && <>
          {field("address_text", stayRules.address_text)}
          <div className="plan-pair">{field("check_in_local_date", stayRules.check_in_local_date)}
            {field("check_out_local_date", stayRules.check_out_local_date)}</div>
          <details><summary className="quiet-link">체크인·체크아웃 시각과 인원</summary>
            <div className="plan-fields">
              <div className="plan-pair">{field("check_in_local_time", stayRules.check_in_local_time)}{field("check_out_local_time", stayRules.check_out_local_time)}</div>
              <div className="plan-pair">{field("guest_count", stayRules.guest_count)}{field("room_count", stayRules.room_count)}</div>
            </div>
          </details>
        </>}
        {kind === "TOUR" && <>
          {field("event_local_date", tourRules.event_local_date)}
          {field("meeting_place_name", tourRules.meeting_place_name)}
          <details><summary className="quiet-link">시작·집합 시각과 주소</summary>
            <div className="plan-fields">
              <div className="plan-pair">{field("event_local_time", tourRules.event_local_time)}{field("meeting_local_time", tourRules.meeting_local_time)}</div>
              {field("meeting_address_text", tourRules.meeting_address_text)}
              <details><summary className="quiet-link">집합 장소 좌표</summary>
                <div className="plan-pair">{field("meeting_latitude", tourRules.meeting_latitude)}{field("meeting_longitude", tourRules.meeting_longitude)}</div>
              </details>
            </div>
          </details>
        </>}
        <details><summary className="quiet-link">공유용 메모</summary>{note("shared_note", "공유용 메모 내용")}</details>
        <details><summary className="quiet-link">비공개 정보</summary>
          <div className="plan-fields">
            {field("confirmation_reference", privateRules.confirmation_reference)}
            <div className="plan-pair">{field("amount", privateRules.amount)}{field("currency", privateRules.currency)}</div>
            {note("private_note", "개인 메모")}
          </div>
        </details>
        {impact}
      </>}
    </fieldset>
    {kind && <Footer back={back} state={state} pending={pending} />}
  </form>;
}

export function BookingDelete({ action, back, children }: { action: Action; back: string; children: ReactNode }) {
  const [state, dispatch, pending] = useActionState(action, {});
  return <form className="booking-editor" action={dispatch}>
    {children}
    <Footer back={back} state={state} pending={pending} danger />
  </form>;
}
