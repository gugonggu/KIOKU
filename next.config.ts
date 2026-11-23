import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.KIOKU_BUILD_DIR === ".next/m5" ? ".next/m5" : undefined,
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  logging: { incomingRequests: { ignore: [/^\/auth\/confirm(?:\?|$)/, /^\/api\/places\/search(?:\?|$)/,
    /^\/(?:s|api\/shared)(?:\/|\?|$)/] } },
  outputFileTracingIncludes: { "/map-assets/**": ["./node_modules/maplibre-gl/dist/maplibre-gl-{worker,shared}.mjs"] },
  async headers() {
    return [{
      source: "/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }, ...["/trips/:path*", "/login", "/auth/:path*"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    })), ...["/s/:path*", "/api/shared/:path*"].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }))];
  },
};

export default config;
