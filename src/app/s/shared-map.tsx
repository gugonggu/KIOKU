"use client";

import { useMemo, useState } from "react";
import type { SharedPlace } from "@/lib/trip-share-types";
import { MapCanvas, mapLatitudeLimit, type MapPin } from "../trips/[tripId]/map/map-canvas";

export function SharedMap({ places }: { places: SharedPlace[] }) {
  const [id, select] = useState<string>();
  const pins = useMemo(() => places.flatMap(({ name, latitude, longitude }, index): MapPin[] =>
    latitude !== null && longitude !== null && Math.abs(latitude) <= mapLatitudeLimit ?
      [{ id: String(index), label: name, point: [longitude, latitude], number: index + 1 }] : []), [places]);
  return pins.length > 0 ? <div className="shared-map">
    <MapCanvas pins={pins} selected={id} onSelect={select} showLocation={false} />
    {id !== undefined && <p className="plan-meta" role="status">선택한 장소 · {places[Number(id)]?.name}</p>}
  </div> : <p className="plan-meta">지도에 표시할 좌표가 없어요. 목록에서 장소와 주소를 확인할 수 있어요.</p>;
}
