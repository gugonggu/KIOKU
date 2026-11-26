import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { e2eHost, e2ePorts, e2eUrls } from "./tests/support/e2e-ports";

export default defineConfig({
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  use: {
    ...(process.env.PLAYWRIGHT_BROWSER === "webkit" ? devices["Desktop Safari"] : devices["Desktop Chrome"]),
    channel: process.env.PLAYWRIGHT_BROWSER === "webkit" ? undefined : process.env.PLAYWRIGHT_CHANNEL,
  },
  projects: [
    { name: "without-config", testMatch: "foundation.spec.ts", use: { baseURL: e2eUrls.unconfigured } },
    { name: "with-test-provider", testMatch: "auth.spec.ts", use: { baseURL: e2eUrls.configured } },
  ],
  webServer: [
    {
      command: `npm start -- --hostname ${e2eHost} --port ${e2ePorts.unconfigured}`,
      url: e2eUrls.unconfigured,
      env: { APP_URL: e2eUrls.unconfigured, SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "" },
    },
    {
      command: `npm start -- --hostname ${e2eHost} --port ${e2ePorts.configured}`,
      url: e2eUrls.configured,
      env: {
        APP_URL: e2eUrls.configured,
        SUPABASE_URL: e2eUrls.provider,
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_fixture",
        GEOAPIFY_API_KEY: "",
        SUPABASE_STORAGE_SECRET_KEY: "sb_secret_e2e_fixture",
        KIOKU_SHARE_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
      },
    },
  ],
});
