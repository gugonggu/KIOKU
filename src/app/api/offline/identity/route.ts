import { getVerifiedUserId } from "@/lib/auth";

export async function GET() {
  const owner = await getVerifiedUserId();
  return Response.json({ owner }, { status: owner ? 200 : 401, headers: { "Cache-Control": "private, no-store" } });
}
