import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getAuthConfig } from "./auth-config";
import { shareProof } from "./trip-share-token";
import { requireTripClient } from "./trips";

export async function loadSharedTrip(token: string) {
  const proof = shareProof(token);
  const config = getAuthConfig();
  if (!proof || !config) return null;
  const client = createClient<Database>(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, options) => fetch(input, { ...options, cache: "no-store" }) },
  });
  const { data, error } = await client.rpc("read_shared_trip", { p_proof: proof });
  return error ? null : data;
}

export async function loadShareSettings(tripId: string) {
  const { client } = await requireTripClient();
  const { data, error } = await client.rpc("read_share_settings", { p_trip: tripId, p_preview: false });
  return !error && data && "revision" in data ? data : null;
}

export async function loadSharePreview(tripId: string) {
  const { client } = await requireTripClient();
  const { data, error } = await client.rpc("read_share_settings", { p_trip: tripId, p_preview: true });
  return !error && data && "title" in data ? data : null;
}
