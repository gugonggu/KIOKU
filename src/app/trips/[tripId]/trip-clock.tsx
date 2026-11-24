"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
