import type { Metadata } from "next";
import type { ReactNode } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Brand } from "@/components/brand";
import { ShareRefresh } from "./share-refresh";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function SharedLayout({ children }: { children: ReactNode }) {
  return <div className="shared-shell">
    <header className="shared-brand"><Brand /></header>
    <main id="main-content" tabIndex={-1}>{children}</main>
    <ShareRefresh />
  </div>;
}
