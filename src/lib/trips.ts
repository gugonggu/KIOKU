import { notFound, redirect } from "next/navigation";
import { createAuthClient, requireUser } from "./auth";

const tripColumns = "id,title,destination_label,start_date,end_date,traveler_count,content_version,cover_theme";

export function isTripId(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export async function requireTripClient() {
  const ownerId = await requireUser();
  const client = await createAuthClient();
  if (!client) redirect("/login");
  return { ownerId, client };
}

export async function listTrips() {
  const { client, ownerId } = await requireTripClient();
  return client.from("trips").select(tripColumns).eq("owner_id", ownerId)
    .order("created_at", { ascending: false }).order("id");
}

export async function getTrip(tripId: string, { allowMissing = false } = {}) {
  const { client, ownerId } = await requireTripClient();
  if (!isTripId(tripId)) notFound();
  const result = await client.from("trips").select(tripColumns)
    .eq("owner_id", ownerId).eq("id", tripId).maybeSingle();
  if (!result.error && !result.data && !allowMissing) notFound();
  return result;
}
