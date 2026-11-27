import { randomUUID } from "node:crypto";
import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import "maplibre-gl/dist/maplibre-gl.css";
import { EditorialDialog } from "@/components/editorial-dialog";
import { isCalendarDate, japanDate } from "@/lib/trip-details";
import { planDay } from "@/lib/trip-plan";
import { loadTripPlaces } from "@/lib/trip-plan-data";
import { placesArea } from "@/lib/geoapify";
import { getTrip, isTripId } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { TripTabs } from "../editorial";
import { itineraryHref } from "../itinerary/links";
import { deletePlace, savePlace } from "./actions";
import { mapHref, type MapContext } from "./links";
import { DeletePlaceForm, PlaceEditor } from "./place-editor";
import { PlaceAddLink, PlacesTabs, PlacesView } from "./places-view";
import "./map.css";

export const metadata = { title: "장소와 지도" };

export default async function PlacesPage({ params, searchParams }: PageProps<"/trips/[tripId]/map">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  if (!isTripId(tripId)) notFound();
  // Ownership and data load in one round of queries. RLS limits every query to the owner; the trip check still gates rendering.
  const [{ data: trip, error }, data] = await Promise.all([getTrip(tripId), loadTripPlaces(tripId)]);
  if (error || !trip) return <TripLoadError />;
  const today = japanDate();
  const requested = typeof query.date === "string" && isCalendarDate(query.date) ? query.date : undefined;
  const itineraryDate = planDay(trip, requested, today);
  const date = requested ?? itineraryDate ?? today;
  const filter = query.filter === "date" || query.filter === "candidates" || query.filter === "unlocated" ? query.filter : "all";
  const current = data?.places.find(({ id }) => id === query.place);
  const area = data ? placesArea(data.places) : undefined;
  const start: [number, number] | undefined = area && [area.longitude, area.latitude];
  const view = query.view === "map" || query.view === "list" ? query.view : current ? "map" : "list";
  const context = { date, filter, view, place: current?.id,
    query: typeof query.q === "string" ? query.q.slice(0, 100) : "", route: query.route === "1" } satisfies MapContext;
  const base = mapHref(tripId, { ...context, place: undefined });
  const back = mapHref(tripId, context);
  const homeHref = `/trips/${tripId}`;
  const header = <header className="editorial-itinerary-header places-header">
    <div>
      <Link href={homeHref} className="quiet-link editorial-back"><ArrowLeft size={16} aria-hidden />{trip.title}</Link>
      <h1>장소와 지도</h1>
    </div>
    <div className="places-header-actions">
      <nav className="editorial-switch" aria-label="여행 화면">
        <Link className="quiet-link" href={itineraryHref(trip.id, itineraryDate)}>날짜별 일정</Link>
        <Link className="quiet-link" href={itineraryHref(trip.id, itineraryDate, undefined, undefined, true)}>후보함</Link>
        <Link className="quiet-link" aria-current="page" href={base}><MapPin size={14} aria-hidden />장소와 지도</Link>
      </nav>
      {data && <PlaceAddLink tripId={tripId} date={date} filter={filter} />}
    </div>
  </header>;
  const tabs = <TripTabs href={homeHref} active="map" date={itineraryDate} mapLink={back} />;
  if (!data) return <div className="editorial-page places-page">{header}<div className="notice notice-error" role="alert">
    <p>저장된 장소를 불러오지 못했어요.</p><form method="get" action={mapHref(tripId)}>
      <input type="hidden" name="date" value={date} /><input type="hidden" name="filter" value={filter} />
      <button className="quiet-link">다시 불러오기</button>
    </form>
  </div>{tabs}</div>;

  const { mode } = query;
  if ((mode === "edit" || mode === "delete") && !current) notFound();

  return <div className="editorial-page places-page">
    {header}
    <PlacesView {...data} trip={{ id: tripId, start_date: trip.start_date, end_date: trip.end_date }} date={date} filter={filter} itineraryDate={itineraryDate} />
    <PlacesTabs tripId={tripId} date={date} filter={filter} itineraryDate={itineraryDate} />
    {mode === "add" && <EditorialDialog title="장소 추가" back={back}>
      <PlaceEditor tripId={tripId} back={back} start={start} action={savePlace.bind(null, tripId, randomUUID(), null, context)} />
    </EditorialDialog>}
    {mode === "edit" && current && <EditorialDialog title="장소 수정" back={back}>
      <PlaceEditor tripId={tripId} back={back} item={current} start={start}
        action={savePlace.bind(null, tripId, current.id, current.content_version, context)} />
    </EditorialDialog>}
    {mode === "delete" && current && <EditorialDialog title="장소 삭제" back={back}>
      <DeletePlaceForm name={current.display_name} count={data.links.filter(({ place_id }) => place_id === current.id).length}
        back={back} action={deletePlace.bind(null, tripId, current.id, current.content_version, context)} />
    </EditorialDialog>}
  </div>;
}
