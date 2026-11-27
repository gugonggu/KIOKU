import Link from "next/link";
import { OfflineControls } from "@/components/offline-controls";
import { requireUser } from "@/lib/auth";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { TripTabs } from "../editorial";

export const metadata = { title: "오프라인 수첩", robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/trips/[tripId]/offline">) {
  const { tripId } = await params;
  const [owner, { data: trip, error }] = await Promise.all([requireUser(), getTrip(tripId)]);
  if (!trip || error) return <TripLoadError />;
  const href = "/trips/" + tripId;
  return <div className="editorial-page suite-page">
    <header><Link className="quiet-link" href={href + "/more"}>더보기</Link><h1>오프라인 수첩</h1><p>{trip.title}</p></header>
    <OfflineControls owner={owner} tripId={tripId} />
    <TripTabs href={href} active="more" />
  </div>;
}
