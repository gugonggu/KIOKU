"use client";

import { CalendarDays, Clock3, MapPin, Search, SquarePen } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { suggestionFields, type PlaceSuggestion } from "@/lib/geoapify";
import { dateLabel } from "@/lib/trip-details";
import { periods, planCalendar as calendar, planLimits } from "@/lib/trip-plan";
import type { PlanSchedule } from "@/lib/trip-plan-data";
import type { ItineraryState } from "./actions";
import { PlaceSearch } from "../map/place-editor";

type Action = (state: ItineraryState, form: FormData) => Promise<ItineraryState>;

function FormFooter({ state, pending, cancel, label, danger }: {
  state: ItineraryState; pending: boolean; cancel: string; label: string; danger?: boolean;
}) {
  return <>
    {state.error && !pending && <div className="notice notice-error" role="alert">
      {state.error}
      {state.refresh && <Link className="quiet-link" href={cancel}>최신 목록 보기</Link>}
    </div>}
    {state.outside && !pending && <p className="notice" role="alert">
      {dateLabel(state.outside.date)}은(는) 여행 기간 밖이에요. 이 날짜로 저장할까요?
    </p>}
    <div className="state-actions editorial-form-actions">
      <button type="submit" className={danger ? "primary-button danger-button" : "primary-button"} disabled={pending || state.refresh}
        name={state.outside ? "outside_confirmation" : undefined} value={state.outside?.key}>
        {pending ? "처리 중…" : state.outside ? "기간 밖 일정 저장 확인" : label}
      </button>
      <Link className="quiet-link" href={cancel}>취소</Link>
    </div>
    {pending && <p className="sr-only" role="status">일정을 처리하는 중이에요.</p>}
  </>;
}

export function ScheduleEditor({ action, cancel, item, date, places, initialPlace, quickTripId }: {
  action: Action; cancel: string; item?: PlanSchedule; date: string | null; places: { id: string; name: string }[];
  initialPlace?: { id: string; name: string };
  quickTripId?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [values, setValues] = useState<Record<string, string>>({
    title: item?.title ?? initialPlace?.name ?? "", kind: item?.kind ?? (initialPlace ? "PLACE" : "NOTE"), local_date: item ? item.local_date ?? "" : date ?? "",
    time_mode: item?.time_mode ?? "UNSCHEDULED", fixed_local_time: item?.fixed_local_time?.slice(0, 5) ?? "",
    period: item?.period ?? "", place_id: item?.place_id ?? initialPlace?.id ?? "", private_note: item?.private_note ?? "", shared_note: item?.shared_note ?? "",
  });
  const set = (key: string, value: string) => setValues((previous) => ({ ...previous, [key]: value }));
  const [source, setSource] = useState<"manual" | "saved" | "search">("manual");
  const [placeQuery, setPlaceQuery] = useState("");
  const [external, setExternal] = useState<{ id: string; result: PlaceSuggestion }>();
  const matched = places.filter(({ name }) => name.normalize("NFKC").toLowerCase()
    .includes(placeQuery.normalize("NFKC").trim().toLowerCase()));
  const activePlace = places.find(({ id }) => id === values.place_id);
  const selecting = Boolean(quickTripId && source !== "manual");
  const selected = external?.result ?? activePlace;

  function choosePlace(name: string, id: string) {
    setValues((previous) => ({ ...previous, title: name.slice(0, planLimits.title), kind: "PLACE", place_id: id }));
    setSource("manual");
    setPlaceQuery("");
  }
  function field(name: string, label: string, options: React.ComponentProps<"input"> = {}) {
    return <label className="form-field"><span>{label}</span><Input name={name} value={values[name]}
      onChange={(event) => set(name, event.target.value)} {...options} /></label>;
  }
  function notes(name: string, label: string) {
    return <label className="form-field"><span>{label}</span><textarea className="plan-input" name={name}
      rows={3} maxLength={planLimits.notes} value={values[name]} onChange={(event) => set(name, event.target.value)} /></label>;
  }
  return <form className={quickTripId ? "editorial-quick-form" : "plan-card"} action={dispatch}
    onSubmit={(event) => { if (selecting) event.preventDefault(); }}>
    <fieldset className="plan-fields" disabled={pending}>
      {quickTripId && <>
        <div className="editorial-sources" role="group" aria-label="일정 입력 방식">
          <button type="button" aria-pressed={source === "manual"} onClick={() => setSource("manual")}><SquarePen size={15} aria-hidden />직접 입력</button>
          <button type="button" aria-pressed={source === "saved"} onClick={() => setSource("saved")}><MapPin size={15} aria-hidden />저장한 장소</button>
          <button type="button" aria-pressed={source === "search"} onClick={() => setSource("search")}><Search size={15} aria-hidden />장소 검색</button>
        </div>
        {source === "search" && <PlaceSearch tripId={quickTripId} schedule choose={(place) => {
          setExternal({ id: crypto.randomUUID(), result: place });
          choosePlace(place.name, "");
        }} />}
        {source === "saved" && (places.length ? <div className="editorial-saved-picker">
          <label className="form-field"><span>저장한 장소 찾기</span><Input type="search" value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} /></label>
          {matched.length ? <ul>{matched.map((place) => <li key={place.id}><button type="button" className="quiet-link" onClick={() => {
            setExternal(undefined);
            choosePlace(place.name, place.id);
          }}><MapPin size={16} aria-hidden />{place.name}</button></li>)}</ul>
            : <p className="plan-meta">일치하는 장소가 없어요.</p>}
        </div> : <p className="plan-empty">저장한 장소가 없어요.</p>)}
      </>}
      {!selecting && <>
      {quickTripId && selected && <div className="editorial-selected-place">
        <MapPin size={18} aria-hidden /><div><span>{external ? "검색한 장소 · 저장 후 연결" : "저장한 장소 · 일정에 연결"}</span>
          <strong>{selected.name}</strong></div>
        <button type="button" className="quiet-link" onClick={() => {
          setExternal(undefined);
          setValues((previous) => ({ ...previous, kind: "NOTE", place_id: "" }));
        }}>연결 해제</button>
      </div>}
      {external && <>
        <input type="hidden" name="search_place_id" value={external.id} />
        {Object.entries(suggestionFields(external.result)).map(([name, value]) =>
          <input key={name} type="hidden" name={name} value={value} />)}
      </>}
      {field("title", "일정 이름", { required: true, maxLength: planLimits.title, placeholder: quickTripId ? "예: 오도리 공원 산책" : undefined })}
      {quickTripId && <div className="editorial-quick-context">
        <span><CalendarDays size={16} aria-hidden />{values.local_date ? dateLabel(values.local_date) : "날짜 미정 · 후보함"}</span>
        <span><Clock3 size={16} aria-hidden />{values.time_mode === "FIXED" ? values.fixed_local_time || "정확한 시각" :
          values.time_mode === "PERIOD" ? periods[values.period as keyof typeof periods] || "시간대 선택" : "시간 미정"}</span>
      </div>}
      <details open={item || initialPlace ? true : undefined}>
        <summary className="quiet-link">일정 상세 설정</summary>
        <div className="plan-fields itinerary-details">
          <div className="plan-pair">
            {field("local_date", "일정 날짜", { ...calendar, required: Boolean(item?.local_date || values.time_mode !== "UNSCHEDULED") })}
            <label className="form-field"><span>시간 방식</span><select className="plan-input" name="time_mode" value={values.time_mode}
              onChange={(event) => set("time_mode", event.target.value)}>
              <option value="UNSCHEDULED">시간 미정</option><option value="FIXED">정확한 시각</option><option value="PERIOD">오전·오후·저녁</option>
            </select></label>
          </div>
          {values.time_mode === "FIXED" && field("fixed_local_time", "일본 현지 시각", { type: "time", required: true })}
          {values.time_mode === "PERIOD" && <div className="form-field"><label htmlFor="itinerary-period">시간대</label><select id="itinerary-period" required className="plan-input" name="period"
            value={values.period} onChange={(event) => set("period", event.target.value)}>
            <option value="">시간대 선택</option>
            {Object.entries(periods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></div>}
          <label className="form-field"><span>일정 유형</span><select className="plan-input" name="kind" value={values.kind}
            onChange={(event) => set("kind", event.target.value)}>
            <option value="NOTE">메모</option><option value="PLACE">장소 방문</option><option value="MOVE">이동</option>
          </select></label>
          {places.length > 0 && <label className="form-field"><span>연결할 장소</span><select className="plan-input" name="place_id" value={values.place_id}
              onChange={(event) => { setExternal(undefined); set("place_id", event.target.value); }}>
            <option value="">장소 연결 안 함</option>
            {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
          </select></label>}
          {notes("private_note", "개인 메모")}
          {notes("shared_note", "공유용 메모")}
        </div>
      </details>
      </>}
    </fieldset>
    {!selecting && <FormFooter state={state} pending={pending} cancel={cancel} label="일정 저장" />}
  </form>;
}

export function PlacementForm({ action, cancel, mode, date, title }: {
  action: Action; cancel: string; mode: "move" | "restore" | "delete"; date: string | null; title: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [value, setValue] = useState(date ?? "");
  const labels = { move: "날짜 이동", restore: "원래 일정으로 복원", delete: "일정 삭제 확인" } as const;
  return <form className="plan-card" action={dispatch}>
    <p><strong>{title}</strong></p>
    {mode === "move" && <label className="form-field"><span>옮길 날짜</span><Input name="local_date" {...calendar} required value={value}
      readOnly={pending} onChange={(event) => setValue(event.target.value)} /></label>}
    {mode === "restore" && date && <p>{dateLabel(date)}의 원래 시간대로 복원해요.</p>}
    {mode === "delete" && <p>일정을 삭제하면 후보함에서 복원할 수 없어요.</p>}
    <FormFooter state={state} pending={pending} cancel={cancel} label={labels[mode]} danger={mode === "delete"} />
  </form>;
}

export function ArchiveButton({ action }: { action: Action }) {
  const [state, dispatch, pending] = useActionState(action, {});
  return <form action={dispatch} className="plan-action">
    <button className="quiet-link" disabled={pending || state.refresh}>{pending ? "보관 중…" : "후보로 보관"}</button>
    {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
  </form>;
}
