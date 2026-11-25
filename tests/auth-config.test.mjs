import assert from "node:assert/strict";
import test from "node:test";
import { getAppOrigin } from "../src/lib/auth-config.ts";

test("only Vercel Preview prefers a provider-managed deployment origin", () => {
  const preview = {
    VERCEL_ENV: "preview", APP_URL: "https://previous.vercel.app",
    VERCEL_BRANCH_URL: "kioku-git-feature-team.vercel.app", VERCEL_URL: "kioku-asdf-team.vercel.app",
  };
  assert.equal(getAppOrigin(preview), "https://kioku-git-feature-team.vercel.app");
  assert.equal(getAppOrigin({ ...preview, VERCEL_BRANCH_URL: "evil.example" }), "https://kioku-asdf-team.vercel.app");
  assert.equal(getAppOrigin({ ...preview, VERCEL_BRANCH_URL: "a.vercel.app/path", VERCEL_URL: "a.vercel.app.evil.example" }), "https://previous.vercel.app");
  assert.equal(getAppOrigin({ ...preview, VERCEL_ENV: "production" }), "https://previous.vercel.app");
  assert.equal(getAppOrigin({ APP_URL: "http://localhost:3000" }), "http://localhost:3000");
});
