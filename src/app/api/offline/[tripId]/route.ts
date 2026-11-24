import { getVerifiedUserId } from "@/lib/auth";
import { getTrip } from "@/lib/trips";
import { loadTravelSnapshot } from "@/lib/travel-snapshot-data";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_request: Request, { params }: RouteContext<"/api/offline/[tripId]">) {
  const owner = await getVerifiedUserId();
  if (!owner) return Response.json({ error: "로그인해 주세요." }, { status: 401, headers });
  const { tripId } = await params;
  const { data: trip, error } = await getTrip(tripId);
  const snapshot = trip && !error && await loadTravelSnapshot(trip);
  if (!snapshot) return Response.json({ error: "수첩을 불러오지 못했어요." }, { status: 503, headers });
  return Response.json({ owner, tripId, savedAt: new Date().toISOString(), snapshot }, { headers });
}
