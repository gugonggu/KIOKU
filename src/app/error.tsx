"use client";

import { ErrorState } from "@/components/error-state";

export default function Error({ reset }: { reset: () => void }) {
  return <ErrorState retry={reset} />;
}
