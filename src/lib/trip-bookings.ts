import type {
  BookingInput, FlightFields, PrivateBookingFields, StayFields, TourFields,
} from "./database.types";
import { isCalendarDate } from "./trip-details.ts";

export const bookingKinds = { FLIGHT: "항공", STAY: "숙소", TOUR: "투어" } as const;
export const bookingStatuses = {
  NEEDS_BOOKING: "예약 필요", PENDING: "예약 진행 중", CONFIRMED: "예약 완료", CANCELLED: "취소됨",
} as const;
export const maxFlightSegments = 20;

type Rule = readonly [label: string, format: "date" | "time" | "zone" | "airport" | "count" | "amount" | "currency" | "latitude" | "longitude" | number];

export const flightRules = {
  airline_name: ["항공사", 100], flight_number: ["편명", 20],
  departure_airport: ["출발 공항 코드", "airport"], arrival_airport: ["도착 공항 코드", "airport"],
  departure_local_date: ["출발 현지 날짜", "date"], arrival_local_date: ["도착 현지 날짜", "date"],
  departure_local_time: ["출발 현지 시각", "time"], arrival_local_time: ["도착 현지 시각", "time"],
  departure_timezone: ["출발 공항 시간대", "zone"], arrival_timezone: ["도착 공항 시간대", "zone"],
} as const satisfies Record<keyof FlightFields, Rule>;
export const stayRules = {
  address_text: ["숙소 주소", 300],
  check_in_local_date: ["체크인 날짜", "date"], check_in_local_time: ["체크인 시각", "time"],
  check_out_local_date: ["체크아웃 날짜", "date"], check_out_local_time: ["체크아웃 시각", "time"],
  guest_count: ["인원", "count"], room_count: ["객실 수", "count"],
} as const satisfies Record<keyof StayFields, Rule>;
export const tourRules = {
  event_local_date: ["투어 날짜", "date"], event_local_time: ["투어 시작 시각", "time"],
  meeting_local_time: ["집합 시각", "time"], meeting_place_name: ["집합 장소", 100], meeting_address_text: ["집합 주소", 300],
  meeting_latitude: ["집합 위도", "latitude"], meeting_longitude: ["집합 경도", "longitude"],
} as const satisfies Record<keyof TourFields, Rule>;
export const privateRules = {
  confirmation_reference: ["예약번호", 100], amount: ["결제금액", "amount"], currency: ["통화 코드", "currency"],
  private_note: ["개인 메모", 1500],
} as const satisfies Record<keyof PrivateBookingFields, Rule>;

function read(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseValue(value: string, format: Rule[1]): string | number | null | undefined {
  if (!value) return null;
  switch (format) {
    case "date": return isCalendarDate(value) ? value : undefined;
    case "time": return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;
    case "airport": return /^[a-z0-9]{3,4}$/i.test(value) ? value.toUpperCase() : undefined;
    case "currency": return /^[a-z]{3}$/i.test(value) ? value.toUpperCase() : undefined;
    case "count": return /^[1-9]\d{0,2}$/.test(value) ? Number(value) : undefined;
    case "amount": return /^\d{1,12}(?:\.\d{1,2})?$/.test(value) ? Number(value) : undefined;
    case "latitude":
    case "longitude": {
      const limit = format === "latitude" ? 90 : 180;
      const coordinate = Number(value);
      return /^-?\d+(?:\.\d+)?$/.test(value) && Math.abs(coordinate) <= limit ? coordinate : undefined;
    }
    case "zone": {
      if (!/^[a-zA-Z][a-zA-Z0-9_+\-/]{0,63}$/.test(value)) return undefined;
      try {
        return new Intl.DateTimeFormat("ko", { timeZone: value }).resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    }
    default: return value.length <= format ? value : undefined;
  }
}

function parseFields<T extends object>(form: FormData, rules: Record<keyof T, Rule>, prefix = ""): T | string {
  const values = {} as Record<string, string | number | null>;
  for (const [key, [label, format]] of Object.entries<Rule>(rules)) {
    const value = parseValue(read(form, prefix + key), format);
    if (value === undefined) return label + " 항목을 확인해 주세요.";
    values[key] = value;
  }
  return values as T;
}

export function parseBooking(form: FormData): BookingInput | string {
  const kind = read(form, "kind");
  const title = read(form, "title");
  const status = read(form, "status");
  const note = read(form, "shared_note");
  if (kind !== "FLIGHT" && kind !== "STAY" && kind !== "TOUR") return "예약 유형을 선택해 주세요.";
  if (!title || title.length > 100) return "예약 이름을 1~100자로 입력해 주세요.";
  if (status !== "NEEDS_BOOKING" && status !== "PENDING" && status !== "CONFIRMED" && status !== "CANCELLED") return "예약 상태를 선택해 주세요.";
  if (note.length > 1500) return "공유용 메모는 1,500자까지 입력할 수 있어요.";
  const privateFields = parseFields<PrivateBookingFields>(form, privateRules);
  if (typeof privateFields === "string") return privateFields;
  if ((privateFields.amount === null) !== (privateFields.currency === null)) return "결제금액과 통화 코드를 함께 입력해 주세요.";
  const base = {
    title, status, shared_note: note || null,
    private: Object.values(privateFields).every((value) => value === null) ? null : privateFields,
  } satisfies Pick<BookingInput, "title" | "status" | "shared_note" | "private">;
  if (kind === "FLIGHT") {
    const count = Number(read(form, "segment_count"));
    if (!Number.isInteger(count) || count < 1 || count > maxFlightSegments) return "항공 구간을 1~20개 입력해 주세요.";
    const detail: FlightFields[] = [];
    for (let index = 0; index < count; index++) {
      const segment = parseFields<FlightFields>(form, flightRules, "flight." + index + ".");
      if (typeof segment === "string") return (index + 1) + "구간의 " + segment;
      detail.push(segment);
    }
    return { ...base, kind, detail };
  }
  if (kind === "STAY") {
    const detail = parseFields<StayFields>(form, stayRules);
    if (typeof detail === "string") return detail;
    if (detail.check_in_local_date && detail.check_out_local_date && detail.check_out_local_date < detail.check_in_local_date) {
      return "체크아웃 날짜는 체크인 날짜보다 빠를 수 없어요.";
    }
    return { ...base, kind, detail };
  }
  const detail = parseFields<TourFields>(form, tourRules);
  if (typeof detail === "string") return detail;
  if ((detail.meeting_latitude === null) !== (detail.meeting_longitude === null)) return "집합 장소 위도와 경도를 함께 입력해 주세요.";
  return { ...base, kind, detail };
}
