import { loadSharedTrip } from "@/lib/trip-share-data";

export const dynamic = "force-dynamic";

async function readToken(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const bytes = new Uint8Array(43);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return size === bytes.length ? new TextDecoder().decode(bytes) : "";
      if (size + value.length > bytes.length) {
        await reader.cancel();
        return "";
      }
      bytes.set(value, size);
      size += value.length;
    }
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const token = await readToken(request);
  const trip = token ? await loadSharedTrip(token) : null;
  return Response.json(trip ?? { error: "공유 링크를 열 수 없어요." }, {
    status: trip ? 200 : 404,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" },
  });
}
