"use client";

import { sharedUnavailableMessage } from "@/lib/trip-share-types";

export function SharedUnavailable() {
  return <section className="route-state safe-page">
    <h1>{sharedUnavailableMessage}</h1>
    <p>연결을 확인한 뒤 다시 시도해 주세요.</p>
    <button type="button" className="quiet-link" onClick={() => location.reload()}>다시 불러오기</button>
  </section>;
}
