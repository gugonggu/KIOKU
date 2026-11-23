import { ArrowLeft, Eye } from "lucide-react";
import Link from "next/link";
import "maplibre-gl/dist/maplibre-gl.css";
import { SharedGuide } from "@/app/s/shared-guide";
import { isCalendarDate } from "@/lib/trip-details";
import { loadSharePreview, loadShareSettings } from "@/lib/trip-share-data";
import { shareKey } from "@/lib/trip-share-token";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { revealShare, saveShare } from "./actions";
import { ShareForm } from "./share-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "여행 공유" };

export default async function SharePage({ params, searchParams }: PageProps<"/trips/[tripId]/share">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const home = "/trips/" + trip.id;
  const share = home + "/share";
  if (query.preview === "1") {
    const preview = await loadSharePreview(trip.id);
    const date = typeof query.date === "string" && isCalendarDate(query.date) ? query.date : undefined;
    return <>
      <div className="editorial-page share-preview-bar"><Link className="quiet-link" href={share}><ArrowLeft size={16} aria-hidden />공유 설정</Link>
        <p className="plan-meta">동행자 화면 미리보기 · 저장된 공유 범위</p></div>
      {preview ? <SharedGuide trip={preview} requested={date} href={(day) => share + "?preview=1&date=" + day + "#guide-itinerary"} /> : <TripLoadError />}
    </>;
  }
  const settings = await loadShareSettings(trip.id);
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
