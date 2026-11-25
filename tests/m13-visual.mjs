import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { parseTripImport } from "../src/lib/trip-import.ts";

const samples = new URL("../examples/sapporo-2027/", import.meta.url);
const sample = (name) => readFile(new URL(name + ".json", samples), "utf8");

export async function verifyM13Visual({ app, user, enter, must }) {
  const stage = process.env.KIOKU_M13_VISUAL;
  assert.ok(stage === "before" || stage === "after");
  const directory = join(process.env.KIOKU_M13_ARTIFACTS ?? "artifacts/test-results/m13", stage);
  await mkdir(directory, { recursive: true });
  const { email, client } = await user();
  const trip = { id: randomUUID(), title: "가상 삿포로 겨울 수첩", destination_label: "北海道 · 札幌 · 小樽",
    traveler_count: 3, start_date: "2027-02-10", end_date: "2027-02-14" };
  const empty = randomUUID();
  must(await client.from("trips").insert([trip, { id: empty, title: "빈 여행 수첩", destination_label: "일본", traveler_count: 1 }]), "create synthetic trips");
  const imported = parseTripImport(await sample("itinerary"));
  assert.ok("rows" in imported, "public itinerary parses successfully");
  assert.deepEqual(must(await client.rpc("import_trip_schedule", {
    p_trip: trip.id, p_version: 1, p_rows: imported.rows,
  }), "import sample"), { inserted: 27, skipped: 0 });
  let editId;
  for (const place of JSON.parse(await sample("places"))) {
    const id = randomUUID();
    must(await client.from("trip_places").insert({ id, trip_id: trip.id, display_name: place.name, name_ja: place.nameJa,
      latitude: place.latitude, longitude: place.longitude, provider: "MANUAL" }), "create fixture place");
    if (!place.schedule) continue;
    const row = imported.rows.find(({ title }) => title === place.schedule);
    const item = must(await client.from("itinerary_items").select("id,revision").eq("trip_id", trip.id)
      .eq("title", row.title).single(), "find imported item");
    editId = item.id;
    assert.equal(must(await client.rpc("save_itinerary_item", { p_trip: trip.id, p_item: item.id, p_revision: item.revision,
      p_trip_version: 1, p_fields: { ...row, kind: "PLACE", place_id: id, private_note: null, shared_note: null },
    }), "link fixture place"), "saved");
  }
  for (const booking of JSON.parse(await sample("bookings"))) {
    must(await client.rpc("save_booking", {
      p_trip: trip.id, p_id: randomUUID(), p_version: null, p_fields: booking,
    }), "create fixture booking");
  }
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const owner = await browser.newPage({ baseURL: app, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const guest = await browser.newPage({ baseURL: app, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    owner.setDefaultTimeout(8000);
    const path = "/trips/" + trip.id;
    const memory = path + "/memory?date=2027-02-12";
    await enter(owner, email);
    await owner.goto(path + "/preparation");
    await owner.getByText("여행 준비 템플릿", { exact: true }).click();
    await owner.getByRole("button", { name: "겨울 여행 템플릿" }).click();
    await owner.getByRole("button", { name: "방한복 완료", exact: true }).click();
    await owner.goto(path + "/budget");
    await owner.getByLabel("총예산 (원)").fill("500000");
    await owner.getByLabel("기본 환율 (1엔당 원)").fill("9.5");
    await owner.getByRole("button", { name: "예산 저장" }).click();
    await owner.goto(memory + "&write=1");
    await owner.getByLabel("일기 제목").fill("눈이 내리던 가상의 오후");
    await owner.getByLabel("일기 본문").fill("운하 옆 골목을 천천히 걷고 따뜻한 차를 마셨다.");
    await owner.getByRole("button", { name: "일기 저장", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "눈이 내리던 가상의 오후" })).toBeVisible();
    await owner.locator("#add-photo summary").click();
    await owner.getByLabel("사진 파일").setInputFiles("public/kioku-winter-cover.webp");
    await owner.getByLabel("사진 제목").fill("가상 여행 표지");
    await owner.getByRole("button", { name: "사진 저장", exact: true }).click();
    await expect(owner.getByText("가상 여행 표지", { exact: true }).first()).toBeVisible();
    await owner.goto(path + "/share");
    await owner.getByRole("button", { name: "링크 공유 켜기" }).click();
    await expect(owner.getByRole("button", { name: "링크 확인" })).toBeVisible();
    await owner.getByRole("button", { name: "링크 확인" }).click();
    const share = owner.getByRole("textbox", { name: "공유 링크" });
    await expect(share).toBeVisible();
    const guestPath = new URL(await share.inputValue()).pathname;
    assert.ok(guestPath.startsWith("/s/"));
    await owner.goto(path + "/offline");
    await owner.getByRole("button", { name: /저장|기기에/ }).first().click();
    const offlineLink = owner.locator('a[href*="/offline.html"]').first();
    await expect(offlineLink).toBeVisible();
    const offlinePath = await offlineLink.getAttribute("href");
    const routes = [
      ["login", "/login", guest], ["trips", "/trips"], ["new", "/trips/new"],
      ["home", path], ["itinerary", path + "/itinerary?view=all"], ["day", path + "/itinerary?date=2027-02-12"],
      ["add", path + "/itinerary?date=2027-02-12&mode=add"], ["edit", path + "/itinerary?date=2027-02-12&mode=edit&id=" + editId],
      ["import", path + "/itinerary/import"], ["places", path + "/map"], ["map", path + "/map", owner, "map"],
      ["bookings", path + "/bookings"], ["preparation", path + "/preparation"], ["budget", path + "/budget"],
      ["memory", memory], ["album", memory + "#memory-timeline"], ["share", path + "/share"],
      ["companion", guestPath, guest], ["guide", path + "/guide"], ["more", path + "/more"],
      ["offline", offlinePath], ["empty", "/trips/" + empty],
    ];
    const metrics = [];
    for (const width of [390, 1440, 360, 430, 768]) {
      for (const [name, href, page = owner, interaction] of routes) {
        await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
        const response = await page.goto(href, { waitUntil: "domcontentloaded" });
        assert.ok(response?.ok() || (name === "album" && response === null), name + " rendered");
        await page.locator("main").first().waitFor({ state: "visible" });
        if (name === "offline") await page.getByText(/시계탑에서 만남/).first().waitFor();
        if (name === "home" && await page.getByText("최신 여부 확인 중…", { exact: false }).count()) {
          await page.getByText("최신 여부 확인 중…", { exact: false }).waitFor({ state: "hidden" });
        }
        if (interaction === "map" && width < 840) await page.getByRole("button", { name: "지도", exact: true }).click();
        if (name === "map") {
          await page.getByRole("button", { name: "지도 핀: 가상 시계탑" }).waitFor({ timeout: 12000 });
          if (stage === "after" && width < 840) {
            await expect(page.getByRole("link", { name: "날짜별", exact: true })).toBeVisible();
          }
        }
        if (name === "itinerary" && stage === "after") {
          await expect(page.getByRole("heading", { name: "전체 일정" })).toBeVisible();
          await expect(page.getByRole("link", { name: /Day 3.*일정/ })).toBeVisible();
        }
        await page.screenshot({ path: directory + "/" + width + "-" + name + ".png" });
        if (name === "home" && (width === 390 || width === 1440)) {
          await page.screenshot({ path: directory + "/" + width + "-home-full.png", fullPage: true });
        }
        const measure = await page.evaluate(() => ({
          overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          domMs: Math.round(performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? 0),
        }));
        metrics.push({ width, name, ...measure });
        if (stage === "after") assert.equal(measure.overflow, 0, width + " " + name + " has horizontal page overflow");
      }
      console.log(stage + " " + width + ": " + routes.length + " rendered screens");
    }
    if (stage === "after") {
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.goto(path + "/itinerary?view=all");
      await owner.getByRole("link", { name: /Day 3.*일정/ }).click();
      await expect(owner.getByRole("link", { name: "2027. 2. 12.", exact: true })).toHaveAccessibleDescription(/일정 \d+개/);
      await owner.getByRole("link", { name: "후보함", exact: true }).click();
      await owner.getByRole("link", { name: "전체 일정", exact: true }).click();
      await expect(owner.getByRole("heading", { name: "전체 일정" })).toBeVisible();
      await owner.goto(path + "/map?view=map");
      await owner.getByRole("link", { name: "날짜별", exact: true }).click();
      await expect(owner.getByRole("button", { name: "지도", exact: true })).toHaveAttribute("aria-pressed", "true");
      if (process.env.KIOKU_V11_VISUAL) {
        await owner.goto(path + "/map?view=map&filter=date&date=2027-02-12&route=1");
        const route = owner.getByRole("region", { name: "날짜별 방문 순서" });
        await route.waitFor();
        await owner.getByRole("button", { name: "지도 핀: 가상 운하" }).waitFor({ timeout: 12000 });
        await owner.getByText("지도를 불러오는 중이에요.", { exact: true }).waitFor({ state: "hidden" });
        await route.scrollIntoViewIfNeeded();
        await owner.screenshot({ path: directory + "/390-route.png" });
        await owner.goto(path + "/budget");
        await owner.locator("#new-expense").screenshot({ path: directory + "/390-quick-expense.png" });
        await owner.goto(path + "/map?view=map&filter=date&date=2027-02-12");
      }
      await owner.getByRole("navigation", { name: "표시할 장소" }).getByRole("link", { name: "후보 장소" }).click();
      await expect(owner.getByRole("button", { name: "지도", exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await owner.context().setOffline(true);
    await owner.goto(offlinePath);
    await expect(owner.getByText(/시계탑에서 만남/).first()).toBeVisible();
    await owner.context().setOffline(false);
    await writeFile(directory + "/metrics.json", JSON.stringify(metrics, null, 2) + "\n");
  } finally {
    await browser.close();
  }
}
