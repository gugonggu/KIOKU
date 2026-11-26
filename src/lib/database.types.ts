import type { SharedTrip, ShareSettings } from "./trip-share-types";

export type TripFields = {
  title: string;
  destination_label: string;
  start_date: string | null;
  end_date: string | null;
  traveler_count: number | null;
};

export type TripRow = TripFields & {
  id: string;
  owner_id: string;
  country_code: "JP";
  timezone: "Asia/Tokyo";
  cover_photo_id: string | null;
  cover_theme: import("./trip-cover").CoverTheme;
  content_version: number;
  created_at: string;
  updated_at: string;
};

export type ScheduleTiming = "FIXED" | "PERIOD" | "UNSCHEDULED";
export type SchedulePeriod = "MORNING" | "AFTERNOON" | "EVENING";
export type ScheduleKind = "PLACE" | "MOVE" | "NOTE" | "BOOKING_REF";

export type ScheduleFields = {
  title: string;
  kind: ScheduleKind;
  time_mode: ScheduleTiming;
  local_date: string | null;
  fixed_local_time: string | null;
  end_local_time?: string | null;
  period: SchedulePeriod | null;
  place_id: string | null;
  booking_id?: string | null;
  private_note: string | null;
  shared_note: string | null;
};

export type PlaceFields = {
  display_name: string;
  name_ko: string | null;
  name_ja: string | null;
  name_en: string | null;
  address_text: string | null;
  address_ja: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  provider: "MANUAL" | "GEOAPIFY";
  provider_place_id: string | null;
};

export type PeriodImpact = { date: string; count: number; group: "DAY" | "OUTSIDE" | "NO_RANGE" };

type PlanRow = { id: string; trip_id: string; content_version: number; updated_at: string };

export type ScheduleRow = ScheduleFields & Omit<PlanRow, "content_version"> & {
  revision: number;
  booking_id: string | null;
  sort_order: number;
  archived_date: string | null;
  archived_time_mode: ScheduleTiming | null;
  archived_fixed_time: string | null;
  archived_period: SchedulePeriod | null;
  archived_sort_order: number | null;
};
export type PlaceRow = PlaceFields & PlanRow & { created_at: string };

export type BookingKind = "FLIGHT" | "STAY" | "TOUR";
export type BookingStatus = "NEEDS_BOOKING" | "PENDING" | "CONFIRMED" | "CANCELLED";
export type BookingFields = { kind: BookingKind; title: string; status: BookingStatus; shared_note: string | null };
export type FlightFields = {
  airline_name: string | null;
  flight_number: string | null;
  departure_airport: string | null;
  arrival_airport: string | null;
  departure_local_date: string | null;
  arrival_local_date: string | null;
  departure_local_time: string | null;
  arrival_local_time: string | null;
  departure_timezone: string | null;
  arrival_timezone: string | null;
};
export type StayFields = {
  address_text: string | null;
  check_in_local_date: string | null;
  check_out_local_date: string | null;
  check_in_local_time: string | null;
  check_out_local_time: string | null;
  guest_count: number | null;
  room_count: number | null;
};
export type TourFields = {
  event_local_date: string | null;
  event_local_time: string | null;
  meeting_local_time: string | null;
  meeting_place_name: string | null;
  meeting_address_text: string | null;
  meeting_latitude: number | null;
  meeting_longitude: number | null;
};
export type PrivateBookingFields = {
  confirmation_reference: string | null;
  amount: number | null;
  currency: string | null;
  private_note: string | null;
};
export type BookingInput = BookingFields & { private: PrivateBookingFields | null } & (
  { kind: "FLIGHT"; detail: FlightFields[] } | { kind: "STAY"; detail: StayFields } | { kind: "TOUR"; detail: TourFields }
);
type BookingChild = { trip_id: string; booking_id: string };
type BookingTable<Row extends object> = { Row: Row; Insert: never; Update: never; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      trips: {
        Row: TripRow;
        Insert: TripFields & { id?: string };
        Update: Partial<TripFields>;
        Relationships: [];
      };
      itinerary_items: {
        Row: ScheduleRow;
        Insert: ScheduleFields & { id?: string; trip_id: string };
        Update: Partial<ScheduleFields>;
        Relationships: [];
      };
      trip_places: {
        Row: PlaceRow;
        Insert: PlaceFields & { id?: string; trip_id: string };
        Update: Partial<PlaceFields>;
        Relationships: [];
      };
      bookings: BookingTable<BookingFields & PlanRow & { created_at: string }>;
      flight_segments: BookingTable<FlightFields & BookingChild & {
        id: string; segment_order: number; departure_utc: string | null; arrival_utc: string | null;
      }>;
      stay_details: BookingTable<StayFields & BookingChild & { property_name: string }>;
      tour_details: BookingTable<TourFields & BookingChild>;
      booking_private_details: BookingTable<PrivateBookingFields & BookingChild>;
      trip_preparation: {
        Row: import("./trip-preparation").PreparationRow;
        Insert: Pick<import("./trip-preparation").PreparationRow, "trip_id" | "title" | "category" | "due_date" | "note">;
        Update: Partial<Pick<import("./trip-preparation").PreparationRow, "title" | "category" | "due_date" | "note" | "done">>;
        Relationships: [];
      };
      trip_budgets: {
        Row: import("./trip-budget").Budget;
        Insert: import("./trip-budget").Budget;
        Update: Partial<Omit<import("./trip-budget").Budget, "trip_id">>;
        Relationships: [];
      };
      trip_expenses: {
        Row: import("./trip-budget").Expense;
        Insert: Omit<import("./trip-budget").Expense, "revision">;
        Update: Partial<import("./trip-budget").ExpenseFields>;
        Relationships: [];
      };
      trip_memory_entries: {
        Row: import("./trip-memory").MemoryEntry;
        Insert: Omit<import("./trip-memory").MemoryEntry, "created_at">;
        Update: Partial<import("./trip-memory").MemoryEntryFields>;
        Relationships: [];
      };
      trip_memory_photos: {
        Row: import("./trip-memory").MemoryPhoto;
        Insert: import("./trip-memory").MemoryPhotoFields & { id: string; trip_id: string };
        Update: Partial<Omit<import("./trip-memory").MemoryPhoto, "id" | "trip_id" | "created_at">>;
        Relationships: [];
      };
      trip_visit_marks: {
        Row: import("./trip-memory").VisitMark;
        Insert: import("./trip-memory").VisitMark;
        Update: { status?: import("./trip-memory").VisitStatus };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      set_trip_cover: { Args: { p_trip: string; p_version: number; p_theme: string; p_photo: string | null }; Returns: boolean };
      read_shared_trip: { Args: { p_proof: string }; Returns: SharedTrip | null };
      apply_preparation_template: { Args: { p_trip: string; p_items: { title: string; category: string; source: string }[] }; Returns: undefined };
      move_preparation: { Args: { p_trip: string; p_id: string; p_direction: number }; Returns: undefined };
      save_trip_budget: { Args: { p_trip: string; p_amount: number; p_rate: number; p_people: string[] }; Returns: undefined };
      set_trip_visit: { Args: { p_trip: string; p_schedule: string; p_status: import("./trip-memory").VisitStatus }; Returns: undefined };
      organize_memory_photo: { Args: { p_trip: string; p_id: string; p_command: "earlier" | "later" | "cover" }; Returns: boolean };
      import_trip_schedule: { Args: { p_trip: string; p_version: number; p_rows: import("./trip-import").TripImportRow[] }; Returns: { inserted: number; skipped: number } | null };
      read_share_settings: { Args: { p_trip: string; p_preview: boolean }; Returns: ShareSettings | SharedTrip | null };
      write_share_settings: {
        Args: { p_trip: string; p_revision: number; p_mode: "issue" | "settings" | "stop"; p_expiry: string | null;
          p_bookings: boolean; p_notes: boolean; p_hash: string | null; p_cipher: string | null };
        Returns: boolean;
      };
      save_booking: {
        Args: { p_trip: string; p_id: string; p_version: number | null; p_fields: BookingInput };
        Returns: "saved" | "existing" | "changed";
      };
      delete_booking: {
        Args: { p_trip: string; p_id: string; p_version: number; p_expected: string[] };
        Returns: "deleted" | "preview" | "changed";
      };
      save_trip_place: {
        Args: { p_trip: string; p_id: string; p_version: number | null; p_fields: PlaceFields; p_confirm: string | null };
        Returns: { status: "saved" | "existing" | "duplicate" | "changed"; id?: string };
      };
      delete_trip_place: {
        Args: { p_trip: string; p_id: string; p_version: number; p_expected_count: number };
        Returns: { status: "deleted" | "changed" } | { status: "preview"; count: number };
      };
      authorize_place_search: {
        Args: { p_trip: string };
        Returns: boolean;
      };
      update_trip_period: {
        Args: { p_trip: string; p_version: number; p_fields: TripFields; p_expected: PeriodImpact[] | null };
        Returns: { status: "saved" | "changed" } | { status: "preview"; entries: PeriodImpact[] };
      };
      save_itinerary_item: {
        Args: { p_trip: string; p_item: string; p_revision: number | null; p_trip_version: number; p_fields: ScheduleFields };
        Returns: string;
      };
      swap_itinerary_items: {
        Args: { p_trip: string; p_first: string; p_first_version: number; p_second: string; p_second_version: number };
        Returns: boolean;
      };
      place_itinerary_item: {
        Args: { p_trip: string; p_item: string; p_revision: number; p_command: string; p_date: string | null; p_trip_version: number };
        Returns: boolean;
      };
    };
  };
};
