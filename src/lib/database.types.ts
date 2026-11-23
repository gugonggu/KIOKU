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
  period: SchedulePeriod | null;
  place_id: string | null;
  private_note: string | null;
  shared_note: string | null;
};

export type PlaceFields = {
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
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
export type PlaceRow = PlaceFields & PlanRow;

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
    };
    Views: Record<never, never>;
    Functions: {
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
