"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export function EditorialDialog({ title, back, children }: { title: string; back: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const viewport = window.visualViewport;
    const fitViewport = () => {
      if (!viewport) return;
      node.style.setProperty("--editorial-visible-height", `${viewport.height}px`);
      node.style.setProperty("--editorial-keyboard-inset", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    };
    fitViewport();
    viewport?.addEventListener("resize", fitViewport);
    viewport?.addEventListener("scroll", fitViewport);
    node.showModal();
    return () => {
      viewport?.removeEventListener("resize", fitViewport);
      viewport?.removeEventListener("scroll", fitViewport);
      node.close();
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("[data-itinerary-add]")?.focus({ preventScroll: true });
    };
  }, []);

  const dismiss = () => router.replace(back, { scroll: false });

  return <dialog ref={dialog} className="editorial-dialog" aria-labelledby="editorial-dialog-title"
    onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <div className="editorial-dialog-inner">
      <header><h2 id="editorial-dialog-title">{title}</h2>
        <button type="button" className="editorial-icon-button" aria-label="닫기" onClick={dismiss}><X size={21} aria-hidden /></button>
      </header>
      {children}
    </div>
  </dialog>;
}
