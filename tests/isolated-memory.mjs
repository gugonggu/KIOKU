import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { verifyReleaseMobile } from "./release-mobile.mjs";

const fixture = JSON.parse(process.env.KIOKU_LOCAL_SUPABASE || "{}");
const hosted = new URL(fixture.API_URL);
assert.ok(["127.0.0.1","localhost","[::1]"].includes(hosted.hostname), "Use an isolated local Supabase stack");
assert.ok(fixture.PUBLISHABLE_KEY?.startsWith("sb_publishable_") && fixture.SECRET_KEY?.startsWith("sb_secret_"));
const port = Number(process.env.KIOKU_MEMORY_TEST_PORT ?? "5331");
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
const app = "http://127.0.0.1:" + port;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(hosted.href, fixture.SECRET_KEY, options);
const must = (result, label) => {
  assert.equal(result.error?.code ?? result.error?.name, undefined, label);
  return result.data;
};

async function user() {
  const email = "memory-fixture-" + randomUUID() + "@example.test";
  const password = randomUUID() + "-A1!";
  must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create local fixture");
  const client = createClient(hosted.href, fixture.PUBLISHABLE_KEY, options);
  must(await client.auth.signInWithPassword({ email, password }), "sign in local fixture");
  return { email, client };
}

async function enter(page, email) {
  const { properties } = must(await admin.auth.admin.generateLink({ type: "magiclink", email }), "local magic link");
  const target = new URL("/auth/confirm", app);
  target.search = new URLSearchParams({ type: "email", token_hash: properties.hashed_token });
  await page.goto(target.href).catch(() => { throw new Error("Local fixture sign-in navigation failed"); });
  await expect(page).toHaveURL(/\/trips$/);
}

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, APP_URL: app, SUPABASE_URL: hosted.origin, SUPABASE_PUBLISHABLE_KEY: fixture.PUBLISHABLE_KEY,
    SUPABASE_STORAGE_SECRET_KEY: fixture.SECRET_KEY, GEOAPIFY_API_KEY: "",
    KIOKU_SHARE_ENCRYPTION_KEY: randomBytes(32).toString("base64url") },
  stdio: "ignore",
  windowsHide: true,
});
const stopped = once(child, "exit");
let browser;
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (child.exitCode !== null) throw new Error("Local Next start failed");
    if (await fetch(app + "/login").then((response) => response.ok).catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const owner = await user();
  const visitor = await user();
  const tripId = randomUUID();
  must(await owner.client.from("trips").insert({ id: tripId, title: "가상 삿포로 기억 수첩", destination_label: "札幌",
    traveler_count: 3, start_date: "2027-02-17", end_date: "2027-02-21" }), "five-day fixture");
  const dates = ["삿포로 시내", "비에이 가상 전망대", "오타루 운하", "유동적인 Day 4", "귀국"];
  const planned = dates.map((title, index) => ({ title, local_date: "2027-02-" + (17 + index),
    time_mode: "UNSCHEDULED", fixed_local_time: null, period: null }));
  const imported = must(await owner.client.rpc("import_trip_schedule", { p_trip: tripId, p_version: 1, p_rows: planned }), "five-day import");
  assert.deepEqual(imported, { inserted: 5, skipped: 0 });
  const placeId = randomUUID();
  must(await owner.client.from("trip_places").insert({ id: placeId, trip_id: tripId, display_name: "가상 운하 위치",
    address_ja: "北海道小樽市", latitude: 43.1, longitude: 141.0, provider: "MANUAL" }), "saved place");
  const visit = must(await owner.client.from("itinerary_items").select("id,revision").eq("trip_id", tripId)
    .eq("title", dates[2]).single(), "saved itinerary");
  assert.equal(must(await owner.client.rpc("save_itinerary_item", { p_trip: tripId, p_item: visit.id,
    p_revision: visit.revision, p_trip_version: 1,
    p_fields: { ...planned[2], kind: "PLACE", place_id: placeId, private_note: null, shared_note: null },
  }), "link place"), "saved");
  const bookings = [
    { kind: "STAY", title: "가상 Sapporo Hotel by Granbell", status: "CONFIRMED", detail: {
      check_in_local_date: "2027-02-17", check_out_local_date: "2027-02-21",
    }, private: { amount: 11000, currency: "JPY" } },
    { kind: "FLIGHT", title: "가상 귀국 일정", status: "NEEDS_BOOKING", detail: [
      { departure_airport: "CTS", departure_local_date: "2027-02-21" },
    ] },
    { kind: "TOUR", title: "가상 비에이 투어", status: "PENDING", detail: { event_local_date: "2027-02-18" } },
  ];
  for (const booking of bookings) {
    must(await owner.client.rpc("save_booking", { p_trip: tripId, p_id: randomUUID(), p_version: null, p_fields: booking }), "sample bookings");
  }
  const path = "/trips/" + tripId;
  const date = "2027-02-20";
  if (process.env.KIOKU_RELEASE_MOBILE === "1") {
    await verifyReleaseMobile({ app, path, tripId, signIn: (page) => enter(page, owner.email) });
  } else {
    await verifyMemory({ owner, visitor, path, tripId, date });
  }
} finally {
  await browser?.close();
  if (child.exitCode === null) child.kill();
  await stopped;
}

async function verifyMemory({ owner, visitor, path, tripId, date }) {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  const context = await browser.newContext({ baseURL: app, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await enter(page, owner.email);
  await page.goto(path + "/preparation");
  await page.getByText("여행 준비 템플릿", { exact: true }).click();
  await page.getByRole("button", { name: "겨울 여행 템플릿" }).click();
  await page.getByRole("button", { name: "방한복 완료", exact: true }).click();
  await page.goto(path + "/budget");
  await page.getByLabel("총예산 (원)").fill("500000");
  await page.getByLabel("기본 환율 (1엔당 원)").fill("9.1234");
  await page.getByLabel("정산 별칭 (한 줄에 한 명)").fill("가\n나\n다");
  await page.getByRole("button", { name: "예산 저장" }).click();
  const expense = page.locator("#new-expense");
  await expense.getByLabel("지출명").fill("가상 사전 결제 내역");
  await expense.getByLabel("결제 시점").selectOption("prepaid");
  await expense.getByLabel("연결 예약").selectOption({ label: "가상 Sapporo Hotel by Granbell · 예약 완료" });
  await expense.getByLabel("선택한 예약의 금액과 통화로 기록").check();
  await expense.getByRole("button", { name: "지출 등록" }).click();
  await expect(page.getByText("나 → 가 · 33,452원")).toBeVisible();
  await page.goto(path + "/memory?date=" + date + "&write=1");
  await page.getByLabel("일기 제목").fill("시험용 겨울 일기");
  await page.getByLabel("일기 본문").fill("오프라인과 가이드에서 숨길 가상 내용");
  await page.getByRole("button", { name: "일기 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "시험용 겨울 일기" })).toBeVisible();

  async function upload(title, bytes) {
    await page.locator("#add-photo summary").click();
    await page.getByLabel("사진 파일").setInputFiles({ name: "fixture.jpg", mimeType: "image/jpeg", buffer: bytes });
    await page.getByLabel("사진 제목").fill(title);
    await page.getByLabel("연결 일기").selectOption({ label: date + " · 시험용 겨울 일기" });
    await page.getByRole("button", { name: "사진 저장", exact: true }).click();
  }
  await upload("잘못된 사진", Buffer.from("invalid test bytes"));
  await expect(page.locator("#add-photo").getByRole("alert")).toContainText("3.8MB");
  await page.goto(path + "/memory?date=" + date);
  const jpg = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#768677" } })
    .withExif({ IFD0: { Artist: "TEST_GPS_REMOVAL" }, IFD3: { GPSLatitudeRef: "N" } }).jpeg().toBuffer();
  await upload("가상 사진 한 장", jpg);
  const photo = page.getByRole("img", { name: "가상 사진 한 장", exact: true });
  await expect(photo).toBeVisible();
  const imagePath = await photo.getAttribute("src");
  assert.ok(imagePath?.startsWith("/api/memory/"));
  const asset = await page.request.get(imagePath);
  assert.equal(asset.status(), 200);
  assert.match(asset.headers()["cache-control"], /private, no-store/);
  const meta = await sharp(await asset.body()).metadata();
  assert.equal(meta.width, 1440);
  assert.equal(meta.exif, undefined);
  const filename = tripId + "/" + imagePath.split("/").at(-1) + ".jpg";
  assert.ok((await visitor.client.storage.from("trip-memory").download(filename)).error);
  assert.ok((await owner.client.storage.from("trip-memory").upload(tripId + "/unsigned.jpg", jpg)).error);
  const otherContext = await browser.newContext({ baseURL: app });
  assert.equal((await otherContext.request.get(imagePath)).status(), 401);
  await enter(await otherContext.newPage(), visitor.email);
  assert.equal((await otherContext.request.get(imagePath)).status(), 404);
  const privateMemo = "오프라인과 가이드에서 숨길 가상 내용";
  assert.ok(!(await (await page.request.get("/api/offline/" + tripId)).text()).includes(privateMemo));
  assert.ok(!(await (await page.request.get(path + "/guide")).text()).includes(privateMemo));

  const gallery = page.locator(".memory-card").filter({ hasText: "가상 사진 한 장" });
  await gallery.getByText("사진 관리", { exact: true }).click();
  await gallery.getByRole("button", { name: "대표 사진으로" }).click();
  await expect(gallery.getByText("· 대표 사진", { exact: true })).toBeVisible();
  await page.goto(path);
  await expect(page.getByRole("img", { name: "가상 사진 한 장" })).toBeVisible();
  await page.goto(path + "/offline");
  await page.getByRole("button", { name: "오프라인 수첩 저장" }).click();
  await expect(page.getByText("이 기기에 수첩을 저장했어요.")).toBeVisible();
  await context.setOffline(true);
  await page.goto("/offline.html?trip=" + tripId);
  await expect(page.getByText(/오타루 운하/)).toBeVisible();
  await expect(page.getByText(/가상 운하 위치/).first()).toBeVisible();
  await expect(page.getByText(privateMemo)).toHaveCount(0);
  await context.setOffline(false);
  await page.goto(path + "/guide");
  await expect(page.getByText(/가상 Sapporo Hotel by Granbell/)).toBeVisible();
  assert.equal((await page.pdf({ preferCSSPageSize: true })).subarray(0, 5).toString(), "%PDF-");
  await page.goto(path + "/memory?date=" + date);
  await gallery.getByText("사진 관리", { exact: true }).click();
  page.once("dialog", (dialog) => { void dialog.accept(); });
  await gallery.getByRole("button", { name: "사진 삭제" }).click();
  await expect(gallery).toHaveCount(0);
  assert.equal((await page.request.get(imagePath)).status(), 404);
  assert.ok((await admin.storage.from("trip-memory").download(filename)).error);
  console.log("Isolated Supabase + Chrome passed: five days, prep, bookings, settlement, offline, A4 PDF and private memory photo.");
}
