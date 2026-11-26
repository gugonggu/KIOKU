import type { BookingKind, BookingStatus, SchedulePeriod } from "./database.types";

export const sharedUnavailableMessage = "공유 여행을 불러오지 못했어요";

export type ShareSettings = {
  enabled: boolean;
  encryptedToken: string | null;
  expired: boolean;
  expiresOn: string | null;
  bookings: boolean;
  notes: boolean;
  revision: number;
};

export type SharedPlace = {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type SharedSchedule = {
  title: string;
  date: string;
  fixed_local_time: string | null;
  end_local_time?: string | null;
  period: SchedulePeriod | null;
  place: SharedPlace | null;
  note?: string | null;
};

type Flight = {
  departureAirport: string | null; arrivalAirport: string | null;
  departureDate: string | null; arrivalDate: string | null;
  departureTime: string | null; arrivalTime: string | null;
  departureZone: string | null; arrivalZone: string | null;
};
type Stay = { address: string | null; checkInDate: string | null; checkInTime: string | null; checkOutDate: string | null; checkOutTime: string | null };
type Tour = {
  date: string | null; time: string | null; meetingTime: string | null;
  meetingName: string | null; meetingAddress: string | null; latitude: number | null; longitude: number | null;
};
export type SharedBooking = { title: string; status: BookingStatus; kind: BookingKind; note?: string | null } & (
  { kind: "FLIGHT"; detail: Flight[] } | { kind: "STAY"; detail: Stay | null } | { kind: "TOUR"; detail: Tour | null }
);
export type SharedTrip = {
  title: string; destination: string; startDate: string | null; endDate: string | null;
  places: SharedPlace[]; schedule: SharedSchedule[]; bookings: SharedBooking[] | null;
};
