import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
  logging: { incomingRequests: { ignore: [/^\/auth\/confirm(?:\?|$)/] } },
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
