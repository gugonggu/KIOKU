"use client";

import { CalendarPlus, Copy, List, Map as MapIcon, MapPinOff, Navigation, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Blossom } from "@/components/brand";
import { Input } from "@/components/ui/input";
import { dateLabel, type Trip } from "@/lib/trip-details";
import { directionsUrl, filterPlaces, searchPlaces, type PlaceFilter } from "@/lib/trip-places";
import { sortSchedule } from "@/lib/trip-plan";
import type { PlaceVisit, PlanPlace } from "@/lib/trip-plan-data";
import { DayCards, timeLabel, TripTabs } from "../editorial";
import { itineraryEntryHref, itineraryHref } from "../itinerary/links";
import { mapHref, type MapContext, type MapView } from "./links";
import { MapCanvas, mapLatitudeLimit, type MapPin } from "./map-canvas";

const filters: [PlaceFilter, string][] = [["all", "전체"], ["date", "날짜별"], ["candidates", "후보 장소"], ["unlocated", "좌표 없음"]];
const mobileMap = "(max-width: 839px)";

function subscribeToMobileMap(notify: () => void) {
  const media = window.matchMedia(mobileMap);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

function hasCoordinates({ latitude, longitude }: PlanPlace) {
  return latitude !== null && longitude !== null;
}

function useMapContext(date: string, filter: PlaceFilter): MapContext & { view: MapView; query: string; route: boolean } {
  const params = useSearchParams();
  const place = params.get("place") ?? undefined;
  const mode = params.get("view");
  return { date, filter, place, view: mode === "map" || mode === "list" ? mode : place ? "map" : "list",
    query: params.get("q")?.slice(0, 100) ?? "", route: params.get("route") === "1" };
}

export function PlaceAddLink({ tripId, date, filter }: { tripId: string; date: string; filter: PlaceFilter }) {
  const context = useMapContext(date, filter);
  return <Link className="primary-button places-add" href={mapHref(tripId, { ...context, mode: "add" })} scroll={false}
    data-itinerary-add><Plus size={18} aria-hidden />장소 추가</Link>;
}

export function PlacesTabs({ tripId, date, filter, itineraryDate }: { tripId: string; date: string; filter: PlaceFilter; itineraryDate: string | null }) {
  const context = useMapContext(date, filter);
  return <TripTabs href={`/trips/${tripId}`} active="map" date={itineraryDate} mapLink={mapHref(tripId, context)} />;
}

export function PlacesView({ places, links, trip, date, filter, itineraryDate }: {
  places: PlanPlace[]; links: PlaceVisit[]; trip: Pick<Trip, "id" | "start_date" | "end_date">; date: string; filter: PlaceFilter;
  itineraryDate: string | null;
}) {
  const tripId = trip.id;
  const router = useRouter();
  const context = useMapContext(date, filter);
  const { view, query: find, place: selected, route: showRoute } = context;
  const searchInput = useRef<HTMLInputElement>(null);
  const routeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchInput.current && searchInput.current.value !== find) searchInput.current.value = find; }, [find]);
  useEffect(() => { if (routeInput.current) routeInput.current.checked = showRoute; }, [showRoute]);
  const [nearbyPins, setNearbyPins] = useState<MapPin[]>([]);
  const compact = useSyncExternalStore(subscribeToMobileMap, () => window.matchMedia(mobileMap).matches, () => false);
  const filtersOnMap = compact && view === "map";
  const [copyMessage, setCopyMessage] = useState("");
  const visible = useMemo(() => filterPlaces(places, links, filter, date), [places, links, filter, date]);
  const shown = useMemo(() => searchPlaces(visible, find), [visible, find]);
  const ordered = useMemo(() => filter === "date" ? sortSchedule(links.filter((entry) => entry.local_date === date)) : [], [links, filter, date]);
  const firstVisits = useMemo(() => {
    const slots = new Map<string, number>();
    ordered.forEach(({ place_id }, index) => { if (place_id && !slots.has(place_id)) slots.set(place_id, index + 1); });
    return slots;
  }, [ordered]);
  const pins = useMemo(() => {
    const markers: MapPin[] = [];
    for (const { id, display_name, latitude, longitude } of shown) {
      if (latitude !== null && longitude !== null && Math.abs(latitude) <= mapLatitudeLimit) {
        markers.push({ id, label: display_name, point: [longitude, latitude], number: firstVisits.get(id) ?? markers.length + 1 });
      }
    }
    return markers;
  }, [shown, firstVisits]);
  const numbers = useMemo(() => new Map(pins.map(({ id, number }) => [id, number])), [pins]);
  const dayVisits = useMemo(() => {
    const matches = new Map(shown.map((place) => [place.id, place]));
    return ordered.flatMap((entry, index) => {
      const place = entry.place_id ? matches.get(entry.place_id) : undefined;
      return place ? [{ entry, place, number: index + 1 }] : [];
    });
  }, [ordered, shown]);
  const routeSegments = useMemo(() => {
    const points = new Map(pins.map(({ id, point }) => [id, point]));
    return dayVisits.flatMap(({ place, number }, index) => {
      const next = dayVisits[index + 1];
      const from = points.get(place.id);
      const to = next && points.get(next.place.id);
      return from && to && next.number === number + 1 && place.id !== next.place.id ? [[from, to]] : [];
    });
  }, [dayVisits, pins]);
  const visits = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { place_id } of links) if (place_id) counts.set(place_id, (counts.get(place_id) ?? 0) + 1);
    return counts;
  }, [links]);
  const item = shown.find(({ id }) => id === selected);
  const number = item && numbers.get(item.id);
  const address = item?.address_ja || item?.address_text;
  const directions = item ? directionsUrl(item) : null;
  const names = item ? [...new Set([item.name_ko, item.name_ja, item.name_en].filter((name) => name && name !== item.display_name))] : [];
  const linked = item ? visits.get(item.id) ?? 0 : 0;
  const linkedItems = item ? links.filter((entry) => entry.place_id === item.id) : [];
  const scheduleHref = item && `${itineraryHref(tripId, filter === "date" ? date : itineraryDate, "add", undefined,
    !itineraryDate && filter !== "date")}&place=${item.id}`;

  function updateContext(change: MapContext, replace = false) {
    const href = mapHref(tripId, { ...context, ...change });
    if (href === window.location.pathname + window.location.search) return;
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  }

  function select(id?: string, nearby: MapPin[] = []) {
    setCopyMessage("");
    setNearbyPins(nearby);
    updateContext({ place: id });
  }

  const filterLinks = <nav className="places-filters" aria-label="표시할 장소">
    {filters.map(([key, label]) => <Link key={key} href={mapHref(tripId, { ...context, filter: key })}
      scroll={false} aria-current={filter === key ? "page" : undefined}>{label}</Link>)}
  </nav>;
  const dayPicker = filter === "date" && <div className="places-days">
    {trip.start_date && trip.end_date && date >= trip.start_date && date <= trip.end_date &&
      <DayCards trip={trip} date={date} href={(day) => mapHref(tripId, { ...context, date: day })} />}
    <details className="editorial-date-tools">
      <summary>날짜 직접 선택</summary>
      <form className="plan-date-picker" onSubmit={(event) => {
        event.preventDefault();
        const day = new FormData(event.currentTarget).get("date");
        if (typeof day === "string") router.push(mapHref(tripId, { ...context, date: day }), { scroll: false });
      }}>
        <Input key={date} aria-label="장소를 볼 날짜" name="date" type="date" min="0001-01-01" max="9999-12-31" defaultValue={date} required />
        <button type="submit" className="quiet-link">이동</button>
      </form>
    </details>
  </div>;
  const search = places.length > 0 && <label className="places-find">
    <Search size={16} aria-hidden />
    <input ref={searchInput} type="search" aria-label="저장된 장소 찾기" placeholder="이름이나 주소로 찾기" defaultValue={find} maxLength={100}
      onChange={(event) => { setNearbyPins([]); updateContext({ query: event.target.value }, true); }} />
  </label>;
  const routeControl = filter === "date" && <label className="place-route-toggle">
    <input ref={routeInput} type="checkbox" defaultChecked={showRoute} onChange={(event) => updateContext({ route: event.target.checked })} />
    여행 동선 표시
  </label>;
  const visitList = filter === "date" && showRoute && <section className="place-route" aria-label="날짜별 방문 순서">
    <h3>방문 순서 <span className="plan-meta">{dayVisits.length}회 · 장소 {shown.length}곳</span></h3>
    <p className="plan-meta">점선은 방문 순서를 보여줘요. 실제 도로·도보 경로와 이동 거리는 표시되지 않아요.</p>
    {dayVisits.length ? <ol>{dayVisits.map(({ entry, place, number }) => <li key={entry.id} value={number}>
      <button type="button" className="quiet-link" onClick={() => select(place.id)}>{place.display_name}</button>
      <span className="plan-meta">{timeLabel(entry)} · {entry.title}{!numbers.has(place.id) && " · 지도 핀 없음"}</span>
    </li>)}</ol> : <p className="plan-meta">표시할 방문 일정이 없어요.</p>}
  </section>;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage("복사했어요.");
    } catch {
      setCopyMessage("복사할 수 없어요. 장소 정보에서 텍스트를 선택해 주세요.");
    }
  }

  return <div className="places-shell" data-view={view} data-filter={filter} data-selected={item ? "true" : undefined}>
    <div className="places-mobile-tools" data-search={filtersOnMap && search ? "true" : undefined}>
      <div className="places-view-toggle" role="group" aria-label="장소 보기 방식">
        <button type="button" aria-pressed={view === "list"} onClick={() => updateContext({ view: "list" })}><List size={17} aria-hidden />목록</button>
        <button type="button" aria-pressed={view === "map"} onClick={() => updateContext({ view: "map" })}><MapIcon size={17} aria-hidden />지도</button>
      </div>
      {filtersOnMap && search}
    </div>

    <section className="places-list-panel editorial-paper" aria-labelledby="places-list">
      <div className="places-list-heading">
        <h2 id="places-list">저장된 장소</h2>
        <span className="plan-meta" role="status">{shown.length}곳</span>
      </div>
      {!filtersOnMap && <>{filterLinks}{dayPicker}{search}{routeControl}{visitList}</>}
      {shown.length ? <ul className="places-cards">{shown.map((place) => {
        const pin = numbers.get(place.id);
        const count = visits.get(place.id) ?? 0;
        return <li key={place.id}>
          <button type="button" className="place-card" aria-pressed={place.id === item?.id} onClick={() => select(place.id)}>
            <span className="place-number" data-empty={pin ? undefined : "true"} aria-hidden>
              {pin ?? <MapPinOff size={15} />}
            </span>
            <span className="place-card-copy">
              <strong>{place.display_name}</strong>
              {place.name_ja && place.name_ja !== place.display_name && <span lang="ja">{place.name_ja}</span>}
              <span>{place.address_ja || place.address_text || "주소 미정"}</span>
              {!pin && <span className="place-pin-status">{hasCoordinates(place) ? "지도 범위 밖" : "좌표 없음"}</span>}
            </span>
            <span className="place-card-meta">{count ? `일정 ${count}` : "일정 없음"}</span>
          </button>
          {filter === "unlocated" && <Link className="quiet-link place-coordinate-edit" href={mapHref(tripId, { ...context, place: place.id, mode: "edit" })}
            aria-label={`${place.display_name} 위치 수정`} scroll={false}>위치 수정</Link>}
        </li>;
      })}</ul> : <div className="places-empty">
        <Blossom className="places-empty-sprig" />
        <p className="plan-empty">{!places.length ? "저장된 장소가 없어요." : visible.length ? "찾는 장소가 없어요." : "이 조건에 해당하는 장소가 없어요."}</p>
        {find && <button type="button" className="quiet-link" onClick={() => updateContext({ query: "" }, true)}>검색 지우기</button>}
        {!places.length && <Link className="quiet-link" href={mapHref(tripId, { ...context, mode: "add" })} scroll={false}>검색으로 첫 장소 등록</Link>}
      </div>}
    </section>

    <div className="places-stage">
      {filtersOnMap && <div className="places-map-filters">
        {filter === "date" ? <details className="place-map-date-options">
          <summary className="quiet-link">{dateLabel(date)} · 필터와 동선</summary>
          {filterLinks}{dayPicker}{routeControl}
        </details> : filterLinks}
      </div>}
      {!pins.length && <p className="plan-meta place-map-empty" role="status">
        {shown.length ? "검색 조건에 맞는 장소에 표시할 지도 핀이 없어요." : find ? "찾는 장소가 없어 지도 핀이 없어요." : "표시할 지도 핀이 없어요."}
      </p>}
      <MapCanvas pins={pins} selected={item?.id} onSelect={select} route={showRoute ? routeSegments : undefined} />
      {item && <article key={`${item.id}/${item.content_version}`} className="place-detail editorial-paper" aria-label="선택한 장소">
        <header>
          <span className="place-number" data-empty={number ? undefined : "true"} aria-hidden>{number ?? <MapPinOff size={15} />}</span>
          <div>
            <h2>{item.display_name}</h2>
            {names.length > 0 && <p className="plan-meta">{names.join(" · ")}</p>}
          </div>
          <button type="button" className="editorial-icon-button" aria-label="선택 닫기" onClick={() => select()}>
            <X size={19} aria-hidden />
          </button>
        </header>
        <div className="place-detail-body">
          {item.address_text && <p>{item.address_text}</p>}
          {item.address_ja && item.address_ja !== item.address_text && <p lang="ja">{item.address_ja}</p>}
          {!address && <p className="plan-meta">주소 미정</p>}
          {!hasCoordinates(item) && <p className="plan-meta">좌표가 없어 지도에 핀이 표시되지 않아요.</p>}
          {hasCoordinates(item) && !number && <p className="plan-meta">이 좌표는 지도 표시 범위 밖이에요.</p>}
          {item.notes && <p className="plan-notes">{item.notes}</p>}
          <p className="plan-meta">{linked ? `연결된 일정 ${linked}개` : "아직 연결된 일정이 없어요."}</p>
          {linkedItems.length > 0 && <ul className="booking-impact-list">
            {linkedItems.map((entry) => <li key={entry.id}>
              <Link className="quiet-link" href={itineraryEntryHref(tripId, entry, itineraryDate)}>{entry.title}</Link>
              <span className="plan-meta">{entry.local_date ? dateLabel(entry.local_date) : "후보함"} · {timeLabel(entry)}</span>
            </li>)}
          </ul>}
        </div>
        <div className="place-detail-actions">
          <Link className="primary-button" href={scheduleHref!}><CalendarPlus size={17} aria-hidden />일정에 추가</Link>
          {directions ? <a className="quiet-link" href={directions} target="_blank" rel="noopener noreferrer">
            <Navigation size={16} aria-hidden /><span>Google Maps 길찾기</span></a> :
            <p className="plan-meta">길찾기를 열려면 주소나 좌표를 등록해 주세요.</p>}
          <button type="button" className="quiet-link" onClick={() => copy(address || item.display_name)}>
            <Copy size={16} aria-hidden /><span>{address ? "주소 복사" : "이름 복사"}</span></button>
          {number && view === "list" && <button type="button" className="quiet-link place-detail-map" onClick={() => updateContext({ view: "map" })}>
            <MapIcon size={16} aria-hidden /><span>지도에서 보기</span></button>}
        </div>
        {copyMessage && <p className="plan-meta" role="status">{copyMessage}</p>}
        {nearbyPins.length > 1 && nearbyPins.some(({ id }) => id === item.id) && <div className="place-nearby" role="group" aria-label="가까운 지도 핀">
          <p className="plan-meta">가까운 지도 핀</p>
          <div className="place-nearby-options">
            {nearbyPins.filter(({ id }) => numbers.has(id)).map(({ id, label, number }) => <button key={id} type="button" className="quiet-link"
              aria-pressed={id === selected} onClick={() => select(id, nearbyPins)}>
              <span>{number}</span> {label}
            </button>)}
          </div>
        </div>}
        <footer className="place-detail-manage">
          <Link className="quiet-link" href={mapHref(tripId, { ...context, place: item.id, mode: "edit" })} scroll={false}>장소 수정</Link>
          <Link className="quiet-link danger-link" href={mapHref(tripId, { ...context, place: item.id, mode: "delete" })} scroll={false}>장소 삭제</Link>
          {item.provider === "GEOAPIFY" && <p className="plan-meta">출처 <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a></p>}
        </footer>
      </article>}
    </div>
    {filtersOnMap && visitList}
  </div>;
}
