"use client";

import { useEffect } from "react";

export function ShareRefresh() {
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  return null;
}
