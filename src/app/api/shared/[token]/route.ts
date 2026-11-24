import { requiresFragmentShareLinks } from "@/lib/auth-config";
import { loadSharedTrip } from "@/lib/trip-share-data";
import { sharedTripResponse } from "../response";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/shared/[token]">) {
  const { token } = await params;
  return sharedTripResponse(requiresFragmentShareLinks() ? { status: "missing" } : await loadSharedTrip(token));
}
