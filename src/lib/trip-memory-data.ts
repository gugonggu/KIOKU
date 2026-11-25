import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getAuthConfig } from "./auth-config";
import type { Database } from "./database.types";
import { readRows } from "./trip-plan-data";
import { requireTripClient } from "./trips";

export const memoryBucket = "trip-memory";
export const memoryPhotoKey = (tripId: string, id: string) => tripId + "/" + id + ".jpg";

export function memoryStorageWriter() {
  const url = getAuthConfig()?.supabaseUrl;
  const key = process.env.SUPABASE_STORAGE_SECRET_KEY?.trim();
  if (!url || !key?.startsWith("sb_secret_")) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function loadTripMemory(tripId: string) {
  const { client } = await requireTripClient();
  const [entries, photos, visits] = await Promise.all([
    readRows((start, end) => client.from("trip_memory_entries").select("*").eq("trip_id", tripId)
      .order("day").order("created_at").order("id").range(start, end)),
    readRows((start, end) => client.from("trip_memory_photos").select("*").eq("trip_id", tripId)
      .order("day").order("sort_order").order("id").range(start, end)),
    readRows((start, end) => client.from("trip_visit_marks").select("trip_id,schedule_id,status").eq("trip_id", tripId)
      .order("schedule_id").range(start, end)),
  ]);
  return entries && photos && visits ? { entries, photos, visits } : null;
}

export async function loadMemoryCover(tripId: string) {
  const { client } = await requireTripClient();
  const { data } = await client.from("trip_memory_photos").select("id,title,width,height")
    .eq("trip_id", tripId).eq("phase", "ready").eq("is_cover", true).maybeSingle();
  return data;
}
