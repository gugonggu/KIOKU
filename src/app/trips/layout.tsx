import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { OfflineAccount } from "@/components/offline-controls";
import { requireUser } from "@/lib/auth";
import { TripMenu } from "./trip-menu";

export const dynamic = "force-dynamic";

export default async function TripsLayout({ children }: { children: ReactNode }) {
  const owner = await requireUser();
  return (
    <div className="safe-page trips-shell">
      <OfflineAccount owner={owner} />
      <header className="trips-header"><Brand /></header>
      <aside className="trips-sidebar"><TripMenu /></aside>
      <main id="main-content" className="trips-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
