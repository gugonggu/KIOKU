import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import maplibre from "maplibre-gl/package.json";

const assets = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);

export async function GET(_request: Request, { params }: { params: Promise<{ version: string; asset: string }> }) {
  const { version, asset } = await params;
  if (version !== maplibre.version || !assets.has(asset)) return new Response(null, { status: 404 });
  try {
    const content = await readFile(resolve(process.cwd(), "node_modules", "maplibre-gl", "dist", asset), "utf8");
    return new Response(content, { headers: {
      "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
