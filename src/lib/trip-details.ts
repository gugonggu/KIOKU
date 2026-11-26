import type { TripFields, TripRow } from "./database.types";

export type Trip = TripFields & Pick<TripRow, "id" | "content_version"> & Partial<Pick<TripRow,"cover_theme">>;
export type TripFormValues = Record<keyof TripFields, string>;
export type TripFieldErrors = Partial<Record<keyof TripFields, string>>;

export const TRIP_TEXT_LIMIT = 80;
export const MAX_TRAVELERS = 50;

export const emptyTripForm: TripFormValues = {
  title: "", destination_label: "", start_date: "", end_date: "", traveler_count: "",
};

export function tripFormValues(trip: Trip): TripFormValues {
  return {
    title: trip.title,
    destination_label: trip.destination_label,
    start_date: trip.start_date ?? "",
    end_date: trip.end_date ?? "",
    traveler_count: trip.traveler_count?.toString() ?? "",
  };
}

export function isCalendarDate(value: string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseTripDetails(formData: FormData, savedCount: number | null = null): { fields: TripFields } | { errors: TripFieldErrors } {
  const read = (key: keyof TripFields) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const title = read("title");
  const destination = read("destination_label");
  const startDate = read("start_date");
  const endDate = read("end_date");
  const count = read("traveler_count");
  const errors: TripFieldErrors = {};

  if (!title || title.length > TRIP_TEXT_LIMIT) errors.title = "여행 이름을 1~80자로 입력해 주세요.";
  if (!destination || destination.length > TRIP_TEXT_LIMIT) errors.destination_label = "목적지를 1~80자로 입력해 주세요.";
  if (startDate && !isCalendarDate(startDate)) errors.start_date = "유효한 출발일을 입력해 주세요.";
  if (endDate && !isCalendarDate(endDate)) errors.end_date = "유효한 돌아오는 날을 입력해 주세요.";
  if (startDate && !endDate) errors.end_date = "출발일과 돌아오는 날을 모두 입력해 주세요.";
  if (endDate && !startDate) errors.start_date = "출발일과 돌아오는 날을 모두 입력해 주세요.";
  if (startDate && endDate && !errors.start_date && !errors.end_date && endDate < startDate) {
    errors.end_date = "돌아오는 날은 출발일과 같거나 그 이후여야 해요.";
  }
  const travelerCount = Number(count);
  if (count && (!/^\d+$/.test(count) || travelerCount < 1 || (travelerCount > MAX_TRAVELERS && travelerCount !== savedCount))) {
    errors.traveler_count = "여행 인원을 1~" + MAX_TRAVELERS + "명으로 입력해 주세요.";
  }

  if (Object.keys(errors).length) return { errors };
  return {
    fields: {
      title,
      destination_label: destination,
      start_date: startDate || null,
      end_date: endDate || null,
      traveler_count: count ? Number(count) : null,
    },
  };
}

const japanCalendar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", dateStyle: "short" });

export function japanDate(now = new Date()) {
  return japanCalendar.format(now);
}

export function tripStatus(trip: Pick<Trip, "start_date" | "end_date">, today: string) {
  if (!trip.start_date || !trip.end_date) return "unscheduled";
  if (trip.end_date < today) return "past";
  if (trip.start_date > today) return "upcoming";
  return "active";
}

export const tripStatuses = {
  active: { section: "여행 중", label: "여행 중" },
  upcoming: { section: "다가오는 여행", label: "준비 중" },
  unscheduled: { section: "날짜 미정", label: "날짜 미정" },
  past: { section: "지난 여행", label: "다녀온 여행" },
} as const;

export function dateLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}

export function durationLabel(start: string, end: string) {
  const nights = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return nights === 0 ? "당일치기" : `${nights}박 ${nights + 1}일`;
}
