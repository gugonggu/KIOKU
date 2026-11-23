"use client";

import type { Map as MapLibre, Marker } from "maplibre-gl";
import { LocateFixed } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type MapPin = { id: string; label: string; point: [number, number]; number: number };
type GeoPoint = [number, number];
export const mapLatitudeLimit = 85.051129;
const styleUrl = "https://tiles.openfreemap.org/styles/liberty";

export function MapCanvas({ pins, selected, onSelect, showLocation = true }: {
  pins: MapPin[]; selected?: string; onSelect: (id: string, nearby: MapPin[]) => void; showLocation?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<{ map: MapLibre; lib: typeof import("maplibre-gl") }>();
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [retry, setRetry] = useState(0);
  const [geo, setGeo] = useState<{ message: string; point?: GeoPoint }>();
  const callback = useRef(onSelect);
  const fit = useRef<() => void>(() => {});
  const alive = useRef(true);
  useEffect(() => { callback.current = onSelect; }, [onSelect]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibre | undefined;
    const timeout = setTimeout(() => { if (!cancelled) setStatus("failed"); }, 8000);
    void import("maplibre-gl").then((lib) => {
      if (cancelled || !container.current) return;
      lib.setWorkerUrl(`/map-assets/${lib.getVersion()}/maplibre-gl-worker.mjs`);
      map = new lib.Map({ container: container.current, style: styleUrl, center: [137.5, 36.2], zoom: 4.3,
        attributionControl: false, scrollZoom: false, maxZoom: 18 });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => { if (!cancelled) setStatus("failed"); });
      map.on("load", () => {
        clearTimeout(timeout);
        if (cancelled || !map) return;
        setRuntime({ map, lib });
        setStatus("ready");
      });
    }).catch(() => { clearTimeout(timeout); if (!cancelled) setStatus("failed"); });
    return () => { cancelled = true; clearTimeout(timeout); map?.remove(); };
  }, [retry]);

  useEffect(() => {
    if (!runtime) return;
    const { map, lib } = runtime;
    const markers: Marker[] = pins.map(({ id, label, point, number }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "kioku-map-pin";
      button.dataset.placeId = id;
      button.setAttribute("aria-label", `지도 핀: ${label}`);
      button.textContent = String(number);
      button.addEventListener("click", () => {
        const center = map.project(point);
        // Pin buttons are 44px wide. Offer a choice when their touch targets can overlap.
        const nearby = pins.filter((pin) => center.dist(map.project(pin.point)) < 44);
        callback.current(id, nearby);
      });
      return new lib.Marker({ element: button, anchor: "center" }).setLngLat(point).addTo(map);
    });
    fit.current = () => {
      if (pins.length === 1) map.jumpTo({ center: pins[0].point, zoom: 13 });
      if (pins.length > 1) {
        const bounds = new lib.LngLatBounds();
        for (const pin of pins) bounds.extend(pin.point);
        map.fitBounds(bounds, { padding: 44, maxZoom: 13, duration: 0 });
      }
    };
    fit.current();
    return () => markers.forEach((marker) => marker.remove());
  }, [runtime, pins]);

  const active = pins.find((pin) => pin.id === selected);
  const focus = useRef<() => void>(() => {});
  useEffect(() => {
    container.current?.querySelectorAll<HTMLButtonElement>("button.kioku-map-pin").forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.placeId === selected)));
    focus.current = () => {
      if (!runtime || !active) return;
      // Keep the selected pin clear of the place card: it covers the lower map on phones and the left edge on desktop.
      const narrow = window.matchMedia("(max-width: 839px)").matches;
      const { clientWidth, clientHeight } = runtime.map.getContainer();
      runtime.map.easeTo({ center: active.point, zoom: Math.max(13, runtime.map.getZoom()), duration: 0,
        offset: narrow ? [0, -Math.round(clientHeight * 0.22)] : [Math.min(192, Math.round(clientWidth * 0.2)), 0] });
    };
    focus.current();
  }, [runtime, active, pins, selected]);

  // The map can start hidden behind the mobile list view; re-measure and re-frame when it becomes visible.
  useEffect(() => {
    const node = container.current;
    if (!runtime || !node) return;
    let wasHidden = node.clientWidth === 0;
    const observer = new ResizeObserver(() => {
      runtime.map.resize();
      const hidden = node.clientWidth === 0;
      if (wasHidden && !hidden) {
        fit.current();
        focus.current();
      }
      wasHidden = hidden;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [runtime]);

  const point = geo?.point;
  useEffect(() => {
    if (!runtime || !point) return;
    const element = document.createElement("span");
    element.className = "kioku-map-location";
    element.setAttribute("aria-label", "내 위치");
    const marker = new runtime.lib.Marker({ element }).setLngLat(point).addTo(runtime.map);
    runtime.map.jumpTo({ center: point, zoom: 13 });
    return () => { marker.remove(); };
  }, [point, runtime]);

  function locate() {
    if (!navigator.geolocation) {
      setGeo({ message: "이 브라우저에서는 현재 위치를 사용할 수 없어요. 저장된 장소를 계속 볼 수 있어요." });
      return;
    }
    setGeo({ message: "현재 위치를 확인하는 중이에요." });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!alive.current) return;
        setGeo(Math.abs(coords.latitude) <= mapLatitudeLimit
          ? { message: "현재 위치를 지도에 표시했어요.", point: [coords.longitude, coords.latitude] }
          : { message: "현재 위치가 지도 표시 범위 밖이에요." });
      },
      ({ code }) => { if (alive.current) setGeo({ message: code === 1
        ? "위치 권한이 허용되지 않았어요. 저장된 장소는 계속 볼 수 있어요."
        : "현재 위치를 확인하지 못했어요. 저장된 장소는 계속 볼 수 있어요." }); },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 0 },
    );
  }

  return <section id="trip-place-map" className="place-map" aria-label="장소 지도">
    <div className="place-map-footer">
      <p className="plan-meta">지도 <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>
        {" · "}<a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>
        {" · "}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></p>
    </div>
    <div className="place-map-viewport" data-map-state={status}>
      <div ref={container} className="place-map-canvas" aria-label="일본 지도" />
      {showLocation && <button type="button" className="place-map-locate" disabled={status !== "ready" || geo?.message === "현재 위치를 확인하는 중이에요."}
        onClick={locate}><LocateFixed size={17} aria-hidden />내 위치</button>}
      {geo && <p className="place-map-toast" role="status">{geo.message}</p>}
      {status === "loading" && <p className="place-map-overlay notice" role="status">지도를 불러오는 중이에요.</p>}
      {status === "failed" && <div className="place-map-overlay notice notice-error" role="alert">
        <p>지도를 불러오지 못했어요. 저장된 장소 목록에서 주소와 길찾기를 사용할 수 있어요.</p>
        <button type="button" className="quiet-link" onClick={() => { setRuntime(undefined); setStatus("loading"); setRetry((value) => value + 1); }}>지도 다시 불러오기</button>
      </div>}
    </div>
  </section>;
}
