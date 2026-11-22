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

export type Database = {
  public: {
    Tables: {
      trips: {
        Row: TripRow;
        Insert: TripFields & { id?: string };
        Update: Partial<TripFields>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
  };
};
