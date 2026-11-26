import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SkipLink } from "@/components/skip-link";
import "./globals.css";
import "./editorial.css";
import "./travel-journal.css";

export const metadata: Metadata = {
  title: { default: "KIOKU · 記憶 — Japan Travel Journal", template: "%s | KIOKU" },
  description: "한국어로 쓰는 나만의 일본 여행 수첩.",
};

export const viewport: Viewport = { viewportFit: "cover", themeColor: "#F6F3EC" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
