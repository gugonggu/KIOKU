import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

export async function verifyReleaseMobile({ app, path, tripId, signIn }) {
  const desktop = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await desktop.newPage({ viewport: { width: 360, height: 900 } });
    await signIn(page);
    for (const width of [360, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["", "/itinerary?date=2027-02-19", "/map", "/bookings", "/more",
        "/preparation", "/budget", "/share", "/memory?date=2027-02-19", "/offline", "/guide"]) {
        const response = await page.goto(app + path + route);
        assert.equal(response?.status(), 200, `${width}px ${route}`);
        await expect(page.getByRole("main")).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
          message: `${width}px ${route || "home"} fits the viewport`,
        }).toBe(true);
      }
    }
    console.log("PASS desktop mobile emulation: 11 routes at 360, 390, 430, 768 and 1440px.");
  } finally {
    await desktop.close();
  }

  if (!process.env.KIOKU_ANDROID_CDP) return;
  const endpoint = new URL(process.env.KIOKU_ANDROID_CDP);
  assert.equal(endpoint.hostname, "127.0.0.1", "Use a loopback ADB forward");
  const android = await chromium.connectOverCDP(endpoint.origin);
  try {
    const context = android.contexts()[0];
    const page = await context.newPage();
    await signIn(page);
    const agent = await page.evaluate(() => navigator.userAgent);
    assert.match(agent, /Android.*Chrome/);
    await page.goto(app + path + "/itinerary?date=2027-02-19");
    await expect(page.getByText("오타루 운하", { exact: true })).toBeVisible();
    await page.goto(app + path + "/offline");
    const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/offline.html");
    await page.getByRole("button", { name: "오프라인 수첩 저장" }).click();
    await expect(page.getByText("이 기기에 수첩을 저장했어요.")).toBeVisible();
    const shell = await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready;
      const cache = await caches.open("kioku-offline-shell-v1");
      return { secure: isSecureContext, script: new URL(worker.active.scriptURL).pathname,
        cached: (await cache.keys()).map((request) => new URL(request.url).pathname).sort() };
    });
    assert.equal(shell.secure, true);
    assert.equal(shell.script, "/kioku-worker.js");
    assert.deepEqual(shell.cached, ["/kioku-icon-192.png", "/kioku-icon-512.png", "/kioku-maskable-512.png",
      "/manifest.webmanifest", "/offline-store.js", "/offline.css", "/offline.html", "/offline.js"]);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    try {
      await page.goto(app + "/offline.html?trip=" + tripId);
      await expect(page.getByText(/오타루 운하/)).toBeVisible();
      await expect(page.getByText(/가상 운하 위치/).first()).toBeVisible();
    } finally {
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await cdp.detach();
    }
    await page.goto(app + path + "/guide");
    await expect(page.getByRole("article", { name: "인쇄 미리보기" })).toBeVisible();
    await page.close();
    console.log("PASS Android Chrome: auth, itinerary, secure context, manifest, service worker, offline schedule and place, network recovery and guide preview.");
  } finally {
    await android.close();
  }
}
