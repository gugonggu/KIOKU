import { randomUUID } from "node:crypto";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Input } from "@/components/ui/input";
import { dateLabel, japanDate, type Trip } from "@/lib/trip-details";
import { outsideTrip, planCalendar as calendar, planDay, shiftDay } from "@/lib/trip-plan";
import { loadTripPlan, type PlanSchedule } from "@/lib/trip-plan-data";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { changePlacement, saveItinerary } from "./actions";
import { PlacementForm, ScheduleEditor } from "./forms";
import { itineraryHref } from "./links";
import { ScheduleList } from "./schedule-list";

export const metadata = { title: "여행 일정" };

function DateNavigation({ trip, date }: { trip: Trip; date: string }) {
  const previous = shiftDay(date, -1);
  const next = shiftDay(date, 1);
  const dates = [date];
  for (let offset = 0; offset < 2; offset++) {
    const left = shiftDay(dates[0], -1);
    const right = shiftDay(dates[dates.length - 1], 1);
    if (left && trip.start_date && left >= trip.start_date) dates.unshift(left);
    if (right && trip.end_date && right <= trip.end_date) dates.push(right);
  }
  while (dates.length < 5) {
    const left = shiftDay(dates[0], -1);
    const right = shiftDay(dates[dates.length - 1], 1);
    if (left && trip.start_date && left >= trip.start_date) dates.unshift(left);
    else if (right && trip.end_date && right <= trip.end_date) dates.push(right);
    else break;
  }
  return <nav className="plan-list" aria-label="일정 날짜 이동">
    <div className="itinerary-dates">
      {dates.map((day) => <Link key={day} className="quiet-link" aria-current={day === date ? "date" : undefined}
        href={itineraryHref(trip.id, day)}>{dateLabel(day)}</Link>)}
    </div>
    <div className="plan-date-nav">
      {previous && trip.start_date && previous >= trip.start_date
        ? <Link className="quiet-link plan-step" aria-label="이전 날짜" href={itineraryHref(trip.id, previous)}><ArrowLeft size={18} aria-hidden /></Link>
        : <span className="plan-step" />}
      <form method="get" action={itineraryHref(trip.id, null)} className="plan-date-picker">
        <Input key={date} aria-label="볼 날짜" name="date" {...calendar} min={trip.start_date ?? calendar.min}
          max={trip.end_date ?? calendar.max} defaultValue={date} required />
        <button className="quiet-link" type="submit">이동</button>
      </form>
      {next && trip.end_date && next <= trip.end_date
        ? <Link className="quiet-link plan-step" aria-label="다음 날짜" href={itineraryHref(trip.id, next)}><ArrowRight size={18} aria-hidden /></Link>
        : <span className="plan-step" />}
    </div>
  </nav>;
}

export default async function ItineraryPage({ params, searchParams }: PageProps<"/trips/[tripId]/itinerary">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (error || !trip) return <TripLoadError />;
  const plan = await loadTripPlan(trip.id);
  const date = planDay(trip, typeof query.date === "string" ? query.date : undefined, japanDate());
  const candidates = query.view === "candidates";
  const back = itineraryHref(trip.id, date, undefined, undefined, candidates);
  const header = <header className="plan-heading">
    <Link href={`/trips/${trip.id}`} className="quiet-link"><ArrowLeft size={17} aria-hidden />여행 수첩으로</Link>
    <p className="plan-meta">{trip.title}</p><h1>여행 일정</h1>
  </header>;
  if (!plan) return <div className="trip-plan">{header}<div className="notice notice-error" role="alert">
    <p>일정을 불러오지 못했어요.</p><form method="get" action={itineraryHref(trip.id, null)}>
      {date && <input type="hidden" name="date" value={date} />}
      {candidates && <input type="hidden" name="view" value="candidates" />}
      <button className="quiet-link">다시 불러오기</button>
    </form>
  </div></div>;

  const item = plan.schedule.find(({ id }) => id === query.id);
  const mode = query.mode;
  const editing = mode === "add" || mode === "edit";
  const placing = mode === "move" || mode === "restore" || mode === "delete";
  if ((mode === "edit" || placing) && !item) notFound();
  if (mode === "restore" && !item?.archived_date) notFound();
  if (editing || placing) {
    const entry = mode === "add" ? undefined : item;
    const title = mode === "add" ? (candidates ? "후보 추가" : "일정 추가") : mode === "edit" ? "일정 수정"
      : mode === "move" ? "일정 날짜 이동" : mode === "restore" ? "후보 복원" : "일정 삭제";
    return <div className="trip-plan">{header}<section className="plan-section" aria-labelledby="itinerary-editor">
      <h2 id="itinerary-editor">{title}</h2>
      {editing && <ScheduleEditor key={entry?.id ?? (candidates ? "new-candidate" : date ?? "new")}
        action={saveItinerary.bind(null, trip.id, entry?.id ?? randomUUID(), entry?.revision ?? null, date)}
        cancel={back} item={entry} date={candidates ? null : date} places={plan.places.map(({ id, name }) => ({ id, name }))} />}
      {placing && entry && <PlacementForm key={`${mode}-${entry.id}`} mode={mode} title={entry.title}
        date={mode === "restore" ? entry.archived_date : entry.local_date ?? date} cancel={back}
        action={changePlacement.bind(null, trip.id, { id: entry.id, revision: entry.revision,
          archivedDate: entry.archived_date, candidate: entry.local_date === null }, mode, date)} />}
    </section></div>;
  }

  const onDay = date ? plan.schedule.filter((row) => row.local_date === date) : [];
  const undated = plan.schedule.filter((row) => row.local_date === null);
  const otherDates = new Map<string, PlanSchedule[]>();
  for (const row of plan.schedule) {
    if (!row.local_date || (date && !outsideTrip(trip, row.local_date))) continue;
    const group = otherDates.get(row.local_date) ?? [];
    group.push(row);
    otherDates.set(row.local_date, group);
  }

  return <div className="trip-plan">
    {header}
    <nav className="state-actions" aria-label="일정 분류">
      <Link className="quiet-link" aria-current={!candidates ? "page" : undefined} href={itineraryHref(trip.id, date)}>날짜별 일정</Link>
      <Link className="quiet-link" aria-current={candidates ? "page" : undefined} href={itineraryHref(trip.id, date, undefined, undefined, true)}>후보함</Link>
    </nav>
    {candidates ? <section className="plan-section" aria-labelledby="candidate-title">
      <div className="plan-section-heading"><h2 id="candidate-title">후보함</h2>
        <Link className="primary-button" href={itineraryHref(trip.id, date, "add", undefined, true)}>후보 추가</Link></div>
      {undated.length ? <ScheduleList items={undated} tripId={trip.id} date={date} places={plan.places} candidate /> :
        <p className="plan-empty">날짜를 아직 정하지 않은 일정이 없어요.</p>}
    </section> : <>
      <section className="plan-section" aria-labelledby="schedule-title">
        <div className="plan-section-heading"><h2 id="schedule-title"><CalendarDays size={20} aria-hidden />날짜별 일정</h2>
          <Link className="primary-button" href={itineraryHref(trip.id, date, "add")}>일정 추가</Link></div>
        {date ? <>
          <DateNavigation trip={trip} date={date} />
          <p className="plan-meta">{dateLabel(date)} 일본 현지 시간</p>
          {onDay.length ? <ScheduleList items={onDay} tripId={trip.id} date={date} places={plan.places} /> :
            <p className="plan-empty">이 날짜에 등록된 일정이 없어요.</p>}
        </> : <p className="plan-empty">여행 기간을 정하면 날짜별로 일정을 볼 수 있어요. <Link href={`/trips/${trip.id}/edit#trip-dates`} className="quiet-link">여행 날짜 정하기</Link></p>}
      </section>
      {otherDates.size > 0 && <section className="plan-section" aria-labelledby="outside-title">
        <h2 id="outside-title">{date ? "여행 기간 밖 일정" : "날짜가 정해진 일정"}</h2>
        {[...otherDates].sort(([first], [second]) => first.localeCompare(second)).map(([day, rows]) => (
          <ScheduleList key={day} items={rows} tripId={trip.id} date={date} places={plan.places} showDates />
        ))}
      </section>}
    </>}
  </div>;
}
