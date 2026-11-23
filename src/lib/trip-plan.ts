import type { ScheduleFields, SchedulePeriod, ScheduleRow } from "./database.types";
import { isCalendarDate, type Trip } from "./trip-details.ts";

export const planLimits = { title: 100, notes: 1500 } as const;
export const planCalendar = { type: "date", min: "0001-01-01", max: "9999-12-31" };

function read(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function parseSchedule(data: FormData): ScheduleFields | string {
  const title = read(data, "title");
  const privateNote = read(data, "private_note");
  const sharedNote = read(data, "shared_note");
  const kind = read(data, "kind") || "NOTE";
  const mode = read(data, "time_mode") || "UNSCHEDULED";
  const place = read(data, "place_id");
  const booking = read(data, "booking_id");
  if (!title || title.length > planLimits.title) return "일정 이름을 1~100자로 입력해 주세요.";
  if (privateNote.length > planLimits.notes || sharedNote.length > planLimits.notes) return "메모는 각각 1,500자까지 입력할 수 있어요.";
  if (kind !== "NOTE" && kind !== "MOVE" && kind !== "PLACE" && kind !== "BOOKING_REF") return "일정 유형을 다시 선택해 주세요.";
  if (mode !== "FIXED" && mode !== "PERIOD" && mode !== "UNSCHEDULED") return "시간 방식을 선택해 주세요.";
  if (place && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(place)) return "연결할 장소를 다시 선택해 주세요.";
  if (booking && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(booking)) return "연결할 예약을 다시 선택해 주세요.";
  const date = read(data, "local_date");
  if ((date || mode !== "UNSCHEDULED") && !isCalendarDate(date)) return "일정 날짜를 입력해 주세요.";
  const fixed = mode === "FIXED" ? read(data, "fixed_local_time") : "";
  const period = mode === "PERIOD" ? read(data, "period") : "";
  if (mode === "FIXED" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fixed)) return "일본 현지 시각을 입력해 주세요.";
  if (mode === "PERIOD" && period !== "MORNING" && period !== "AFTERNOON" && period !== "EVENING") return "오전, 오후 또는 저녁을 선택해 주세요.";
  return {
    title, kind: kind === "BOOKING_REF" && data.has("booking_id") && !booking ? "NOTE" : kind,
    time_mode: mode, place_id: place || null, local_date: date || null,
    ...(data.has("booking_id") && { booking_id: booking || null }),
    fixed_local_time: fixed || null, period: (period || null) as SchedulePeriod | null,
    private_note: privateNote || null, shared_note: sharedNote || null,
  };
}

type DateRange = Pick<Trip, "start_date" | "end_date">;

export function planDay(trip: DateRange, requested: string | undefined, today: string) {
  const { start_date: start, end_date: end } = trip;
  if (!start || !end) return null;
  if (requested && isCalendarDate(requested) && requested >= start && requested <= end) return requested;
  return today >= start && today <= end ? today : start;
}

export function shiftDay(day: string, amount: -1 | 1) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  const next = date.toISOString().split("T")[0];
  return isCalendarDate(next) ? next : null;
}

export function outsideTrip(trip: DateRange, date: string | null) {
  return Boolean(date && trip.start_date && trip.end_date && (date < trip.start_date || date > trip.end_date));
}

export const periods = { MORNING: "오전", AFTERNOON: "오후", EVENING: "저녁" } as const;

type GroupFields = Pick<ScheduleFields, "time_mode" | "fixed_local_time" | "period">;

export function scheduleGroup(item: GroupFields) {
  if (item.time_mode === "FIXED") return `0:${item.fixed_local_time?.slice(0, 5)}`;
  if (item.time_mode === "PERIOD") return `1:${Object.keys(periods).indexOf(item.period ?? "")}`;
  return "2";
}

export function sortSchedule<Item extends GroupFields & Pick<ScheduleRow, "id" | "sort_order">>(items: Item[]) {
  return [...items].sort((first, second) => scheduleGroup(first).localeCompare(scheduleGroup(second))
    || first.sort_order - second.sort_order || first.id.localeCompare(second.id));
}
