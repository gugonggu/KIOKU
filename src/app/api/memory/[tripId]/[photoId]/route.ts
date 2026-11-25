import { getVerifiedUserId, createAuthClient } from "@/lib/auth";
import { memoryBucket, memoryPhotoKey } from "@/lib/trip-memory-data";
import { isTripId } from "@/lib/trips";

const headers = {
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(_request: Request, ctx: RouteContext<"/api/memory/[tripId]/[photoId]">) {
  const userId = await getVerifiedUserId();
  if (!userId) return new Response(null, { status: 401, headers });
  const { tripId, photoId } = await ctx.params;
  if (!isTripId(tripId) || !isTripId(photoId)) return new Response(null, { status: 404, headers });
  const client = await createAuthClient();
  if (!client) return new Response(null, { status: 401, headers });
  const { data, error } = await client.from("trip_memory_photos").select("id")
    .eq("trip_id", tripId).eq("id", photoId).eq("phase", "ready").maybeSingle();
  if (error) return new Response(null, { status: 503, headers });
  if (!data) return new Response(null, { status: 404, headers });
  const photo = await client.storage.from(memoryBucket).download(memoryPhotoKey(tripId, photoId));
  if (photo.error) return new Response(null, { status: 503, headers });
  return new Response(photo.data, { headers: { ...headers, "Content-Type": "image/jpeg" } });
}
