import { randomUUID } from "node:crypto";
import { ArrowLeft, MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import "maplibre-gl/dist/maplibre-gl.css";
import { EditorialDialog } from "@/components/editorial-dialog";
import { Input } from "@/components/ui/input";
import { isCalendarDate, japanDate } from "@/lib/trip-details";
import { planDay } from "@/lib/trip-plan";
import { loadTripPlaces } from "@/lib/trip-plan-data";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { DayCards, TripTabs } from "../editorial";
import { itineraryHref } from "../itinerary/links";
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
  const filter = query.filter === "date" || query.filter === "candidates" ? query.filter : "all";
  const base = mapHref(tripId, { date, filter });
  const current = data?.places.find(({ id }) => id === query.place);
  const back = mapHref(tripId, { date, filter, place: current?.id });
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
      {data && <Link className="primary-button places-add" href={mapHref(tripId, { date, filter, mode: "add" })} scroll={false}
        data-itinerary-add><Plus size={18} aria-hidden />장소 추가</Link>}
    </div>
  </header>;
  const tabs = <TripTabs href={homeHref} active="map" date={itineraryDate} />;
  if (!data) return <div className="editorial-page places-page">{header}<div className="notice notice-error" role="alert">
    <p>저장된 장소를 불러오지 못했어요.</p><form method="get" action={mapHref(tripId)}><button className="quiet-link">다시 불러오기</button></form>
  </div>{tabs}</div>;

  const { mode } = query;
  if ((mode === "edit" || mode === "delete") && !current) notFound();
  const inTrip = trip.start_date && trip.end_date && date >= trip.start_date && date <= trip.end_date;
  const dayPicker = <div className="places-days">
    {inTrip && <DayCards trip={trip} date={date} href={(day) => mapHref(tripId, { filter: "date", date: day })} />}
    <details className="editorial-date-tools">
      <summary>날짜 직접 선택</summary>
      <form method="get" action={mapHref(tripId)} className="plan-date-picker">
        <input type="hidden" name="filter" value="date" />
        <Input aria-label="장소를 볼 날짜" name="date" type="date" min="0001-01-01" max="9999-12-31" defaultValue={date} required />
        <button type="submit" className="quiet-link">이동</button>
      </form>
    </details>
  </div>;

  return <div className="editorial-page places-page">
    {header}
    <PlacesView key={`${filter}/${date}/${current?.id ?? ""}`} {...data} tripId={tripId} date={date} filter={filter}
      initialPlace={current?.id} itineraryDate={itineraryDate} dayPicker={dayPicker} />
    {tabs}
    {mode === "add" && <EditorialDialog title="장소 추가" back={base}>
      <PlaceEditor tripId={tripId} back={base} action={savePlace.bind(null, tripId, randomUUID(), null, date)} />
    </EditorialDialog>}
    {mode === "edit" && current && <EditorialDialog title="장소 수정" back={back}>
      <PlaceEditor tripId={tripId} back={back} item={current}
        action={savePlace.bind(null, tripId, current.id, current.content_version, date)} />
    </EditorialDialog>}
    {mode === "delete" && current && <EditorialDialog title="장소 삭제" back={back}>
      <DeletePlaceForm name={current.display_name} count={data.links.filter(({ place_id }) => place_id === current.id).length}
        back={back} action={deletePlace.bind(null, tripId, current.id, current.content_version, date)} />
    </EditorialDialog>}
  </div>;
}
