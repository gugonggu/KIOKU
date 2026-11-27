import { ArrowLeft, Eye } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import "maplibre-gl/dist/maplibre-gl.css";
import { SharedGuide } from "@/app/s/shared-guide";
import { isCalendarDate } from "@/lib/trip-details";
import { loadSharePreview, loadShareSettings } from "@/lib/trip-share-data";
import { shareKey } from "@/lib/trip-share-token";
import { getTrip, isTripId } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { revealShare, saveShare } from "./actions";
import { ShareForm } from "./share-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "여행 공유" };

export default async function SharePage({ params, searchParams }: PageProps<"/trips/[tripId]/share">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  if (!isTripId(tripId)) notFound();
  const previewing = query.preview === "1";
  // Ownership and data load in one round of queries. RLS limits every query to the owner; the trip check still gates rendering.
  const [{ data: trip, error }, preview, settings] = await Promise.all([
    getTrip(tripId), previewing ? loadSharePreview(tripId) : null, previewing ? null : loadShareSettings(tripId),
  ]);
  if (!trip || error) return <TripLoadError />;
  const home = "/trips/" + trip.id;
  const share = home + "/share";
  if (previewing) {
    const date = typeof query.date === "string" && isCalendarDate(query.date) ? query.date : undefined;
    return <>
      <div className="editorial-page share-preview-bar"><Link className="quiet-link" href={share}><ArrowLeft size={16} aria-hidden />공유 설정</Link>
        <p className="plan-meta">동행자 화면 미리보기 · 저장된 공유 범위</p></div>
      {preview ? <SharedGuide trip={preview} requested={date} href={(day) => share + "?preview=1&date=" + day + "#guide-itinerary"} /> : <TripLoadError />}
    </>;
  }
  return <div className="editorial-page share-settings">
    <header className="editorial-itinerary-header">
      <div><Link className="quiet-link editorial-back" href={home}><ArrowLeft size={16} aria-hidden />{trip.title}</Link><h1>여행 공유</h1></div>
      {settings && <Link className="quiet-link share-preview-link" href={share + "?preview=1"}>
        <Eye size={18} aria-hidden />동행자 화면 미리보기
      </Link>}
    </header>
    {settings ? <ShareForm settings={{ enabled: settings.enabled, expired: settings.expired, bookings: settings.bookings,
      notes: settings.notes, expiresOn: settings.expiresOn, revision: settings.revision }} configured={Boolean(shareKey())}
      save={saveShare.bind(null, trip.id, settings.revision)} reveal={revealShare.bind(null, trip.id)} /> : <TripLoadError />}
  </div>;
}
