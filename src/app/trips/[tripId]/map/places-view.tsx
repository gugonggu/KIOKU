"use client";

import { CalendarPlus, Copy, List, Map as MapIcon, MapPinOff, Navigation, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Blossom } from "@/components/brand";
import { directionsUrl, filterPlaces, type PlaceFilter, type PlaceLink } from "@/lib/trip-places";
import type { PlanPlace } from "@/lib/trip-plan-data";
import { itineraryHref } from "../itinerary/links";
import { mapHref } from "./links";
import { MapCanvas, mapLatitudeLimit, type MapPin } from "./map-canvas";

const filters: [PlaceFilter, string][] = [["all", "전체"], ["date", "날짜별"], ["candidates", "후보 장소"]];

function hasCoordinates({ latitude, longitude }: PlanPlace) {
  return latitude !== null && longitude !== null;
}

export function PlacesView({ places, links, tripId, date, filter, initialPlace, itineraryDate, dayPicker }: {
  places: PlanPlace[]; links: PlaceLink[]; tripId: string; date: string; filter: PlaceFilter; initialPlace?: string;
  itineraryDate: string | null; dayPicker?: ReactNode;
}) {
  const [selected, setSelected] = useState(initialPlace);
  const [nearbyPins, setNearbyPins] = useState<MapPin[]>([]);
  const [view, setView] = useState<"list" | "map">(initialPlace ? "map" : "list");
  const [find, setFind] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const visible = useMemo(() => filterPlaces(places, links, filter, date), [places, links, filter, date]);
  const pins = useMemo(() => visible.filter(({ latitude, longitude }) =>
    latitude !== null && longitude !== null && Math.abs(latitude) <= mapLatitudeLimit)
    .map(({ id, display_name, latitude, longitude }, index): MapPin => ({ id, label: display_name, point: [longitude!, latitude!], number: index + 1 })),
  [visible]);
  const numbers = useMemo(() => new Map(pins.map(({ id, number }) => [id, number])), [pins]);
  const visits = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { place_id } of links) if (place_id) counts.set(place_id, (counts.get(place_id) ?? 0) + 1);
    return counts;
  }, [links]);
  const needle = find.normalize("NFKC").trim().toLowerCase();
  const shown = needle ? visible.filter((place) => [place.display_name, place.name_ko, place.name_ja, place.name_en, place.address_text, place.address_ja]
    .some((value) => value?.normalize("NFKC").toLowerCase().includes(needle))) : visible;

  const item = visible.find(({ id }) => id === selected);
  const number = item && numbers.get(item.id);
  const address = item?.address_ja || item?.address_text;
  const directions = item ? directionsUrl(item) : null;
  const names = item ? [...new Set([item.name_ko, item.name_ja, item.name_en].filter((name) => name && name !== item.display_name))] : [];
  const linked = item ? visits.get(item.id) ?? 0 : 0;
  const scheduleHref = item && `${itineraryHref(tripId, filter === "date" ? date : itineraryDate, "add", undefined,
    !itineraryDate && filter !== "date")}&place=${item.id}`;

  function select(id?: string, nearby: MapPin[] = []) {
    setCopyMessage("");
    setSelected(id);
    setNearbyPins(nearby);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage("복사했어요.");
    } catch {
      setCopyMessage("복사할 수 없어요. 장소 정보에서 텍스트를 선택해 주세요.");
    }
  }

  return <div className="places-shell" data-view={view} data-selected={item ? "true" : undefined}>
    <div className="places-view-toggle" role="group" aria-label="장소 보기 방식">
      <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} aria-hidden />목록</button>
      <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}><MapIcon size={17} aria-hidden />지도</button>
    </div>

    <section className="places-list-panel editorial-paper" aria-labelledby="places-list">
      <div className="places-list-heading">
        <h2 id="places-list">저장된 장소</h2>
        <span className="plan-meta">{visible.length}곳</span>
      </div>
      <nav className="places-filters" aria-label="표시할 장소">
        {filters.map(([key, label]) => <Link key={key} href={mapHref(tripId, { filter: key, date })}
          aria-current={filter === key ? "page" : undefined}>{label}</Link>)}
      </nav>
      {filter === "date" && dayPicker}
      {places.length > 0 && <label className="places-find">
        <Search size={16} aria-hidden />
        <input type="search" aria-label="저장된 장소 찾기" placeholder="이름이나 주소로 찾기" value={find}
          onChange={(event) => setFind(event.target.value)} />
      </label>}
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
              <span>{place.address_ja || place.address_text || "주소 미정"}</span>
              {!pin && <span className="place-pin-status">{hasCoordinates(place) ? "지도 범위 밖" : "좌표 없음"}</span>}
            </span>
            <span className="place-card-meta">{count ? `일정 ${count}` : "일정 없음"}</span>
          </button>
        </li>;
      })}</ul> : <div className="places-empty">
        <Blossom className="places-empty-sprig" />
        <p className="plan-empty">{!places.length ? "저장된 장소가 없어요." : visible.length ? "찾는 장소가 없어요." : "이 조건에 해당하는 장소가 없어요."}</p>
        {!places.length && <Link className="quiet-link" href={mapHref(tripId, { date, mode: "add" })} scroll={false}>검색으로 첫 장소 등록</Link>}
      </div>}
    </section>

    <div className="places-stage">
      <MapCanvas pins={pins} selected={item?.id} onSelect={select} />
      {item && <article className="place-detail editorial-paper" aria-label="선택한 장소">
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
        </div>
        <div className="place-detail-actions">
          <Link className="primary-button" href={scheduleHref!}><CalendarPlus size={17} aria-hidden />일정에 추가</Link>
          {directions ? <a className="quiet-link" href={directions} target="_blank" rel="noopener noreferrer">
            <Navigation size={16} aria-hidden /><span>Google Maps 길찾기</span></a> :
            <p className="plan-meta">길찾기를 열려면 주소나 좌표를 등록해 주세요.</p>}
          <button type="button" className="quiet-link" onClick={() => copy(address || item.display_name)}>
            <Copy size={16} aria-hidden /><span>{address ? "주소 복사" : "이름 복사"}</span></button>
          {number && view === "list" && <button type="button" className="quiet-link place-detail-map" onClick={() => setView("map")}>
            <MapIcon size={16} aria-hidden /><span>지도에서 보기</span></button>}
        </div>
        {copyMessage && <p className="plan-meta" role="status">{copyMessage}</p>}
        {nearbyPins.length > 1 && <div className="place-nearby" role="group" aria-label="가까운 지도 핀">
          <p className="plan-meta">가까운 지도 핀</p>
          <div className="place-nearby-options">
            {nearbyPins.map(({ id, label, number }) => <button key={id} type="button" className="quiet-link"
              aria-pressed={id === selected} onClick={() => select(id, nearbyPins)}>
              <span>{number}</span> {label}
            </button>)}
          </div>
        </div>}
        <footer className="place-detail-manage">
          <Link className="quiet-link" href={mapHref(tripId, { date, place: item.id, mode: "edit" })} scroll={false}>장소 수정</Link>
          <Link className="quiet-link danger-link" href={mapHref(tripId, { date, place: item.id, mode: "delete" })} scroll={false}>장소 삭제</Link>
          {item.provider === "GEOAPIFY" && <p className="plan-meta">출처 <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a></p>}
        </footer>
      </article>}
    </div>
  </div>;
}
