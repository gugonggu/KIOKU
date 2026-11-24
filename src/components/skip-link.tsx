"use client";

import { usePathname } from "next/navigation";

export function SkipLink() {
  const pathname = usePathname();

  if (pathname === "/s") {
    return <button type="button" className="skip-link" tabIndex={0} onClick={() => {
      const main = document.getElementById("main-content");
      main?.focus({ preventScroll: true });
      main?.scrollIntoView();
    }}>본문으로 건너뛰기</button>;
  }

  return <a className="skip-link" href="#main-content" tabIndex={0}>본문으로 건너뛰기</a>;
}
