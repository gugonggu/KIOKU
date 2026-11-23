"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { directionsUrl, filterPlaces, type PlaceFilter, type PlaceLink } from "@/lib/trip-places";
import type { PlanPlace } from "@/lib/trip-plan-data";
import { itineraryHref } from "../itinerary/links";
import { mapHref } from "./links";
import { MapCanvas, mapLatitudeLimit, type MapPin } from "./map-canvas";

export function PlacesView({ places, links, tripId, date, filter, initialPlace, itineraryDate }: {
  places: PlanPlace[]; links: PlaceLink[]; tripId: string; date: string; filter: PlaceFilter; initialPlace?: string; itineraryDate: string | null;
}) {
  const [selected, setSelected] = useState(initialPlace);
  const [copyMessage, setCopyMessage] = useState("");
  const visible = useMemo(() => filterPlaces(places, links, filter, date), [places, links, filter, date]);
  const pins = useMemo(() => visible.flatMap(({ id, display_name, latitude, longitude }): MapPin[] =>
    latitude !== null && longitude !== null && Math.abs(latitude) <= mapLatitudeLimit
      ? [{ id, label: display_name, point: [longitude, latitude] }] : []), [visible]);
  const item = visible.find(({ id }) => id === selected);
  const hasPin = pins.some(({ id }) => id === item?.id);
  const address = item?.address_ja || item?.address_text;
  const directions = item ? directionsUrl(item) : null;
  const names = item ? [...new Set([item.name_ko, item.name_ja, item.name_en].filter((name) => name && name !== item.display_name))] : [];
  const placesHref = (next: PlaceFilter) => mapHref(tripId, { filter: next, date });
  function select(id: string) {
    setCopyMessage("");
    setSelected(id);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage("복사했어요.");
    } catch {
      setCopyMessage("복사할 수 없어요. 장소 정보에서 텍스트를 선택해 주세요.");
    }
  }

  return <>
    <nav className="state-actions place-filters" aria-label="표시할 장소">
      {[["all","전체"],["date","날짜별"],["candidates","후보 장소"]].map(([key,label]) => (
        <Link key={key} className="quiet-link" href={placesHref(key as PlaceFilter)} aria-current={filter === key ? "page" : undefined}>{label}</Link>
      ))}
      {filter === "date" && <form method="get" action={mapHref(tripId)} className="plan-date-picker">
        <input type="hidden" name="filter" value="date" />
        <Input aria-label="장소를 볼 날짜" name="date" type="date" min="0001-01-01" max="9999-12-31" defaultValue={date} required />
        <button type="submit" className="quiet-link">이동</button>
      </form>}
    </nav>
    <div className="places-workspace">
      <MapCanvas pins={pins} selected={item?.id} onSelect={select} />
      <div className="plan-list">
        {item && <article className="plan-card" aria-label="선택한 장소">
          <h2>{item.display_name}</h2>
          {names.length > 0 && <p className="plan-meta">{names.join(" · ")}</p>}
          {item.address_text && <p>{item.address_text}</p>}
          {item.address_ja && item.address_ja !== item.address_text && <p lang="ja">{item.address_ja}</p>}
          {!address && <p className="plan-meta">주소 미정</p>}
          {item.latitude === null && <p className="plan-meta">좌표가 없어 지도에 핀이 표시되지 않아요.</p>}
          {item.latitude !== null && !hasPin && <p className="plan-meta">이 좌표는 지도 표시 범위 밖이에요.</p>}
          {item.notes && <p className="plan-notes">{item.notes}</p>}
          {item.provider === "GEOAPIFY" && <p className="plan-meta">장소 검색 출처 <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a></p>}
          <div className="plan-entry-actions">
            {hasPin && <a href="#trip-place-map" className="quiet-link">지도 핀 보기</a>}
            <button type="button" className="quiet-link" onClick={() => copy(address || item.display_name)}>{address ? "주소 복사" : "이름 복사"}</button>
            {directions ? <a className="quiet-link" href={directions} target="_blank" rel="noopener noreferrer">Google Maps 길찾기</a> :
              <p className="plan-meta">길찾기를 열려면 주소나 좌표를 등록해 주세요.</p>}
          </div>
          <div className="plan-entry-actions">
            <Link className="primary-button" href={`${itineraryHref(tripId, filter === "date" ? date : itineraryDate, "add", undefined, !itineraryDate && filter !== "date")}&place=${item.id}`}>일정에 추가</Link>
            <Link className="quiet-link" href={mapHref(tripId, { date, place: item.id, mode: "edit" })}>장소 수정</Link>
            <Link className="quiet-link danger-link" href={mapHref(tripId, { date, place: item.id, mode: "delete" })}>장소 삭제</Link>
          </div>
          {copyMessage && <p className="plan-meta" role="status">{copyMessage}</p>}
        </article>}
        <section className="plan-section" aria-labelledby="places-list">
          <h2 id="places-list">저장된 장소</h2>
          {visible.length ? <ul className="plan-list">{visible.map((place) => <li key={place.id}>
            <button type="button" aria-pressed={place.id === item?.id} className="place-row plan-card" onClick={() => select(place.id)}>
              <strong>{place.display_name}</strong>
              <span>{place.address_ja || place.address_text || "주소 미정"}</span>
            </button>
          </li>)}</ul> : <p className="plan-empty">{places.length ? "이 조건에 해당하는 장소가 없어요." : "저장된 장소가 없어요."}</p>}
        </section>
      </div>
    </div>
  </>;
}
