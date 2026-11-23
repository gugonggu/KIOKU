import { createHash } from "node:crypto";
import { createAuthClient, getVerifiedUserId } from "@/lib/auth";
import { normalizeQuery, queryGeoapify, type GeoapifyResult } from "@/lib/geoapify";
import { isTripId } from "@/lib/trips";

const headers = { "Cache-Control": "private, no-store" };
const pending = new Map<string, Promise<GeoapifyResult>>();
const cache = new Map<string, { until: number; result: GeoapifyResult }>();
const maxCacheEntries = 128;
let cooldownUntil = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tripId = url.searchParams.get("tripId") ?? "";
  const query = normalizeQuery(url.searchParams.get("q") ?? "");
  const ownerId = await getVerifiedUserId();
  if (!ownerId) return Response.json({ status: "unauthorized" }, { status: 401, headers });
  if (!query || !isTripId(tripId)) return Response.json({ status: "invalid" }, { status: 400, headers });
  const client = await createAuthClient();
  if (!client) return Response.json({ status: "unauthorized" }, { status: 401, headers });
  const trip = await client.from("trips").select("id").eq("id", tripId).eq("owner_id", ownerId).maybeSingle();
  if (trip.error) return Response.json({ status: "unavailable" }, { status: 503, headers });
  if (!trip.data) return Response.json({ status: "missing" }, { status: 404, headers });

  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) return Response.json({ status: "unconfigured" }, { status: 503, headers });
  if (Date.now() < cooldownUntil) return Response.json({ status: "limited" }, { status: 429, headers });

  const token = createHash("sha256").update(ownerId).update(":").update(query).digest("hex");
  const cached = cache.get(token);
  if (cached && Date.now() < cached.until) return Response.json(cached.result, { headers });
  let task = pending.get(token);
  if (!task) {
    if (pending.size >= 32) return Response.json({ status: "limited" }, { status: 429, headers });
    task = (async (): Promise<GeoapifyResult> => {
      const quota = await client.rpc("authorize_place_search", { p_trip: tripId });
      if (quota.error) return { status: "unavailable" };
      if (!quota.data) return { status: "limited" };
      const result = await queryGeoapify(query, key);
      if (result.status === "limited") cooldownUntil = Date.now() + 60_000;
      if (result.status === "ok") {
        if (cache.size >= maxCacheEntries) {
          const oldest = cache.keys().next();
          if (!oldest.done) cache.delete(oldest.value);
        }
        cache.set(token, { until: Date.now() + 120_000, result });
      }
      return result;
    })().catch((): GeoapifyResult => ({ status: "unavailable" })).finally(() => pending.delete(token));
    pending.set(token, task);
  }
  const result = await task;
  return Response.json(result, { status: result.status === "ok" ? 200 : result.status === "limited" ? 429 : 503, headers });
}
