import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  logging: { incomingRequests: { ignore: [/^\/auth\/confirm(?:\?|$)/, /^\/api\/places\/search(?:\?|$)/] } },
  outputFileTracingIncludes: { "/map-assets/**": ["./node_modules/maplibre-gl/dist/maplibre-gl-{worker,shared}.mjs"] },
  async headers() {
    return [{
      source: "/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }, ...["/trips/:path*", "/login", "/auth/:path*"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    }))];
  },
};

export default config;
