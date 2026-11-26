"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

const minuteMs = 60_000;
const localTime = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo",
});

function minuteOf(timestamp: number) {
  return Math.floor(timestamp / minuteMs) * minuteMs;
}

function subscribeToMinute(onChange: () => void) {
  let timer = 0;
  function update() {
    window.clearTimeout(timer);
    if (document.hidden) return;
    onChange();
    timer = window.setTimeout(update, minuteMs - Date.now() % minuteMs);
  }

  update();
  document.addEventListener("visibilitychange", update);
  window.addEventListener("focus", update);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("focus", update);
  };
}

export function JapanLocalTime({ initialAt }: { initialAt: number }) {
  const minute = useSyncExternalStore(subscribeToMinute, () => minuteOf(Date.now()), () => minuteOf(initialAt));
  const date = new Date(minute);
  return <time dateTime={date.toISOString()}>{localTime.format(date)}</time>;
}

export function TripClock({ refreshAt }: { refreshAt: number }) {
  const router = useRouter();
  useEffect(() => {
    let refreshed = false;
    function refreshIfDue() {
      if (refreshed || document.hidden || Date.now() < refreshAt) return;
      refreshed = true;
      router.refresh();
    }
    const timer = window.setTimeout(refreshIfDue, Math.max(0, refreshAt - Date.now()));
    document.addEventListener("visibilitychange", refreshIfDue);
    window.addEventListener("focus", refreshIfDue);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshIfDue);
      window.removeEventListener("focus", refreshIfDue);
    };
  }, [refreshAt, router]);
  return null;
}
