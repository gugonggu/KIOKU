import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getAuthConfig } from "./auth-config";
import { scheduleTimeKey } from "./trip-plan";
import { shareProof } from "./trip-share-token";
import type { SharedTrip } from "./trip-share-types";
import { requireTripClient } from "./trips";

export type SharedTripResult = { status: "found"; trip: SharedTrip } | { status: "missing" } | { status: "unavailable" };

function sortSharedTrip(trip: SharedTrip): SharedTrip {
  return { ...trip, schedule: [...trip.schedule].sort((first, second) => first.date.localeCompare(second.date)
    || scheduleTimeKey(first.fixed_local_time, first.period).localeCompare(scheduleTimeKey(second.fixed_local_time, second.period))) };
}

export async function loadSharedTrip(token: string): Promise<SharedTripResult> {
  const proof = shareProof(token);
  if (!proof) return { status: "missing" };
  const config = getAuthConfig();
  if (!config) return { status: "unavailable" };

  try {
    const client = createClient<Database>(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, options) => fetch(input, { ...options, cache: "no-store" }) },
    });
    const { data, error } = await client.rpc("read_shared_trip", { p_proof: proof });
    if (error) return { status: "unavailable" };
    return data ? { status: "found", trip: sortSharedTrip(data) } : { status: "missing" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadShareSettings(tripId: string) {
  const { client } = await requireTripClient();
  const { data, error } = await client.rpc("read_share_settings", { p_trip: tripId, p_preview: false });
  return !error && data && "revision" in data ? data : null;
}

export async function loadSharePreview(tripId: string) {
  const { client } = await requireTripClient();
  const { data, error } = await client.rpc("read_share_settings", { p_trip: tripId, p_preview: true });
  return !error && data && "title" in data ? sortSharedTrip(data) : null;
}
