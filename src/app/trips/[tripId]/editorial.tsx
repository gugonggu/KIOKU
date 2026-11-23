import { CalendarDays, Ellipsis, House, MapPinned, Ticket } from "lucide-react";
import Link from "next/link";
import { dateLabel, type Trip } from "@/lib/trip-details";
import { periods, shiftDay } from "@/lib/trip-plan";
import type { PlanSchedule } from "@/lib/trip-plan-data";
import { itineraryHref } from "./itinerary/links";

export function tripDays(trip: Pick<Trip, "start_date" | "end_date">, selected: string) {
  if (!trip.start_date || !trip.end_date) return [];
  let first = selected;
  for (let index = 0; index < 2 && first > trip.start_date; index++) first = shiftDay(first, -1) ?? first;
  let last = first;
  for (let index = 0; index < 4 && last < trip.end_date; index++) last = shiftDay(last, 1) ?? last;
  while (dayNumber(first, last) < 5 && first > trip.start_date) first = shiftDay(first, -1) ?? first;
  const days = [first];
  while (days.at(-1)! < last) days.push(shiftDay(days.at(-1)!, 1)!);
  return days;
}

export function dayNumber(start: string, date: string) {
  return Math.round((Date.parse(date) - Date.parse(start)) / 86_400_000) + 1;
}

export function timeLabel(item: Pick<PlanSchedule, "fixed_local_time" | "period">) {
  return item.fixed_local_time?.slice(0, 5) ?? (item.period ? periods[item.period] : "시간 미정");
}

const shortDay = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });

export function DayCards({ trip, date, summaries, href = (day) => itineraryHref(trip.id, day) }: {
  trip: Trip; date: string; summaries?: Map<string, string>; href?: (day: string) => string;
}) {
  const start = trip.start_date;
  if (!start) return null;
  return <div className="editorial-days">
    {tripDays(trip, date).map((day) => <Link key={day} className="editorial-day" href={href(day)}
      aria-current={day === date ? "date" : undefined} aria-label={dateLabel(day)}>
      <strong>Day {dayNumber(start, day)}</strong>
      <time dateTime={day}>{shortDay.format(new Date(day))}</time>
      {summaries && <span className="day-summary">{summaries.get(day) ?? "일정 없음"}</span>}
    </Link>)}
  </div>;
}

export function TripTabs({ href, active, date }: { href: string; active: "home" | "itinerary" | "map" | "bookings"; date?: string | null }) {
  const day = date ? `?date=${date}` : "";
  return <nav className="editorial-tabs" aria-label="여행 바로가기">
    <Link href={href} aria-current={active === "home" ? "page" : undefined}><House size={18} aria-hidden />홈</Link>
    <Link href={`${href}/itinerary${day}`} aria-current={active === "itinerary" ? "page" : undefined}><CalendarDays size={18} aria-hidden />일정</Link>
    <Link href={`${href}/map${day}`} aria-current={active === "map" ? "page" : undefined}><MapPinned size={18} aria-hidden />장소</Link>
    <Link href={`${href}/bookings${day}`} aria-current={active === "bookings" ? "page" : undefined}><Ticket size={18} aria-hidden />예약</Link>
    <Link href={`${href}/edit`} aria-label="더보기 · 여행 정보"><Ellipsis size={18} aria-hidden />더보기</Link>
  </nav>;
}
