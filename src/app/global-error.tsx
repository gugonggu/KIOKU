"use client";

import { ErrorState } from "@/components/error-state";
import "./globals.css";

export default function GlobalError({ reset }: { reset: () => void }) {
  return <html lang="ko"><body><ErrorState retry={reset} /></body></html>;
}
