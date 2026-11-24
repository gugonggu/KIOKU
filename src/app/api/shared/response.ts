import type { SharedTripResult } from "@/lib/trip-share-data";
import { sharedUnavailableMessage } from "@/lib/trip-share-types";

export function sharedTripResponse(result: SharedTripResult) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  switch (result.status) {
    case "found":
      return Response.json(result.trip, { status: 200, headers });
    case "missing":
      return Response.json({ error: "공유 링크를 열 수 없어요." }, { status: 404, headers });
    case "unavailable":
      return Response.json({ error: sharedUnavailableMessage }, { status: 503, headers });
  }
}
