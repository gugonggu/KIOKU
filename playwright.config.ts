import { defineConfig, devices } from "@playwright/test";

const unconfiguredUrl = "http://127.0.0.1:3100";
const configuredUrl = "http://127.0.0.1:3101";

export default defineConfig({
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_CHANNEL,
  },
  projects: [
    { name: "without-config", testMatch: "foundation.spec.ts", use: { baseURL: unconfiguredUrl } },
    { name: "with-test-provider", testMatch: "auth.spec.ts", use: { baseURL: configuredUrl } },
  ],
  webServer: [
    {
      command: "npm start -- --hostname 127.0.0.1 --port 3100",
      url: unconfiguredUrl,
      env: { APP_URL: unconfiguredUrl, SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "" },
    },
    {
      command: "npm start -- --hostname 127.0.0.1 --port 3101",
      url: configuredUrl,
      env: {
        APP_URL: configuredUrl,
        SUPABASE_URL: "http://127.0.0.1:3102",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_fixture",
      },
    },
  ],
});
