import { ArrowLeft, ArrowRight, ChevronRight, MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { Blossom } from "@/components/brand";
import { EditorialDialog } from "@/components/editorial-dialog";
import { loadBookingSummaries } from "@/lib/trip-booking-data";
import { Input } from "@/components/ui/input";
import { dateLabel, isCalendarDate, japanDate, type Trip } from "@/lib/trip-details";
import { outsideTrip, planCalendar as calendar, planDay, shiftDay, sortSchedule } from "@/lib/trip-plan";
import { loadTripPlan, type PlanSchedule } from "@/lib/trip-plan-data";
import { loadTripVisits } from "@/lib/trip-memory-data";
import { getTrip } from "@/lib/trips";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { TripLoadError } from "../../trip-load-error";
import { DayCards, dayNumber, timeLabel, TripTabs } from "../editorial";
import { mapHref } from "../map/links";
import { changePlacement, saveItinerary } from "./actions";
import { PlacementForm, ScheduleEditor } from "./forms";
import { itineraryHref } from "./links";
import { ScheduleList } from "./schedule-list";

export const metadata = { title: "여행 일정" };

function DateNavigation({ trip, date, today, counts }: {
  trip: Trip; date: string; today: string; counts: ReadonlyMap<string, number>;
}) {
  const previous = shiftDay(date, -1);
  const next = shiftDay(date, 1);
  return <nav className="editorial-date-nav" aria-label="일정 날짜 이동">
    <h2>여행 날짜</h2>
    <DayCards trip={trip} date={date} counts={counts} />
    {date !== today && !outsideTrip(trip, today) &&
      <Link className="quiet-link itinerary-today" href={itineraryHref(trip.id, today)}>오늘로 이동</Link>}
    <details className="editorial-date-tools" key={date}>
      <summary className="quiet-link">날짜 직접 이동</summary>
      <div className="editorial-date-options">
      <div className="editorial-date-arrows">
      {previous && trip.start_date && previous >= trip.start_date &&
        <Link className="quiet-link plan-step" aria-label="이전 날짜" href={itineraryHref(trip.id, previous)}><ArrowLeft size={18} aria-hidden /></Link>}
      {next && trip.end_date && next <= trip.end_date &&
        <Link className="quiet-link plan-step" aria-label="다음 날짜" href={itineraryHref(trip.id, next)}><ArrowRight size={18} aria-hidden /></Link>}
      </div>
      <form method="get" action={itineraryHref(trip.id, null)} className="plan-date-picker">
      <Input key={date} aria-label="볼 날짜" name="date" {...calendar} min={trip.start_date ?? calendar.min}
        max={trip.end_date ?? calendar.max} defaultValue={date} required />
      <button className="quiet-link" type="submit">이동</button>
      </form>
      </div>
    </details>
  </nav>;
}

export default async function ItineraryPage({ params, searchParams }: PageProps<"/trips/[tripId]/itinerary">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const [plan, bookingRows, visitRows] = await Promise.all([
    loadTripPlan(trip.id), loadBookingSummaries(trip.id), query.view === "candidates" ? null : loadTripVisits(trip.id),
  ]);
  const visitStatusesById = visitRows && Object.fromEntries(visitRows.map(({ schedule_id, status }) => [schedule_id, status]));
  const bookings = bookingRows ?? [];
  const today = japanDate();
  const date = planDay(trip, typeof query.date === "string" ? query.date : undefined, today);
  const candidates = query.view === "candidates";
  const overview = query.view === "all";
  const back = itineraryHref(trip.id, date, undefined, undefined, candidates);
  const datedHref = itineraryHref(trip.id, date);
  const overviewHref = datedHref + (date ? "&" : "?") + "view=all";
  const homeHref = `/trips/${trip.id}`;
  const map = mapHref(trip.id, { date, filter: candidates ? "candidates" : date ? "date" : "all" });
  const header = <header className="editorial-itinerary-header">
    <div>
      <Link href={homeHref} className="quiet-link editorial-back"><ArrowLeft size={16} aria-hidden />{trip.title}</Link>
      <h1>여행 일정</h1>
    </div>
    <nav className="editorial-switch" aria-label="일정 분류">
      <Link className="quiet-link" aria-current={!overview && !candidates ? "page" : undefined} href={itineraryHref(trip.id, date)}>날짜별 일정</Link>
      <Link className="quiet-link" aria-current={overview ? "page" : undefined} href={overviewHref}>전체 일정</Link>
      <Link className="quiet-link" aria-current={candidates ? "page" : undefined} href={itineraryHref(trip.id, date, undefined, undefined, true)}>후보함</Link>
      <Link className="quiet-link" href={map}><MapPin size={14} aria-hidden />장소와 지도</Link>
    </nav>
  </header>;
  if (!plan) return <div className="editorial-page editorial-itinerary">{header}<div className="notice notice-error" role="alert">
    <p>일정을 불러오지 못했어요.</p><form method="get" action={itineraryHref(trip.id, null)}>
      {date && <input type="hidden" name="date" value={date} />}
      {(candidates || overview) && <input type="hidden" name="view" value={candidates ? "candidates" : "all"} />}
      <button className="quiet-link">다시 불러오기</button>
    </form>
  </div><TripTabs href={homeHref} active="itinerary" date={date} mapLink={map} /></div>;

  const item = plan.schedule.find(({ id }) => id === query.id);
  const mode = query.mode;
  const copy = mode === "copy";
  const quick = mode === "add" || copy;
  const placing = mode === "move" || mode === "restore" || mode === "delete";
  if ((mode === "edit" || copy || placing) && !item) notFound();
  if (mode === "restore" && !item?.archived_date) notFound();

  const editor = (entry?: PlanSchedule, initialPlace?: (typeof plan.places)[number]) => {
    const initialDate = initialPlace && typeof query.date === "string" && isCalendarDate(query.date) ? query.date : date;
    const target = candidates ? null : initialDate;
    const draft = copy && item ? { ...item, local_date: target, private_note: null, shared_note: null,
      ...(target === null && { time_mode: "UNSCHEDULED" as const, fixed_local_time: null, period: null }) } : undefined;
    const editorKey = entry?.id ?? draft?.id ?? (typeof query.next === "string" ? query.next : back);
    return <ScheduleEditor key={editorKey} action={saveItinerary.bind(null, trip.id, entry?.id ?? randomUUID(), entry?.revision ?? null, date)}
      cancel={back} item={entry ?? draft} date={target} initialPlace={initialPlace} places={plan.places}
      bookings={bookings} initialBooking={quick ? bookings.find(({ id }) => id === query.booking) : undefined}
      quickTripId={quick ? trip.id : undefined} />;
  };
  if (mode === "edit" || placing) {
    const title = mode === "edit" ? "일정 수정" : mode === "move" ? "일정 날짜 이동" : mode === "restore" ? "후보 복원" : "일정 삭제";
    return <div className="editorial-page editorial-itinerary">{header}
      <section className="plan-section editorial-edit" aria-labelledby="itinerary-editor">
        <h2 id="itinerary-editor">{title}</h2>
        {mode === "edit" && editor(item)}
        {placing && item && <PlacementForm key={`${mode}-${item.id}`} mode={mode} title={item.title}
          date={mode === "restore" ? item.archived_date : item.local_date ?? date} cancel={back}
          action={changePlacement.bind(null, trip.id, { id: item.id, revision: item.revision,
            archivedDate: item.archived_date, candidate: item.local_date === null }, mode, date)} />}
      </section>
      <TripTabs href={homeHref} active="itinerary" date={date} mapLink={map} />
    </div>;
  }

  const onDay = date ? plan.schedule.filter((row) => row.local_date === date) : [];
  const undated = plan.schedule.filter((row) => row.local_date === null);
  const dated = Map.groupBy(plan.schedule.filter((row) => row.local_date !== null), (row) => row.local_date!);
  const counts = new Map([...dated].map(([day, rows]) => [day, rows.length]));

  if (overview && !mode) return <div className="editorial-page editorial-itinerary">
    {header}
    <section className="itinerary-contents" aria-labelledby="itinerary-contents-heading">
      <h2 id="itinerary-contents-heading">전체 일정</h2>
      {[...dated].sort(([first], [second]) => first.localeCompare(second)).map(([day, rows]) => {
        const inTrip = !!trip.start_date && !outsideTrip(trip, day);
        return <section className="itinerary-contents-day" key={day} aria-labelledby={`contents-${day}`}>
          <h3 id={`contents-${day}`}>
            {inTrip ? <Link className="quiet-link" href={itineraryHref(trip.id, day)}>
              Day {dayNumber(trip.start_date!, day)} · {dateLabel(day)} · 일정 {rows.length}개
              <ChevronRight size={16} aria-hidden />
            </Link> : <span>{dateLabel(day)} · {date ? "여행 기간 밖" : "날짜 지정"}</span>}
          </h3>
          <ul>{sortSchedule(rows).map((row) => <li key={row.id}>
            <span>{timeLabel(row)}</span><strong>{row.title}</strong>
          </li>)}</ul>
        </section>;
      })}
      {dated.size === 0 && <p className="plan-empty">날짜가 정해진 일정이 없어요.</p>}
      <Link className="quiet-link" href={itineraryHref(trip.id, date, undefined, undefined, true)}>후보함 {undated.length}개<ChevronRight size={16} aria-hidden /></Link>
    </section>
    <TripTabs href={homeHref} active="itinerary" date={date} mapLink={map} />
  </div>;

  const otherDates = new Map<string, PlanSchedule[]>();
  for (const row of plan.schedule) {
    if (!row.local_date || (date && !outsideTrip(trip, row.local_date))) continue;
    const group = otherDates.get(row.local_date) ?? [];
    group.push(row);
    otherDates.set(row.local_date, group);
  }
  const visibleItems = sortSchedule(candidates ? undated : onDay);
  const placesById = new Map(plan.places.map((place) => [place.id, place]));
  const visits = Map.groupBy(visibleItems, (entry) => entry.place_id);
  const currentPlaces = Array.from(visits.keys()).flatMap((id) => {
    const place = id && placesById.get(id);
    return place ? [place] : [];
  });
  const addLabel = candidates ? "후보 추가" : "일정 추가";
  const add = itineraryHref(trip.id, date, "add", undefined, candidates);

  return <div className="editorial-page editorial-itinerary">
    {header}
    <div className="editorial-itinerary-grid">
      {date && <DateNavigation trip={trip} date={date} today={today} counts={counts} />}
      <div className="editorial-timeline-column">
        <section className="plan-section editorial-timeline-section" aria-labelledby="schedule-title">
          <div className="editorial-timeline-heading">
            <div>
              <h2 id="schedule-title" aria-label={candidates ? undefined : "날짜별 일정"}>
                {candidates ? "후보함" : date && trip.start_date ? `Day ${dayNumber(trip.start_date, date)} · ${dateLabel(date)}` : "날짜별 일정"}
              </h2>
              {date && !candidates && <p className="plan-meta">일정 {onDay.length}개 · 일본 현지 시간</p>}
            </div>
            <Blossom className="editorial-timeline-sprig" />
          </div>
          {candidates ? undated.length ? <ScheduleList key={back} items={undated} tripId={trip.id} date={date} places={plan.places} bookings={bookings} candidate /> :
            <p className="plan-empty">날짜를 아직 정하지 않은 일정이 없어요.</p>
            : date ? onDay.length ? <ScheduleList key={back} items={onDay} tripId={trip.id} date={date} places={plan.places} bookings={bookings} visits={visitStatusesById} /> :
              <p className="plan-empty">이 날짜에 등록된 일정이 없어요.</p>
              : <p className="plan-empty">여행 기간을 정하면 날짜별로 일정을 볼 수 있어요. <Link href={`${homeHref}/edit#trip-dates`} className="quiet-link">여행 날짜 정하기</Link></p>}
          <Link href={add} scroll={false} className="editorial-add" data-itinerary-add>
            <Plus size={21} aria-hidden /><span>{addLabel}</span>
          </Link>
          {!candidates && <Link className="quiet-link itinerary-import-link" href={homeHref + "/itinerary/import"}>JSON 일정 가져오기</Link>}
        </section>
        {!candidates && otherDates.size > 0 && <section className="plan-section" aria-labelledby="outside-title">
          <h2 id="outside-title">{date ? "여행 기간 밖 일정" : "날짜가 정해진 일정"}</h2>
          {[...otherDates].sort(([first], [second]) => first.localeCompare(second)).map(([day, rows]) => (
            <ScheduleList key={day} items={rows} tripId={trip.id} date={date} places={plan.places} bookings={bookings} visits={visitStatusesById} showDates />
          ))}
        </section>}
      </div>
      <aside className="editorial-side-panel editorial-paper" aria-label="일정 장소 요약">
        <div className="editorial-side-heading"><div className="editorial-icon"><MapPin size={19} aria-hidden /></div>
          <h2>{candidates ? "후보의 장소" : "이날의 장소"}</h2></div>
        {currentPlaces.length ? <ul>{currentPlaces.map((place) => <li key={place.id} className="editorial-side-place">
          <Link href={mapHref(trip.id, { date, place: place.id, filter: candidates ? "candidates" : "date" })}>
            <div><strong>{place.name}</strong>{place.address && <p className="plan-meta" title={place.address}>{place.address}</p>}</div>
            <ChevronRight size={17} aria-hidden />
          </Link>
          <ul aria-label={`${place.name}에 연결된 일정`}>{visits.get(place.id)?.map((entry) => <li key={entry.id}>
            <a className="editorial-side-visit" href={`#schedule-${entry.id}`}>
              <span>{timeLabel(entry)}</span><span>{entry.title}</span>
            </a>
          </li>)}</ul>
        </li>)}</ul> : <p className="plan-meta">연결된 장소가 없어요.</p>}
        <Link href={map} className="quiet-link">지도 열기<ChevronRight size={15} aria-hidden /></Link>
      </aside>
    </div>
    <TripTabs href={homeHref} active="itinerary" date={date} mapLink={map} />
    {quick && <EditorialDialog title={copy ? "일정 복사" : addLabel} back={back}>
      {editor(undefined, plan.places.find(({ id }) => id === query.place))}
    </EditorialDialog>}
  </div>;
}
