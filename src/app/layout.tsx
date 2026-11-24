import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./editorial.css";

export const metadata: Metadata = {
  title: { default: "KIOKU — Japan Travel Planner", template: "%s | KIOKU" },
  description: "한국어로 쓰는 나만의 일본 여행 수첩.",
};

export const viewport: Viewport = { viewportFit: "cover", themeColor: "#F6F3EC" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content" tabIndex={0}>본문으로 건너뛰기</a>
        {children}
      </body>
    </html>
  );
}
