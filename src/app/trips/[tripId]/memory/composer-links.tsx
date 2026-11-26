"use client";

import { useEffect } from "react";

type Composer = "write-memory" | "add-photo";

function openComposer(id: Composer) {
  const panel = document.getElementById(id);
  if (!(panel instanceof HTMLDetailsElement)) return;
  panel.open = true;
  const field = panel.querySelector<HTMLElement>(id === "write-memory"
    ? "input[name=title]:enabled" : "input[type=file]:enabled");
  panel.scrollIntoView({ block: "start" });
  (field ?? panel.querySelector("summary"))?.focus({ preventScroll: true });
}

export function ComposerLinks({ href, date, initial }: {
  href: string;
  date: string;
  initial?: Composer;
}) {
  useEffect(() => {
    if (!initial) return;
    const frame = requestAnimationFrame(() => openComposer(initial));
    return () => cancelAnimationFrame(frame);
  }, [initial, date]);

  return <div className="suite-row">
    {([["write-memory", "write", "일기 쓰기"], ["add-photo", "photo", "사진 추가"]] as const)
      .map(([id, param, label]) => <a key={id} className="quiet-link"
        href={`${href}?date=${date}&${param}=1#${id}`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openComposer(id);
        }}>{label}</a>)}
    <a className="quiet-link" href="#visit-log">방문 기록</a>
  </div>;
}
