"use client";

import { BookOpen, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { signOut } from "./actions";

export function TripMenu() {
  const path = usePathname();
  const [state, action, pending] = useActionState(signOut, { failed: false });

  return (
    <div className="trip-menu">
      <nav aria-label="여행 메뉴">
        <Link href="/trips" aria-current={path === "/trips" ? "page" : undefined}>
          <BookOpen size={18} aria-hidden="true" />내 여행
        </Link>
        <Link href="/trips/new" aria-current={path === "/trips/new" ? "page" : undefined}>
          <Plus size={18} aria-hidden="true" />새 여행
        </Link>
      </nav>
      <form action={action} className="signout-form">
        <button type="submit" disabled={pending}>
          <LogOut size={17} aria-hidden="true" />{pending ? "로그아웃 중…" : "로그아웃"}
        </button>
        {state.failed && <p className="notice notice-error" role="alert">다시 로그아웃을 시도해 주세요.</p>}
      </form>
    </div>
  );
}
