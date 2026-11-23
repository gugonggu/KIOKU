"use client";

import { BookOpen, Ellipsis, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { signOut } from "./actions";

export function TripMenu() {
  const path = usePathname();
  const [state, action, pending] = useActionState(signOut, { failed: false });
  const inPlanner = /^\/trips\/[^/]+(?:\/itinerary)?$/.test(path) && path !== "/trips/new";
  const newTrip = <Link href="/trips/new" aria-current={path === "/trips/new" ? "page" : undefined}>
    <Plus size={18} aria-hidden="true" />새 여행
  </Link>;
  const logout = <form action={action} className="signout-form">
    <button type="submit" disabled={pending}>
      <LogOut size={17} aria-hidden="true" />{pending ? "로그아웃 중…" : "로그아웃"}
    </button>
    {state.failed && <p className="notice notice-error" role="alert">다시 로그아웃을 시도해 주세요.</p>}
  </form>;

  return (
    <div className="trip-menu">
      <nav aria-label="여행 메뉴">
        <Link href="/trips" aria-current={path === "/trips" ? "page" : undefined}>
          <BookOpen size={18} aria-hidden="true" />내 여행
        </Link>
        {!inPlanner && newTrip}
      </nav>
      {inPlanner ? <details key={path} className="editorial-global-menu">
        <summary className="editorial-icon-button" aria-label="여행·계정 메뉴"><Ellipsis size={20} aria-hidden /></summary>
        <div className="editorial-menu-content">{newTrip}{logout}</div>
      </details> : logout}
    </div>
  );
}
