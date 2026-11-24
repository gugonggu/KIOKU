"use client";

import { useEffect, useState } from "react";
import { isCalendarDate } from "@/lib/trip-details";
import type { SharedTrip } from "@/lib/trip-share-types";
import { SharedGuide } from "./shared-guide";

type State = { trip: SharedTrip; token: string; date?: string } | "loading" | "invalid";

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

      try {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
          await Promise.resolve();
          if (!signal.aborted) setState("invalid");
          return;
        }

        const response = await fetch("/api/shared", {
          method: "POST", body: token, signal, cache: "no-store", credentials: "omit",
        });
        const trip: SharedTrip | null = response.ok ? await response.json() : null;
        if (!signal.aborted) setState(trip ? { trip, token, date: day && isCalendarDate(day) ? day : undefined } : "invalid");
      } catch {
        if (!signal.aborted) setState("invalid");
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
  return <SharedGuide trip={state.trip} requested={state.date} href={(day) => "/s?date=" + day + "#" + state.token} preserveFragment />;
}
