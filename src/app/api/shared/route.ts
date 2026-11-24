import { loadSharedTrip } from "@/lib/trip-share-data";
import { sharedTripResponse } from "./response";

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
  return sharedTripResponse(await loadSharedTrip(token));
}
