"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { TripMutationState } from "../../mutations";

export function DeleteTripForm({ action, tripHref }: {
  action: () => Promise<TripMutationState>;
  tripHref: string;
}) {
  const [state, dispatch, pending] = useActionState<TripMutationState>(action, {});

  return (
    <form action={dispatch} className="delete-trip-form">
      {state.message && <p className="notice notice-error" role="alert">{state.message}</p>}
      <div className="state-actions">
        <Link href={tripHref} className="quiet-link">{state.conflict ? "최신 여행 정보 보기" : "취소"}</Link>
        <button type="submit" className="primary-button danger-button" disabled={pending || state.conflict}>
          {pending ? "삭제 중…" : "여행 삭제"}
        </button>
      </div>
    </form>
  );
}
