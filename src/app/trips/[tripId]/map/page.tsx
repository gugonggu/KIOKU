import { randomUUID } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import "maplibre-gl/dist/maplibre-gl.css";
import { isCalendarDate, japanDate } from "@/lib/trip-details";
import { planDay } from "@/lib/trip-plan";
import { loadTripPlaces } from "@/lib/trip-plan-data";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { deletePlace, savePlace } from "./actions";
import { mapHref } from "./links";
import { DeletePlaceForm, PlaceEditor } from "./place-editor";
import { PlacesView } from "./places-view";

export const metadata = { title: "장소와 지도" };

export default async function PlacesPage({ params, searchParams }: PageProps<"/trips/[tripId]/map">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const data = await loadTripPlaces(trip.id);
  const today = japanDate();
  const requested = typeof query.date === "string" && isCalendarDate(query.date) ? query.date : undefined;
  const itineraryDate = planDay(trip, requested, today);
  const date = requested ?? itineraryDate ?? today;
  const base = mapHref(tripId, { date });
  const filter = query.filter === "date" || query.filter === "candidates" ? query.filter : "all";
  const current = data?.places.find(({ id }) => id === query.place);
  const back = mapHref(tripId, { date, place: current?.id });
  const header = <header className="plan-heading">
    <Link href={`/trips/${tripId}`} className="quiet-link"><ArrowLeft size={17} aria-hidden />여행 수첩으로</Link>
    <p className="plan-meta">{trip.title}</p><h1>장소와 지도</h1>
  </header>;
  if (!data) return <div className="trip-plan">{header}<div className="notice notice-error" role="alert">
    <p>저장된 장소를 불러오지 못했어요.</p><form method="get" action={mapHref(tripId)}><button className="quiet-link">다시 불러오기</button></form>
  </div></div>;

  const { mode } = query;
  if ((mode === "edit" || mode === "delete") && !current) notFound();
  if (mode === "add" || mode === "edit") return <div className="trip-plan">{header}<h2>{mode === "add" ? "장소 추가" : "장소 수정"}</h2>
    <PlaceEditor tripId={tripId} back={base} item={mode === "edit" ? current : undefined} action={savePlace.bind(null, tripId,
      mode === "edit" && current ? current.id : randomUUID(), mode === "edit" && current ? current.content_version : null, date)} />
  </div>;
  if (mode === "delete" && current) return <div className="trip-plan">{header}<h2>장소 삭제</h2>
    <DeletePlaceForm name={current.display_name} count={data.links.filter(({ place_id }) => place_id === current.id).length}
      back={back} action={deletePlace.bind(null, tripId, current.id, current.content_version, date)} />
  </div>;
  return <div className="trip-plan places-page">{header}
    <div className="state-actions"><Link className="primary-button" href={mapHref(tripId, { date, mode: "add" })}>장소 추가</Link></div>
    <PlacesView key={`${filter}/${date}/${current?.id ?? ""}`} {...data} tripId={tripId} date={date} filter={filter}
      initialPlace={current?.id} itineraryDate={itineraryDate} />
  </div>;
}
