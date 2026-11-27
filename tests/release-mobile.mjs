import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const expectAndroid = expect.configure({ timeout: 15000 });

export async function verifyReleaseMobile({ app, path, tripId, signIn }) {
  if (process.env.KIOKU_RELEASE_MOBILE !== "android") await verifyViewportRoutes({ app, path, signIn });
  if (process.env.KIOKU_ANDROID_CDP) await verifyAndroid({ app, path, tripId, signIn });
  else if (process.env.KIOKU_RELEASE_MOBILE === "android") throw new Error("Set KIOKU_ANDROID_CDP to the ADB forward");
}

async function verifyViewportRoutes({ app, path, signIn }) {
  const desktop = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await desktop.newPage({ viewport: { width: 360, height: 900 } });
    await signIn(page);
    for (const width of [360, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["", "/itinerary?date=2027-02-19", "/map", "/bookings", "/more",
        "/preparation", "/share", "/memory?date=2027-02-19", "/offline", "/guide"]) {
        const response = await page.goto(app + path + route);
        assert.equal(response?.status(), 200, `${width}px ${route}`);
        assert.equal(new URL(page.url()).pathname, new URL(app + path + route).pathname, `${width}px ${route} stays signed in`);
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

}

async function verifyAndroid({ app, path, tripId, signIn }) {
  const endpoint = new URL(process.env.KIOKU_ANDROID_CDP);
  assert.equal(endpoint.hostname, "127.0.0.1", "Use a loopback ADB forward");
  const android = await chromium.connectOverCDP(endpoint.origin, { noDefaults: true });
  let page;
  try {
    const context = android.contexts()[0];
    page = await context.newPage();
    await page.bringToFront();
    await signIn(page);
    const agent = await page.evaluate(() => navigator.userAgent);
    assert.match(agent, /Android.*Chrome/);
    await page.goto(app + path + "/itinerary?date=2027-02-19");
    await expectAndroid(page.getByRole("heading", { name: "오타루 운하", exact: true })).toBeVisible();
    await expectAndroid.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    console.log("PASS Android Chrome: sign-in, navigation and online itinerary.");
    await page.goto(app + path + "/offline");
    const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/trips");
    await page.getByRole("button", { name: "오프라인 수첩 저장" }).click();
    await expectAndroid(page.getByText("이 기기에 수첩을 저장했어요.")).toBeVisible();
    const shell = await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready;
      const cache = await caches.open((await caches.keys()).find(key => key.startsWith("kioku-offline-shell-")));
      return { secure: isSecureContext, script: new URL(worker.active.scriptURL).pathname,
        cached: (await cache.keys()).map((request) => new URL(request.url).pathname).sort() };
    });
    assert.equal(shell.secure, true);
    assert.equal(shell.script, "/kioku-worker.js");
    assert.deepEqual(shell.cached, ["/kioku-icon-192.png", "/kioku-icon-512.png", "/kioku-maskable-512.png",
      "/manifest.webmanifest", "/offline-store.js", "/offline.css", "/offline.html", "/offline.js"]);
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    console.log("Android Chrome installability:", installabilityErrors.map((error) => error.errorId).join(", ") || "no errors");
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    try {
      assert.equal(await page.evaluate(() => fetch("/login", { cache: "no-store" }).then(() => true, () => false)), false);
      await page.goto(app + "/offline.html?trip=" + tripId);
      await expectAndroid(page.getByText(/오타루 운하/)).toBeVisible();
      await expectAndroid(page.getByText(/가상 운하 위치/).first()).toBeVisible();
      await captureEmulator();
    } finally {
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await cdp.detach();
    }
    await page.goto(app + path + "/guide");
    await expectAndroid(page.getByRole("article", { name: "인쇄 미리보기" })).toBeVisible();
    console.log("PASS Android Chrome: secure context, manifest, service worker cache, offline schedule and place, network recovery and guide preview.");

    if (process.env.KIOKU_ANDROID_EMULATOR) await verifyEmulatorControls({ page, app, tripId });

    await page.goto(app + path + "/memory?date=2027-02-19");
    await page.locator("#add-photo summary").click();
    const image = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#768677" } }).jpeg().toBuffer();
    const input = page.locator("#add-photo input[name=photo]");
    await expectAndroid(input).toBeVisible();
    await input.setInputFiles({ name: "android-fixture.jpg", mimeType: "image/jpeg", buffer: image });
    await page.getByLabel("사진 제목").fill("Android 시험용 사진");
    await page.getByRole("button", { name: "사진 저장", exact: true }).click();
    await expectAndroid(page.getByRole("img", { name: "Android 시험용 사진", exact: true })).toBeVisible();
    const photo = page.locator(".memory-card").filter({ hasText: "Android 시험용 사진" });
    await photo.getByText("사진 관리", { exact: true }).click();
    await photo.getByRole("button", { name: "사진 삭제", exact: true }).click();
    await photo.getByRole("button", { name: "사진 삭제 확인" }).click();
    await expectAndroid(photo).toHaveCount(0);
    console.log("PASS Android Chrome: fixture file input, upload and photo deletion.");

    await page.goto(app + path + "/map");
    const mapCdp = await context.newCDPSession(page);
    await touch(mapCdp, page.getByRole("button", { name: /가상 운하 위치/ }).first());
    const directions = page.getByRole("link", { name: "Google Maps 길찾기" });
    await expectAndroid(directions).toBeVisible();
    assert.match(await directions.getAttribute("href"), /^https:\/\/www\.google\.com\/maps\/dir\//);
    await touch(mapCdp, page.getByRole("button", { name: "지도에서 보기" }));
    await expectAndroid(page.locator(".maplibregl-canvas").first()).toBeVisible();
    await mapCdp.detach();
    console.log("PASS Android Chrome: touch-select place, directions link and map canvas.");
  } finally {
    try { await page?.close(); } finally { await android.close(); }
  }
}

async function captureEmulator() {
  const serial = process.env.KIOKU_ANDROID_EMULATOR;
  if (!serial) return;
  assert.match(serial, /^emulator-\d+$/, "Select a dedicated Android emulator");
  const png = execFileSync("adb", ["-s", serial, "exec-out", "screencap", "-p"], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  await mkdir("test-results/mobile-release", { recursive: true });
  await writeFile("test-results/mobile-release/android-offline.png", png);
}

async function touch(cdp, target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  assert.ok(box);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function verifyEmulatorControls({ page, app, tripId }) {
  const serial = process.env.KIOKU_ANDROID_EMULATOR;
  assert.match(serial, /^emulator-\d+$/, "Select a dedicated Android emulator");
  const adb = (...args) => execFileSync("adb", ["-s", serial, ...args], { encoding: "utf8", timeout: 10000 }).trim();
  const rotation = adb("shell", "cmd", "window", "user-rotation");
  const savedRotation = rotation.match(/^lock\s+(\d)$/)?.[1];
  const airplane = adb("shell", "cmd", "connectivity", "airplane-mode");
  const port = "tcp:" + new URL(app).port;
  try {
    adb("shell", "cmd", "window", "user-rotation", "lock", "1");
    await expectAndroid.poll(() => page.evaluate(() => matchMedia("(orientation: landscape)").matches)).toBe(true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally {
    adb("shell", "cmd", "window", "user-rotation", ...(savedRotation ? ["lock", savedRotation] : ["free"]));
  }
  console.log("PASS Android OS emulator: system display rotation and landscape layout.");

  const url = app + "/offline.html?trip=" + tripId;
  await page.goto(url);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  try {
    adb("shell", "cmd", "connectivity", "airplane-mode", "enable");
    adb("reverse", "--remove", port);
    assert.equal(adb("shell", "cmd", "connectivity", "airplane-mode"), "enabled");
    // Removing the reverse listener leaves an already-open HTTP keep-alive connection alive.
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    assert.equal(await page.evaluate(() => fetch("/login", { cache: "no-store" }).then(() => true, () => false)), false);
    await page.reload();
    await expectAndroid(page.getByText(/가상 운하 위치/).first()).toBeVisible();
  } finally {
    adb("reverse", port, port);
    adb("shell", "cmd", "connectivity", "airplane-mode", airplane === "enabled" ? "enable" : "disable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.detach();
  }
  await page.goto(app + "/login");
  console.log("PASS Android OS emulator: airplane mode with loopback removed, saved snapshot reload and restored network.");
}
