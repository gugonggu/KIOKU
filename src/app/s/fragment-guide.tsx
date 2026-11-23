"use client";

import { useEffect, useState } from "react";
import { isCalendarDate } from "@/lib/trip-details";
import type { SharedTrip } from "@/lib/trip-share-types";
import { SharedGuide } from "./shared-guide";

type State = { trip: SharedTrip; token: string; date?: string } | "loading" | "invalid";

export function FragmentGuide() {
  const [state, setState] = useState<State>("loading");
  useEffect(() => {
    const controller = new AbortController();
    const token = location.hash.slice(1);
    const day = new URLSearchParams(location.search).get("date");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      void Promise.resolve().then(() => setState("invalid"));
      return;
    }
    void fetch("/api/shared", { method: "POST", body: token, signal: controller.signal, cache: "no-store", credentials: "omit" })
      .then(async (response) => response.ok ? setState({ trip: await response.json(), token,
        date: day && isCalendarDate(day) ? day : undefined }) : setState("invalid"))
      .catch(() => { if (!controller.signal.aborted) setState("invalid"); });
    return () => controller.abort();
  }, []);

  if (state === "loading") return <p className="loading-message" role="status">여행을 불러오는 중이에요.</p>;
  if (state === "invalid") return <section className="route-state safe-page">
    <h1>공유 링크를 열 수 없어요</h1><p>여행 소유자에게 현재 공유 링크를 확인해 주세요.</p>
  </section>;
  return <SharedGuide trip={state.trip} requested={state.date} href={(day) => "/s?date=" + day + "#" + state.token} preserveFragment />;
}
