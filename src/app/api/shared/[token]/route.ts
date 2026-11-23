import { loadSharedTrip } from "@/lib/trip-share-data";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/shared/[token]">) {
  const { token } = await params;
  const trip = await loadSharedTrip(token);
  return Response.json(trip ?? { error: "공유 링크를 열 수 없어요." }, {
    status: trip ? 200 : 404,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" },
  });
}
