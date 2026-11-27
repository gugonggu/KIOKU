"use client";

import { MapPin, Search, SquarePen } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { suggestionFields, type PlaceSuggestion, type GeoapifyResult } from "@/lib/geoapify";
import { parseGoogleMapsCoordinates, placeLimits, validCoordinates } from "@/lib/trip-places";
import type { PlanPlace } from "@/lib/trip-plan-data";
import type { PlaceState } from "./actions";
import { MapCanvas, mapLatitudeLimit, type MapPin as CanvasPin } from "./map-canvas";

type Action = (state: PlaceState, form: FormData) => Promise<PlaceState>;
const searchMessages = {
  unconfigured: "이 서비스에서 장소 검색을 사용할 수 없어요.",
  limited: "검색 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
  unavailable: "장소 검색에 일시적인 문제가 있어요. 다시 시도해 주세요.",
};

export function PlaceSearch({ tripId, choose, schedule = false, onFallback }: {
  tripId: string; choose: (row: PlaceSuggestion) => void; schedule?: boolean; onFallback?: (query: string) => void;
}) {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<{ query: string; result: GeoapifyResult }>();
  const [attempt, setAttempt] = useState(0);
  const query = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  const valid = query.length >= 2 && query.length <= 100;
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const delay = setTimeout(async () => {
      try {
        const search = new URLSearchParams({ tripId, q: query });
        const reply = await fetch(`/api/places/search?${search}`, { signal: controller.signal, cache: "no-store" });
        const result = await reply.json() as GeoapifyResult;
        if (!controller.signal.aborted) {
          const known = result.status === "unconfigured" || result.status === "limited" || (result.status === "ok" && Array.isArray(result.results));
          setResponse({ query, result: known ? result : { status: "unavailable" } });
        }
      } catch {
        if (!controller.signal.aborted) setResponse({ query, result: { status: "unavailable" } });
      }
    }, 400);
    return () => { clearTimeout(delay); controller.abort(); };
  }, [tripId, query, valid, attempt]);

  const result = valid && response?.query === query ? response.result : null;
  return <section className="plan-card" aria-label="일본 장소 검색">
    <label className="form-field"><span>일본 장소 검색</span><Input type="search" value={input} maxLength={100}
      onChange={(event) => setInput(event.target.value)} autoComplete="off" placeholder="삿포로역, 札幌駅, Sapporo" /></label>
    {!valid && <p className="plan-meta">두 글자 이상 입력해 주세요.</p>}
    {valid && !result && <p className="plan-meta" role="status">장소를 검색하는 중이에요.</p>}
    {result?.status === "ok" && result.alternate && result.results.length > 0 && <p className="notice" role="status">
      한국어 이름으로는 찾지 못해 영문 표기 ‘{result.alternate}’로 찾은 결과예요. 이름과 주소를 확인해 주세요.</p>}
    {result?.status === "ok" && (result.results.length ? <ul className="places-suggestions">
      {result.results.map((row) => <li key={row.id}><button type="button" className="quiet-link" onClick={() => { choose(row); setInput(""); }}>
        <strong>{row.name}</strong>
        {(row.kind || row.area) && <small className="places-suggestion-meta">{[row.kind, row.area].filter(Boolean).join(" · ")}</small>}
        {row.address && <span>{row.address}</span>}
      </button></li>)}
    </ul> : <div className="notice" role="status">
      <p>{schedule ? "검색 결과가 없어요. 일정 이름을 직접 입력할 수 있어요." : "검색 결과가 없어요. 장소를 직접 등록할 수 있어요."}</p>
      <p className="plan-meta">일본어나 영어 이름(예: 札幌駅, Sapporo Station)으로 찾으면 결과가 나올 수 있어요.</p>
    </div>)}
    {result && result.status !== "ok" && <div className="notice" role="status">
      <p>{searchMessages[result.status]}</p>
      {result.status === "unavailable" && <button type="button" className="quiet-link"
        onClick={() => { setResponse(undefined); setAttempt((count) => count + 1); }}>다시 검색</button>}
    </div>}
    {onFallback && result && (result.status !== "ok" || !result.results.length) &&
      <button type="button" className="quiet-link places-fallback" onClick={() => onFallback(query)}>
        <SquarePen size={16} aria-hidden />{schedule ? `“${query}” 이름으로 일정 추가` : `“${query}” 직접 등록으로 계속`}</button>}
    <p className="plan-meta">검색 제공 <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a></p>
  </section>;
}

export function PlaceEditor({ action, tripId, item, back, start }: {
  action: Action; tripId: string; item?: PlanPlace; back: string; start?: [number, number];
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [picker, setPicker] = useState(false);
  const [mapUrl, setMapUrl] = useState("");
  const [locationMessage, setLocationMessage] = useState<{ error: boolean; text: string }>();
  const [source, setSource] = useState<"search" | "manual">(item ? "manual" : "search");
  const [values, setValues] = useState<Record<string,string>>({
    display_name: item?.display_name ?? "", address_text: item?.address_text ?? "", address_ja: item?.address_ja ?? "",
    name_ko: item?.name_ko ?? "", name_ja: item?.name_ja ?? "", name_en: item?.name_en ?? "", notes: item?.notes ?? "",
    latitude: item?.latitude?.toString() ?? "", longitude: item?.longitude?.toString() ?? "",
    provider: item?.provider ?? "MANUAL", provider_place_id: item?.provider_place_id ?? "",
  });
  function updateCoordinates(latitude: string, longitude: string) {
    setSource("manual");
    setValues((before) => ({ ...before, latitude, longitude, provider: "MANUAL", provider_place_id: "" }));
  }
  function setPoint([longitude, latitude]: [number, number]) {
    updateCoordinates(String(Number(latitude.toFixed(6))), String(Number(longitude.toFixed(6))));
    setLocationMessage({ error: false, text: "위치를 선택했어요. 장소를 저장하면 적용돼요." });
  }
  function field(name: string, label: string, options: React.ComponentProps<"input"> = {}) {
    return <label className="form-field"><span>{label}</span><Input name={name} value={values[name]}
      onChange={(event) => {
        const { value } = event.target;
        if (name === "latitude" || name === "longitude") {
          updateCoordinates(name === "latitude" ? value : values.latitude, name === "longitude" ? value : values.longitude);
          setLocationMessage(undefined);
        } else setValues((before) => ({ ...before, [name]: value }));
      }} {...options} /></label>;
  }
  function choose(row: PlaceSuggestion) {
    setValues((before) => ({ ...before, ...suggestionFields(row) }));
  }
  const chosen = values.provider === "GEOAPIFY";
  const searching = !item && source === "search" && !chosen;
  const toManual = () => setValues((before) => ({ ...before, provider: "MANUAL", provider_place_id: "" }));
  const existing = state.duplicate ?? state.existing;
  const lat = Number(values.latitude);
  const lon = Number(values.longitude);
  const located = Boolean(values.latitude && values.longitude && validCoordinates(lat, lon));
  const pickerPins: CanvasPin[] = located && Math.abs(lat) <= mapLatitudeLimit
    ? [{ id: "position-preview", label: "선택한 위치", point: [lon, lat], number: 1 }] : [];
  const existingHref = new URL(back, "https://kioku.example");
  if (existing) existingHref.searchParams.set("place", existing);
  return <div className="place-editor">
    {!item && <div className="editorial-sources places-sources" role="group" aria-label="장소 등록 방식">
      <button type="button" aria-pressed={source === "search"} onClick={() => setSource("search")}><Search size={15} aria-hidden />장소 검색</button>
      <button type="button" aria-pressed={source === "manual"} onClick={() => { setSource("manual"); if (chosen) toManual(); }}>
        <SquarePen size={15} aria-hidden />직접 입력</button>
    </div>}
    {searching && <PlaceSearch tripId={tripId} choose={choose} onFallback={(query) => {
      setValues((before) => ({ ...before, display_name: before.display_name || query.slice(0, placeLimits.name) }));
      setSource("manual");
    }} />}
    {!searching && <form className="editorial-quick-form place-editor-form" action={dispatch}>
      <fieldset className="plan-fields" disabled={pending}>
        {chosen && <div className="editorial-selected-place place-chosen">
          <MapPin size={18} aria-hidden />
          <div><span>검색한 장소 · Geoapify</span><strong>{values.display_name || "이름 없음"}</strong>
            {values.address_text && <small>{values.address_text}</small>}</div>
          {!item && <button type="button" className="quiet-link" onClick={() => {
            setValues((before) => ({ ...before, display_name: "", address_text: "", address_ja: "", latitude: "", longitude: "",
              name_ko: "", name_ja: "", name_en: "", provider: "MANUAL", provider_place_id: "" }));
            setSource("search");
          }}>다시 검색</button>}
        </div>}
        {chosen && <div className="place-chosen-note">
          <p className="plan-meta">Geoapify에서 가져온 장소예요. 정보를 확인한 뒤 저장해 주세요.</p>
          <button type="button" className="quiet-link" onClick={() => { toManual(); setSource("manual"); }}>직접 입력으로 전환</button>
        </div>}
        <input type="hidden" name="provider" value={values.provider} />
        <input type="hidden" name="provider_place_id" value={values.provider_place_id} />
        {field("display_name", "장소 이름", { required:true, maxLength:placeLimits.name, placeholder: chosen ? undefined : "예: 오도리 공원" })}
        {!chosen && field("address_text", "주소", { maxLength:placeLimits.address })}
        <div className="place-location-tools">
          {!located && <p className="plan-meta">좌표 없이 저장한 장소는 목록에서 볼 수 있어요.</p>}
          <button type="button" className="quiet-link" aria-expanded={picker} onClick={() => setPicker(!picker)}>
            <MapPin size={16} aria-hidden />{picker ? "지도 닫기" : located ? "지도에서 위치 확인·수정" : "지도에서 위치 선택"}
          </button>
          {picker && <>
            <p className="plan-meta">지도를 이동하거나 확대하고, 원하는 지점을 눌러 핀을 놓으세요. 좌표를 직접 입력할 수도 있어요.</p>
            <MapCanvas pins={pickerPins} onPick={setPoint} showLocation={false} start={start} />
            {located && <p className="plan-meta">위도 {values.latitude} · 경도 {values.longitude}{!pickerPins.length && " · 지도 표시 범위 밖"}</p>}
          </>}
          <details>
            <summary className="quiet-link">Google Maps 링크에서 좌표 입력</summary>
            <div className="place-coordinate-url">
              <Input inputMode="url" aria-label="Google Maps 링크" placeholder="https://www.google.com/maps/…" value={mapUrl}
                onChange={(event) => { setMapUrl(event.target.value); setLocationMessage(undefined); }} />
              <button type="button" className="secondary-button" onClick={() => {
                const point = parseGoogleMapsCoordinates(mapUrl);
                if (point) setPoint(point);
                else setLocationMessage({ error: true, text: "위도와 경도가 명시된 Google Maps 링크만 지원해요. 단축 링크나 장소 이름만 담긴 링크는 지도에서 위치를 고르거나 좌표를 직접 입력해 주세요." });
              }}>좌표 적용</button>
            </div>
          </details>
          {locationMessage && <p className={locationMessage.error ? "notice notice-error" : "plan-meta"}
            role={locationMessage.error ? "alert" : "status"}>{locationMessage.text}</p>}
        </div>
        <details className="place-editor-more" open={item ? true : undefined}>
          <summary className="quiet-link">{chosen ? "주소·좌표·다국어 이름·메모" : "좌표·다국어 이름·메모"}</summary>
          <div className="plan-fields itinerary-details">
            {chosen && field("address_text", "주소", { maxLength:placeLimits.address })}
            <div className="plan-pair">
              {field("latitude", "위도", { type:"number", inputMode:"decimal", min:-90, max:90, step:"any" })}
              {field("longitude", "경도", { type:"number", inputMode:"decimal", min:-180, max:180, step:"any" })}
            </div>
            {field("name_ko", "한국어 이름", { maxLength:placeLimits.name })}
            {field("name_ja", "일본어 이름", { maxLength:placeLimits.name })}
            {field("name_en", "영어 이름", { maxLength:placeLimits.name })}
            {field("address_ja", "일본어 주소", { maxLength:placeLimits.address })}
            <label className="form-field"><span>장소 메모</span><textarea name="notes" rows={3} className="plan-input" maxLength={placeLimits.notes}
              value={values.notes} onChange={(event) => setValues((before) => ({ ...before, notes:event.target.value }))} /></label>
          </div>
        </details>
      </fieldset>
      {state.error && !pending && <p className="notice notice-error" role="alert">{state.error}</p>}
      {state.duplicate && !pending && <p className="notice" role="alert">이 여행에 같은 장소가 있어요. 기존 장소를 쓰거나 별도로 저장할 수 있어요.</p>}
      <div className="state-actions editorial-form-actions">
        <button type="submit" className="primary-button" disabled={pending || state.conflict || Boolean(state.existing)}
          name={state.duplicate ? "confirm_duplicate" : undefined} value={state.duplicate}>
          {pending ? "저장 중…" : state.duplicate ? "별도로 저장" : "장소 저장"}
        </button>
        {existing && <Link className="quiet-link" href={`${existingHref.pathname}${existingHref.search}`}>기존 장소 보기</Link>}
        <Link className="quiet-link" href={back}>취소</Link>
      </div>
    </form>}
  </div>;
}

export function DeletePlaceForm({ action, name, count, back }: { action: Action; name: string; count: number; back: string }) {
  const [state, dispatch, pending] = useActionState(action, {});
  const latest = state.linkCount ?? count;
  return <form className="editorial-quick-form" action={dispatch}>
    <p><strong>{name}</strong> 장소를 삭제할까요?</p>
    <p className="notice" role="status">{latest ? `연결된 일정 ${latest}개의 장소 연결을 해제합니다. 일정과 메모는 그대로 유지됩니다.` : "연결된 일정이 없어요."}</p>
    {state.linkCount !== undefined && <p className="notice" role="alert">연결된 일정 수가 바뀌었어요. 변경 내용을 다시 확인해 주세요.</p>}
    {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
    <div className="state-actions editorial-form-actions">
      <button type="submit" className="primary-button danger-button" name="confirm_count" value={latest}
        disabled={pending || state.conflict}>{pending ? "삭제 중…" : "장소 삭제 확인"}</button>
      <Link href={back} className="quiet-link">취소</Link>
    </div>
  </form>;
}
