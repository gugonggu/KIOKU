"use client";

import { useEffect, useState } from "react";
import { isCalendarDate } from "@/lib/trip-details";
import type { SharedTrip } from "@/lib/trip-share-types";
import { SharedGuide } from "./shared-guide";

type State = { trip: SharedTrip; token: string; date?: string } | "loading" | "invalid" | "unavailable";

export function FragmentGuide() {
  const [state, setState] = useState<State>("loading");
  useEffect(() => {
    let request: AbortController | undefined;

    async function loadGuide() {
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      const token = location.hash.slice(1);
      const day = new URLSearchParams(location.search).get("date");
      const url = location.href;
      const isCurrent = () => !signal.aborted && location.href === url;

      try {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
          await Promise.resolve();
          if (isCurrent()) setState("invalid");
          return;
        }

        const response = await fetch("/api/shared", {
          method: "POST", body: token, signal, cache: "no-store", credentials: "omit",
        });
        if (!response.ok && response.status !== 404) {
          if (isCurrent()) setState("unavailable");
          return;
        }
        const trip: SharedTrip | null = response.ok ? await response.json() : null;
        if (isCurrent()) setState(trip ? { trip, token, date: day && isCalendarDate(day) ? day : undefined } : "invalid");
      } catch {
        if (isCurrent()) setState("unavailable");
      }
    }

    function onHashChange() {
      setState("loading");
      void loadGuide();
    }

    window.addEventListener("hashchange", onHashChange);
    void loadGuide();
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      request?.abort();
    };
  }, []);

  if (state === "loading") return <p className="loading-message" role="status">여행을 불러오는 중이에요.</p>;
  if (state === "invalid") return <section className="route-state safe-page">
    <h1>공유 링크를 열 수 없어요</h1><p>여행 소유자에게 현재 공유 링크를 확인해 주세요.</p>
  </section>;
  if (state === "unavailable") return <section className="route-state safe-page">
    <h1>공유 여행을 불러오지 못했어요</h1><p>연결을 확인한 뒤 다시 시도해 주세요.</p>
    <button type="button" className="quiet-link" onClick={() => location.reload()}>다시 불러오기</button>
  </section>;
  return <SharedGuide trip={state.trip} requested={state.date} href={(day) => "/s?date=" + day + "#" + state.token} preserveFragment />;
}
