import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chromium, expect, test } from "@playwright/test";
import { e2eHost, e2ePorts, e2eUrls } from "./support/e2e-ports";
import { handlePlanRequest } from "./support/plan-provider";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";

const { configured: appUrl, provider: providerUrl } = e2eUrls;
const testEmail = "traveler@example.test";
let provider: Server;
let releaseEmailRequest: (() => void) | undefined;
let database: Awaited<ReturnType<typeof createTripsDatabase>>;
let failNextTripRead = false;
let pkceChallenge: string | undefined;
let googleSignupDisabled = true;
let googleChallenge: string | undefined;
let refreshedGoogleSession = false;

test.beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  // A restarted worker has a new signing key while the app's JWKS cache may still be warm.
  const kid = randomUUID();
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedTokens = new Map<string, string>();
  const savedWithLostReply = new Set<string>();
  const failedItinerarySaves = new Set<string>();
  database = await createTripsDatabase();

  provider = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", providerUrl);
    const send = (status: number, payload: object | boolean | string | null) => {
      response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
    };
    const readJson = async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    };
    const sendSession = (user: { id: string; email: string }, google = false, expired = false) => {
      const payload = encode({
        sub: user.id, aud: "authenticated", role: "authenticated", aal: "aal1",
        exp: Math.floor(Date.now() / 1000) + (expired ? -10 : 3600), iss: `${providerUrl}/auth/v1`,
      });
      const unsigned = `${encode({ alg: "ES256", kid })}.${payload}`;
      const signature = sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" });
      const accessToken = `${unsigned}.${signature.toString("base64url")}`;
      issuedTokens.set(accessToken, user.id);
      return send(200, {
        access_token: accessToken,
        refresh_token: google ? "fixture-google-refresh" : "fixture-refresh",
        expires_in: expired ? 1 : 3600, token_type: "bearer", user,
      });
    };

    if (url.pathname === "/auth/v1/settings") {
      return send(200, { disable_signup: googleSignupDisabled, external: { google: true } });
    }

    if (url.pathname === "/auth/v1/authorize") {
      const callback = url.searchParams.get("redirect_to");
      const challenge = url.searchParams.get("code_challenge");
      if (url.searchParams.get("provider") !== "google" || callback !== `${appUrl}/auth/confirm?flow=google` ||
          url.searchParams.get("code_challenge_method")?.toLowerCase() !== "s256" || !challenge) {
        return send(400, { message: "fixture OAuth arguments did not match" });
      }
      googleChallenge = challenge;
      return response.writeHead(302, { Location: `${callback}&code=fixture-google-code&next=https://example.test` }).end();
    }

    if (request.method === "POST" && url.pathname === "/auth/v1/otp") {
      const { email, create_user, code_challenge, code_challenge_method } = await readJson();
      if (email === "busy@example.test") {
        return send(429, { code: "over_email_send_rate_limit", message: "fixture rate limit" });
      }
      if (create_user !== false || url.searchParams.get("redirect_to") !== `${appUrl}/auth/confirm`) {
        return send(400, { code: "unexpected_request", message: "fixture argument mismatch" });
      }
      if (email === "wait@example.test") {
        await new Promise<void>((resolve) => {
          releaseEmailRequest = resolve;
        });
      } else if (email === "pkce@example.test" && code_challenge && code_challenge_method === "s256") {
        pkceChallenge = code_challenge;
      } else if (email !== testEmail) {
        return send(400, { code: "unexpected_request", message: "fixture address mismatch" });
      }
      return send(200, {});
    }

    if (request.method === "POST" && url.pathname === "/auth/v1/verify") {
      const { token_hash, type } = await readJson();
      if (!["local-fixture-link", "local-fixture-second"].includes(token_hash) || type !== "email") {
        return send(403, { code: "otp_expired", message: "fixture expired link" });
      }
      const user = token_hash === "local-fixture-link"
        ? { id: ownerA, email: testEmail }
        : { id: ownerB, email: "second@example.test" };
      return sendSession(user);
    }

    if (request.method === "POST" && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      const { auth_code, code_verifier } = await readJson();
      const challenge = typeof code_verifier === "string" && createHash("sha256").update(code_verifier).digest("base64url");
      if (auth_code === "fixture-google-code" && googleChallenge && challenge === googleChallenge) {
        googleChallenge = undefined;
        return sendSession({ id: ownerA, email: testEmail }, true, true);
      }
      if (auth_code !== "fixture-issued-code" || !pkceChallenge || challenge !== pkceChallenge) {
        return send(400, { code: "bad_code_verifier", message: "fixture invalid or consumed code" });
      }
      pkceChallenge = undefined;
      return sendSession({ id: ownerA, email: "pkce@example.test" });
    }

    if (request.method === "POST" && url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "refresh_token") {
      if ((await readJson()).refresh_token !== "fixture-google-refresh") return send(400, { message: "invalid fixture refresh" });
      refreshedGoogleSession = true;
      return sendSession({ id: ownerA, email: testEmail }, true);
    }

    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      return send(200, { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" }] });
    }

    if (request.method === "POST" && url.pathname === "/auth/v1/logout" && url.searchParams.get("scope") === "local") {
      return response.writeHead(204).end();
    }

    if (url.pathname === "/rest/v1/trips") {
      const userId = issuedTokens.get(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
      if (!userId) return send(401, { message: "fixture session required" });
      const filters = ["owner_id", "id", "content_version"].map((key) => url.searchParams.get(key)?.match(/^eq\.(.+)$/)?.[1] ?? null);
      const [owner, id, version] = filters;
      if (request.method !== "POST" && (owner !== userId || (request.method !== "GET" && (!id || !version)))) {
        return send(400, { message: "fixture owner or revision filter missing" });
      }
      const where = "where owner_id = $1 and ($2::uuid is null or id = $2) and ($3::integer is null or content_version = $3)";
      try {
        if (request.method === "GET") {
          if (failNextTripRead) {
            failNextTripRead = false;
            return send(400, { message: "fixture data unavailable" });
          }
          const result = await asUser(database, userId, (tx) => tx.query(
            `select id, title, destination_label, start_date::text, end_date::text, traveler_count, content_version, created_at
             from public.trips ${where} order by created_at desc, id`, filters,
          ));
          return send(200, result.rows);
        }
        if (request.method === "POST" || request.method === "PATCH") {
          const body = await readJson();
          const fields = [body.title, body.destination_label, body.start_date, body.end_date, body.traveler_count];
          if (request.method === "POST") {
            if (url.searchParams.get("on_conflict") !== "id" || !request.headers.prefer?.includes("resolution=ignore-duplicates")) {
              return send(400, { message: "fixture idempotency preference missing" });
            }
            await asUser(database, userId, (tx) => tx.query(
              "insert into public.trips (id, title, destination_label, start_date, end_date, traveler_count) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing",
              [body.id, ...fields],
            ));
            if (["저장 응답 재시도", "내용을 바꾼 재시도"].includes(body.title) && !savedWithLostReply.has(body.id)) {
              savedWithLostReply.add(body.id);
              return send(400, { message: "fixture lost save response" });
            }
            return response.writeHead(201).end();
          }
          const result = await asUser(database, userId, (tx) => tx.query(
            `update public.trips set title = $4, destination_label = $5, start_date = $6, end_date = $7, traveler_count = $8 ${where} returning id`,
            [...filters, ...fields],
          ));
          return send(200, result.rows);
        }
        if (request.method === "DELETE") {
          const result = await asUser(database, userId, (tx) => tx.query(`delete from public.trips ${where} returning id`, filters));
          return send(200, result.rows);
        }
      } catch {
        return send(400, { message: "fixture database request failed" });
      }
    }

    if (["/rest/v1/itinerary_items", "/rest/v1/trip_places", "/rest/v1/bookings", "/rest/v1/flight_segments",
      "/rest/v1/stay_details", "/rest/v1/tour_details", "/rest/v1/booking_private_details",
      "/rest/v1/rpc/read_shared_trip", "/rest/v1/rpc/read_share_settings", "/rest/v1/rpc/write_share_settings",
      "/rest/v1/rpc/save_booking", "/rest/v1/rpc/delete_booking", "/rest/v1/rpc/save_trip_place", "/rest/v1/rpc/delete_trip_place",
      "/rest/v1/rpc/authorize_place_search", "/rest/v1/rpc/save_itinerary_item", "/rest/v1/rpc/update_trip_period",
      "/rest/v1/rpc/swap_itinerary_items", "/rest/v1/rpc/place_itinerary_item"].includes(url.pathname)) {
      const userId = issuedTokens.get(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
      try {
        return await handlePlanRequest({ database, userId, method: request.method, url, readJson, send, failedSaves: failedItinerarySaves });
      } catch {
        return send(400, { message: "fixture plan request failed" });
      }
    }
    return send(404, { code: "not_found", message: "fixture route not found" });
  });

  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject).listen(e2ePorts.provider, e2eHost, resolve);
  });
});

test.beforeEach(async () => {
  failNextTripRead = false;
  pkceChallenge = undefined;
  await database.exec("truncate table public.booking_private_details, public.flight_segments, public.stay_details, public.tour_details, " +
    "kioku_private.trip_share_links, public.bookings, public.itinerary_items, public.trip_places, public.trips");
});

test.afterAll(async () => {
  releaseEmailRequest?.();
  provider?.closeAllConnections();
  await new Promise<void>((resolve) => {
    if (provider?.listening) provider.close(() => resolve());
    else resolve();
  });
  await database?.close();
});

test("a visitor is denied a configured protected route without a verified session", async ({ request }) => {
  const response = await request.get("/trips/new", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("/login");
});

test("Google PKCE keeps the existing owner session after refresh and browser restart", async ({}, testInfo) => {
  const tripId = randomUUID();
  const title = "Google 연결 전부터 있던 여행";
  const profile = testInfo.outputPath("chrome-profile");
  const options = { baseURL: appUrl, channel: process.env.PLAYWRIGHT_CHANNEL };
  const signIn = await chromium.launchPersistentContext(profile, options);
  try {
    await asUser(database, ownerA, (tx) => tx.query(
      "insert into public.trips (id, title, destination_label) values ($1, $2, '삿포로')", [tripId, title],
    ));
    try {
      const page = signIn.pages()[0];
      await page.goto("/trips");
      await page.getByRole("button", { name: "Google로 계속하기" }).click();
      await expect(page).toHaveURL(/\/trips$/);
      await expect(page.getByRole("link", { name: title })).toBeVisible();
      expect(refreshedGoogleSession).toBe(true);
      const session = (await signIn.cookies()).find((cookie) => cookie.name.endsWith("-auth-token"));
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe("Lax");
      expect(session?.expires).toBeGreaterThan(Date.now() / 1000);
      await page.reload();
      await expect(page.getByRole("link", { name: title })).toBeVisible();
    } finally {
      await signIn.close();
    }

    const reopened = await chromium.launchPersistentContext(profile, options);
    try {
      const page = reopened.pages()[0];
      await page.goto("/login");
      await expect(page).toHaveURL(/\/trips$/);
      await expect(page.getByRole("link", { name: title })).toBeVisible();
      await page.getByRole("button", { name: "로그아웃" }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/trips");
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await reopened.close();
    }
  } finally {
    await asUser(database, ownerA, (tx) => tx.query("delete from public.trips where id = $1", [tripId]));
  }
});

test("Google sign-in respects the closed signup policy and shows safe callback errors", async ({ page }) => {
  googleSignupDisabled = false;
  try {
    await page.goto("/login");
    await page.getByRole("button", { name: "Google로 계속하기" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("이메일 로그인 링크");
  } finally {
    googleSignupDisabled = true;
  }
  await page.goto("/auth/confirm?flow=google&error_code=signup_disabled&error_description=fixture-private&next=https://example.test");
  await expect(page).toHaveURL(/\/login\?notice=google-account$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("등록한 이메일과 같은 Google 계정");
  await expect(page.locator("body")).not.toContainText("fixture-private");
});

test("the login form shows a recoverable error and then acknowledges a request", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/login");
  const email = page.getByLabel("이메일 주소");
  await email.fill("busy@example.test");
  await page.getByRole("button", { name: "로그인 링크 받기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("잠시 기다린 뒤");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await email.fill(testEmail);
  await page.getByRole("button", { name: "로그인 링크 받기" }).click();
  await expect(page.getByRole("status")).toContainText("받은편지함");
  await expect(page.getByRole("button", { name: "로그인 링크 다시 받기" })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("sb_publishable_e2e_fixture");
});

test("an expired test link shows a retry prompt", async ({ page }) => {
  await page.goto("/auth/confirm?type=email&token_hash=expired-fixture");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("새 로그인 링크를 요청해 주세요");
});

test("a default-template PKCE code requires the request browser and works only once", async ({ page, context, browser }) => {
  await page.goto("/login");
  await page.getByLabel("이메일 주소").fill("pkce@example.test");
  await page.getByRole("button", { name: "로그인 링크 받기" }).click();
  await expect(page.getByRole("status")).toContainText("받은편지함");

  const callback = `${appUrl}/auth/confirm?code=fixture-issued-code`;
  const otherBrowser = await browser.newContext();
  try {
    const wrongBrowser = await otherBrowser.request.get(callback, { maxRedirects: 0 });
    expect(wrongBrowser.headers().location).toBe("/login?notice=link");
  } finally {
    await otherBrowser.close();
  }

  await page.goto(callback);
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByRole("heading", { name: "내 여행" })).toBeVisible();
  const repeated = await context.request.get(callback, { maxRedirects: 0 });
  expect(repeated.headers().location).toBe("/login?notice=link");
});

test("an email link consumed before the callback guides the visitor to request a new link", async ({ page }) => {
  await page.goto("/auth/confirm#error_code=otp_expired");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("링크를 요청한 브라우저에서");
  await page.getByLabel("이메일 주소").fill("pkce@example.test");
  await page.getByRole("button", { name: "로그인 링크 받기" }).click();
  await expect(page.getByRole("status")).toContainText("받은편지함");
});

test("sending a link announces the pending state and prevents a second submission on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/login");
  await page.getByLabel("이메일 주소").fill("wait@example.test");
  await page.getByRole("button", { name: "로그인 링크 받기" }).click();

  try {
    await expect.poll(() => Boolean(releaseEmailRequest)).toBe(true);
    await expect(page.getByRole("button", { name: "보내는 중…" })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText("이메일 전송 중");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    releaseEmailRequest?.();
    releaseEmailRequest = undefined;
  }
  await expect(page.getByRole("button", { name: "로그인 링크 다시 받기" })).toBeEnabled();
});

test("a verified link opens the responsive trip shell and logout removes access", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const response = await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  expect(response?.headers()["cache-control"]).toMatch(/no-store/);
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByText("아직 등록된 여행이 없어요.")).toBeVisible();

  const session = (await context.cookies()).find((cookie) => cookie.name.endsWith("-auth-token"));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const menu = page.getByRole("navigation", { name: "여행 메뉴" });
  const newTrip = menu.getByRole("link", { name: "새 여행" });
  expect((await newTrip.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await newTrip.click();
  await expect(page.getByRole("heading", { name: "새 여행 만들기" })).toBeVisible();
  await expect(newTrip).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("여행 이름")).toBeVisible();
  await expect(page.getByRole("button", { name: "여행 만들기" })).toBeEnabled();

  await page.setViewportSize({ width: 1440, height: 900 });
  const sidebar = await menu.boundingBox();
  const main = await page.getByRole("main").boundingBox();
  expect(sidebar).not.toBeNull();
  expect(main).not.toBeNull();
  expect(sidebar!.x + sidebar!.width).toBeLessThan(main!.x);

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/trips");
  await expect(page).toHaveURL(/\/login$/);
});

test("an owner creates a trip with no dates, edits it and confirms deletion on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.getByRole("link", { name: "첫 여행 만들기" }).click();
  await page.getByLabel("여행 이름").fill("봄빛 여행");
  await page.getByLabel("목적지").fill("교토");
  await page.getByLabel("출발일").fill("2027-03-20");
  await page.getByRole("button", { name: "여행 만들기" }).click();
  await expect(page.getByText("출발일과 돌아오는 날을 모두 입력해 주세요.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByLabel("여행 이름")).toHaveValue("봄빛 여행");
  await page.getByLabel("출발일").fill("");
  await page.getByRole("button", { name: "여행 만들기" }).click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]{36}$/);
  await expect(page.getByRole("heading", { name: "봄빛 여행" })).toBeVisible();
  await expect(page.getByRole("img", { name: "산 풍경의 기본 여행 표지" })).toBeVisible();
  await expect(page.getByText("날짜 미정", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  if (process.env.KIOKU_UI_SCREENSHOTS) await page.screenshot({ path: `${process.env.KIOKU_UI_SCREENSHOTS}/home-default-cover-320.png`, animations: "disabled" });

  await page.getByRole("link", { name: "날짜 정하기" }).click();
  await page.getByLabel("여행 이름").fill("봄빛 당일치기");
  await page.getByLabel("출발일").fill("2027-03-20");
  await page.getByLabel("돌아오는 날").fill("2027-03-20");
  await page.getByLabel("여행 인원").fill("2");
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(page.getByRole("heading", { name: "봄빛 당일치기" })).toBeVisible();
  await expect(page.getByText("당일치기", { exact: true })).toBeVisible();
  await expect(page.getByText("2명", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "여행 삭제" }).click();
  await expect(page.getByText("삭제한 여행은 되돌릴 수 없어요.")).toBeVisible();
  await page.getByRole("link", { name: "취소" }).click();
  await expect(page.getByRole("heading", { name: "봄빛 당일치기" })).toBeVisible();
  await page.getByRole("link", { name: "여행 삭제" }).click();
  await page.getByRole("button", { name: "여행 삭제" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByText("아직 등록된 여행이 없어요.")).toBeVisible();
});

test("retry keeps one travel record, and another owner cannot open the trip or its management routes", async ({ page, browser }) => {
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto("/trips/new");
  await page.getByLabel("여행 이름").fill("저장 응답 재시도");
  await page.getByLabel("목적지").fill("도쿄");
  await page.getByRole("button", { name: "여행 만들기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("저장하지 못했어요");
  await expect(page.getByLabel("여행 이름")).toHaveValue("저장 응답 재시도");
  await page.getByRole("button", { name: "여행 만들기" }).click();
  await expect(page.getByRole("heading", { name: "저장 응답 재시도" })).toBeVisible();
  const tripUrl = page.url();
  await page.goto("/trips");
  await expect(page.getByRole("link", { name: /저장 응답 재시도/ })).toHaveCount(1);

  const visitor = await browser.newPage();
  try {
    await visitor.goto(`${new URL(tripUrl).origin}/auth/confirm?type=email&token_hash=local-fixture-second`);
    await expect(visitor.getByText("아직 등록된 여행이 없어요.")).toBeVisible();
    for (const suffix of ["", "/edit", "/delete"]) {
      await visitor.goto(tripUrl + suffix);
      await expect(visitor.getByRole("heading", { name: "여행을 찾을 수 없어요" })).toBeVisible();
      await expect(visitor.getByText("저장 응답 재시도")).toHaveCount(0);
    }
  } finally {
    await visitor.close();
  }
});

test("an older editing tab cannot overwrite a more recent save", async ({ page, context }) => {
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto("/trips/new");
  await page.getByLabel("여행 이름").fill("오래 열린 편집 양식");
  await page.getByLabel("목적지").fill("가나자와");
  await page.getByRole("button", { name: "여행 만들기" }).click();
  await expect(page.getByRole("heading", { name: "오래 열린 편집 양식" })).toBeVisible();
  await page.getByRole("link", { name: "여행 편집" }).click();
  await expect(page.getByRole("heading", { name: "여행 편집" })).toBeVisible();
  const stale = await context.newPage();
  try {
    await stale.goto(page.url());
    await stale.getByLabel("여행 이름").fill("이전 탭에서 수정");
    await page.getByLabel("여행 이름").fill("먼저 저장한 여행 이름");
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page.getByRole("heading", { name: "먼저 저장한 여행 이름" })).toBeVisible();

    await stale.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(stale.getByRole("main").getByRole("alert")).toContainText("여행 정보가 바뀌었거나");
    await expect(stale.getByLabel("여행 이름")).toHaveValue("이전 탭에서 수정");
    await stale.getByRole("link", { name: "최신 여행 정보 보기" }).click();
    await expect(stale.getByRole("heading", { name: "먼저 저장한 여행 이름" })).toBeVisible();
  } finally {
    await stale.close();
  }
});

test("a retry with changed fields explains that the original values were saved", async ({ page }) => {
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto("/trips/new");
  await page.getByLabel("여행 이름").fill("내용을 바꾼 재시도");
  await page.getByLabel("목적지").fill("도쿄");
  await page.getByRole("button", { name: "여행 만들기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("저장하지 못했어요");
  await page.getByLabel("목적지").fill("요코하마");
  await page.getByRole("button", { name: "여행 만들기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("첫 요청으로 여행이 이미 저장됐어요");
  await expect(page.getByLabel("목적지")).toHaveValue("요코하마");
  await page.getByRole("link", { name: "저장된 여행 보기" }).click();
  await expect(page.getByRole("heading", { name: "내용을 바꾼 재시도" })).toBeVisible();
  await expect(page.getByText("도쿄", { exact: true })).toBeVisible();
});

test("the list groups trips by Japan dates and can be reloaded after a data error", async ({ page }) => {
  await asUser(database, ownerB, (tx) => tx.query(`
    insert into public.trips (title, destination_label, start_date, end_date) values
      ('지금 떠난 여행', '고베', '2000-01-01', '2090-01-01'),
      ('다음 여행', '교토', '2090-01-02', '2090-01-04'),
      ('언젠가 떠날 여행', '하코다테', null, null),
      ('지난 여행', '나고야', '2000-01-01', '2000-01-02')
  `));
  failNextTripRead = true;
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-second");
  await expect(page.getByRole("heading", { name: "여행을 불러오지 못했어요" })).toBeVisible();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  for (const [group, title] of [
    ["여행 중", "지금 떠난 여행"],
    ["다가오는 여행", "다음 여행"],
    ["날짜 미정", "언젠가 떠날 여행"],
    ["지난 여행", "지난 여행"],
  ]) {
    await expect(page.getByRole("region", { name: group, exact: true }).getByRole("link", { name: title, exact: true })).toBeVisible();
  }
});

async function seedFiveDayTrip(title: string) {
  const { rows: [trip] } = await asUser(database, ownerA, (tx) => tx.query<{ id: string }>(`
    insert into public.trips (title,destination_label,start_date,end_date)
      values ($1,'홋카이도','2027-02-17','2027-02-21') returning id
  `, [title]));
  return `/trips/${trip.id}`;
}

test("M2 sorts five Japan travel days with three time modes on mobile and desktop", async ({ page }) => {
  const trip = await seedFiveDayTrip("겨울 여행");
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(trip);
  await page.getByRole("link", { name: "일정 보기" }).click();
  const calendar = page.getByRole("navigation", { name: "일정 날짜 이동" });
  await expect(calendar.getByRole("link", { name: /^2027/ })).toHaveCount(5);
  await expect(page.getByLabel("볼 날짜")).toBeHidden();
  await calendar.getByText("날짜 직접 이동").click();
  await expect(page.getByLabel("볼 날짜")).toHaveValue("2027-02-17");
  await calendar.getByText("날짜 직접 이동").click();
  await calendar.getByRole("link", { name: "2027. 2. 19." }).click();
  await expect(page).toHaveURL(/itinerary\?date=2027-02-19$/);
  await expect(page.getByText("이 날짜에 등록된 일정이 없어요.")).toBeVisible();

  async function add(title: string, time?: string, period?: string) {
    await page.getByRole("link", { name: "일정 추가" }).click();
    await page.getByLabel("일정 이름").fill(title);
    if (time || period) {
      await page.getByText("일정 상세 설정", { exact: true }).click();
      await expect(page.getByLabel("일정 날짜", { exact: true })).toHaveValue("2027-02-19");
      await page.getByLabel("시간 방식").selectOption(time ? "FIXED" : "PERIOD");
      if (time) await page.getByLabel("일본 현지 시각").fill(time);
      if (period) await page.getByLabel("시간대", { exact: true }).selectOption(period);
    }
    await page.getByRole("button", { name: "일정 저장", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }

  await add("늦은 출발", "11:10");
  await add("저녁 약속", undefined, "EVENING");
  await add("오후 운하", undefined, "AFTERNOON");
  await add("아침 산책", "09:20");
  await add("아침 사진", "09:20");
  await add("오전 시장", undefined, "MORNING");
  await add("시간 미정 카페");
  const entries = page.getByRole("region", { name: "날짜별 일정" }).locator("ol").getByRole("heading");
  await expect(entries).toHaveText(["아침 산책", "아침 사진", "늦은 출발", "오전 시장", "오후 운하", "저녁 약속", "시간 미정 카페"]);
  await expect(page.getByRole("button", { name: "늦은 출발 위로" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "오후 운하 위로" })).toHaveCount(0);
  const up = page.getByRole("button", { name: "아침 사진 위로" });
  expect((await up.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await up.click();
  await expect(entries).toHaveText(["아침 사진", "아침 산책", "늦은 출발", "오전 시장", "오후 운하", "저녁 약속", "시간 미정 카페"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await page.setViewportSize({ width: 1440, height: 900 });
  const photo = page.locator("[data-schedule-id]").filter({ has: page.getByRole("heading", { name: "아침 사진" }) });
  const walk = page.locator("[data-schedule-id]").filter({ has: page.getByRole("heading", { name: "아침 산책" }) });
  const handle = photo.locator("[draggable=true]");
  await expect(handle).toBeVisible();
  await handle.dragTo(walk.getByRole("heading"));
  await expect(entries).toHaveText(["아침 산책", "아침 사진", "늦은 출발", "오전 시장", "오후 운하", "저녁 약속", "시간 미정 카페"]);
  await page.reload();
  await expect(entries).toHaveText(["아침 산책", "아침 사진", "늦은 출발", "오전 시장", "오후 운하", "저녁 약속", "시간 미정 카페"]);
  await calendar.getByText("날짜 직접 이동").click();
  await page.getByRole("link", { name: "다음 날짜" }).click();
  await calendar.getByText("날짜 직접 이동").click();
  await expect(page.getByLabel("볼 날짜")).toHaveValue("2027-02-20");
  await expect(page.getByText("이 날짜에 등록된 일정이 없어요.")).toBeVisible();
});

test("M2 archives and restores a linked afternoon item and confirms dates outside the trip", async ({ page }) => {
  const trip = await seedFiveDayTrip("오타루 여행");
  const id = trip.split("/").at(-1);
  await asUser(database, ownerA, async (tx) => {
    const { rows: [place] } = await tx.query<{ id: string }>("insert into public.trip_places (trip_id,display_name) values ($1,'오타루 운하') returning id", [id]);
    await tx.query(`insert into public.itinerary_items (trip_id,title,local_date,time_mode,period,place_id,private_note,shared_note)
      values ($1,'운하 산책','2027-02-19','PERIOD','AFTERNOON',$2,'개인 준비 메모','동행 안내')`, [id, place.id]);
  });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(`${trip}/itinerary?date=2027-02-19`);
  await expect(page.locator("[data-schedule-id]").getByText("오타루 운하", { exact: true })).toBeVisible();
  await page.locator('summary[aria-label="운하 산책 일정 메뉴"]').click();
  await page.getByRole("button", { name: "후보로 보관" }).click();
  await expect(page.getByRole("heading", { name: "후보함" })).toBeVisible();
  await expect(page.getByText(/원래 날짜 2027\. 2\. 19/)).toBeVisible();
  await page.getByRole("link", { name: "후보 추가" }).click();
  await page.getByLabel("일정 이름").fill("위치 미정 후보");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "위치 미정 후보" })).toBeVisible();
  await page.locator('summary[aria-label="운하 산책 일정 메뉴"]').click();
  await page.getByRole("link", { name: "복원", exact: true }).click();
  await page.getByRole("button", { name: "원래 일정으로 복원" }).click();
  await expect(page).toHaveURL(/date=2027-02-19$/);
  await expect(page.locator("[data-schedule-id]").getByText("오후", { exact: true })).toBeVisible();
  await expect(page.getByText(/개인 준비 메모/)).toBeVisible();
  await expect(page.getByText(/동행 안내/)).toBeVisible();
  await expect(page.locator("[data-schedule-id]").getByText("오타루 운하", { exact: true })).toBeVisible();

  await page.locator('summary[aria-label="운하 산책 일정 메뉴"]').click();
  await page.getByRole("link", { name: "운하 산책 날짜 이동" }).click();
  await page.getByLabel("옮길 날짜").fill("2027-02-22");
  await page.getByRole("button", { name: "날짜 이동", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("여행 기간 밖");
  await expect(page.getByLabel("옮길 날짜")).toHaveValue("2027-02-22");
  const { rows: [unmoved] } = await asUser(database, ownerA, (tx) => tx.query<{ local_date: string }>(
    "select local_date::text from public.itinerary_items where trip_id=$1 and title='운하 산책'", [id],
  ));
  expect(unmoved.local_date).toBe("2027-02-19");
  await page.getByRole("button", { name: "기간 밖 일정 저장 확인" }).click();
  const outside = page.getByRole("region", { name: "여행 기간 밖 일정" });
  await expect(outside.getByRole("heading", { name: "운하 산책" })).toBeVisible();

  await page.getByRole("link", { name: "일정 추가" }).click();
  await page.getByLabel("일정 이름").fill("사전 준비");
  await page.getByText("일정 상세 설정", { exact: true }).click();
  await page.getByLabel("일정 날짜", { exact: true }).fill("2027-02-16");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("2027. 2. 16.");
  await page.getByRole("button", { name: "기간 밖 일정 저장 확인" }).click();
  await expect(outside.getByRole("heading", { name: "사전 준비" })).toBeVisible();

  await page.goto(`${trip}/edit`);
  await page.getByLabel("돌아오는 날").fill("2027-02-22");
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  const impact = page.getByRole("main").getByRole("alert");
  await expect(impact).toContainText("일정 1개");
  await expect(impact).toContainText("2027. 2. 22.");
  await expect(impact).not.toContainText("2027. 2. 16.");
  await page.getByRole("button", { name: "영향을 확인하고 저장" }).click();
  await page.goto(`${trip}/itinerary?date=2027-02-22`);
  await expect(page.getByRole("region", { name: "날짜별 일정" }).getByRole("heading", { name: "운하 산책" })).toBeVisible();
  await expect(outside.getByRole("heading", { name: "사전 준비" })).toBeVisible();
  await page.getByRole("link", { name: "후보함", exact: true }).click();
  await expect(page.getByRole("heading", { name: "위치 미정 후보" })).toBeVisible();
});

test("M2 preserves failed form input, refuses stale overwrites, and blocks a different owner", async ({ page, context, browser }) => {
  const trip = await seedFiveDayTrip("저장 검증 여행");
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(`${trip}/itinerary?date=2027-02-17`);
  await page.getByRole("link", { name: "일정 추가" }).click();
  await page.getByLabel("일정 이름").fill("테스트 저장 재시도");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("저장하지 못했어요");
  await expect(page.getByLabel("일정 이름")).toHaveValue("테스트 저장 재시도");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "테스트 저장 재시도" })).toHaveCount(1);
  await page.getByRole("link", { name: "테스트 저장 재시도 일정 수정" }).click();
  const old = await context.newPage();
  await old.goto(page.url());
  await old.getByLabel("일정 이름").fill("이전 탭 수정");
  await page.getByLabel("일정 이름").fill("먼저 저장한 일정");
  await page.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "먼저 저장한 일정" })).toBeVisible();
  await old.getByRole("button", { name: "일정 저장", exact: true }).click();
  await expect(old.getByRole("main").getByRole("alert")).toContainText("다른 화면에서 변경됐어요");
  await expect(old.getByLabel("일정 이름")).toHaveValue("이전 탭 수정");
  await old.getByRole("link", { name: "최신 목록 보기" }).click();
  await expect(old.getByRole("heading", { name: "먼저 저장한 일정" })).toBeVisible();
  await old.close();

  const other = await browser.newPage();
  await other.goto(`${appUrl}/auth/confirm?type=email&token_hash=local-fixture-second`);
  await other.goto(`${appUrl}${trip}/itinerary`);
  await expect(other.getByRole("heading", { name: "여행을 찾을 수 없어요" })).toBeVisible();
  await other.close();

  await page.locator('summary[aria-label="먼저 저장한 일정 일정 메뉴"]').click();
  await page.getByRole("link", { name: "먼저 저장한 일정 일정 삭제" }).click();
  await page.getByRole("button", { name: "일정 삭제 확인" }).click();
  await expect(page.getByRole("heading", { name: "먼저 저장한 일정" })).toHaveCount(0);
});

const mapStyle = "https://tiles.openfreemap.org/styles/liberty";
const testStyle = { version: 8, sources: {}, layers: [{ id: "paper", type: "background", paint: { "background-color": "#e6ebe4" } }] };

test("M3 manually saves a Japanese place, shows a map pin and links or detaches multiple visits", async ({ page }) => {
  const trip = await seedFiveDayTrip("장소 탐색용 여행");
  if (process.env.PLAYWRIGHT_LIVE_MAP !== "1") {
    await page.route(mapStyle, (route) => route.fulfill({ json: testStyle, headers: { "access-control-allow-origin": "*" } }));
  }
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, "kiokuLocationCalls", { get: () => calls });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_success: unknown, error: (value: {code:number}) => void) => {
      calls += 1;
      error({ code:1 });
    } } });
  });
  await page.setViewportSize({ width:320, height:780 });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(trip);
  await page.getByRole("link", { name: "장소와 지도" }).click();
  await page.getByRole("link", { name: "장소 추가" }).click();
  await page.getByRole("searchbox", { name: "일본 장소 검색" }).fill("삿포로역");
  await expect(page.getByRole("main").getByText(/장소 검색이 설정되지 않았어요/)).toBeVisible();
  await page.getByRole("button", { name:/직접 등록으로 계속/ }).click();
  await expect(page.getByLabel("장소 이름", { exact:true })).toHaveValue("삿포로역");
  await page.getByLabel("장소 이름", { exact:true }).fill("삿포로 테스트 장소");
  await page.getByLabel("주소", { exact:true }).fill("홋카이도 삿포로시");
  await page.getByText("좌표·다국어 이름·메모", { exact:true }).click();
  await page.getByLabel("일본어 이름").fill("札幌のテスト地点");
  await page.getByLabel("일본어 주소").fill("北海道札幌市中央区");
  await page.getByLabel("영어 이름").fill("Sapporo test location");
  await page.getByLabel("장소 메모").fill("테스트 메모");
  await page.getByLabel("위도", { exact:true }).fill("43.06");
  await page.getByRole("button", { name:"장소 저장" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("올바른 위도");
  await page.getByLabel("경도", { exact:true }).fill("141.35");
  await page.getByRole("button", { name:"장소 저장" }).click();
  const detail = page.getByRole("article", { name:"선택한 장소" });
  await expect(detail.getByText("北海道札幌市中央区")).toBeVisible();
  await expect(detail.getByText(/札幌のテスト地点.*Sapporo test location/)).toBeVisible();
  const pin = page.getByRole("button", { name:"지도 핀: 삿포로 테스트 장소" });
  await expect(pin).toBeVisible({ timeout:12000 });
  await pin.click();
  await expect(detail.getByRole("link", { name:"Google Maps 길찾기" })).toHaveAttribute("href", /destination=43\.06%2C141\.35/);
  await expect(page.getByRole("link", { name:"OpenFreeMap", exact:true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect(await page.evaluate(() => Reflect.get(window, "kiokuLocationCalls"))).toBe(0);
  await page.getByRole("button", { name:"내 위치", exact:true }).click();
  await expect(page.getByText(/위치 권한이 허용되지 않았어요/)).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "kiokuLocationCalls"))).toBe(1);
  await page.getByRole("button", { name:"목록", exact:true }).click();
  await expect(page.getByRole("region", { name:"저장된 장소" }).getByRole("button", { name:/삿포로 테스트 장소/ })).toBeVisible();

  await page.setViewportSize({ width:1440, height:900 });
  const mapBounds = await page.getByRole("region", { name:"장소 지도" }).boundingBox();
  const listBounds = await page.getByRole("region", { name:"저장된 장소" }).boundingBox();
  expect(listBounds!.x + listBounds!.width).toBeLessThan(mapBounds!.x);

  for (const title of ["첫 방문", "둘째 방문"]) {
    await detail.getByRole("link", { name:"일정에 추가" }).click();
    await expect(page.getByLabel("연결할 장소").locator("option:checked")).toHaveText("삿포로 테스트 장소");
    await page.getByLabel("일정 이름").fill(title);
    await page.getByRole("button", { name:"일정 저장", exact:true }).click();
    await expect(page.getByRole("heading", { name:title })).toBeVisible();
    await page.locator("[data-schedule-id]").filter({ has:page.getByRole("heading", { name:title }) })
      .getByRole("link", { name:"지도에서 장소 보기" }).click();
    await expect(detail.getByRole("heading", { name:"삿포로 테스트 장소" })).toBeVisible();
  }
  await expect(page.getByLabel("장소를 볼 날짜")).toHaveValue("2027-02-17");
  await page.goto(`${trip}/itinerary?date=2027-02-17`);
  const firstVisit = page.locator("[data-schedule-id]").filter({ has:page.getByRole("heading", { name:"첫 방문" }) });
  const secondVisit = page.locator("[data-schedule-id]").filter({ has:page.getByRole("heading", { name:"둘째 방문" }) });
  await firstVisit.getByRole("link", { name:"첫 방문 일정 수정" }).click();
  await page.getByLabel("연결할 장소").selectOption("");
  await page.getByRole("button", { name:"일정 저장", exact:true }).click();
  await expect(firstVisit.getByRole("link", { name:"지도에서 장소 보기" })).toHaveCount(0);
  await expect(secondVisit.getByRole("link", { name:"지도에서 장소 보기" })).toBeVisible();
  await firstVisit.getByRole("link", { name:"첫 방문 일정 수정" }).click();
  await page.getByLabel("연결할 장소").selectOption({ label:"삿포로 테스트 장소" });
  await page.getByRole("button", { name:"일정 저장", exact:true }).click();
  await firstVisit.getByRole("link", { name:"지도에서 장소 보기" }).click();
  await expect(detail.getByRole("heading", { name:"삿포로 테스트 장소" })).toBeVisible();
  await detail.getByRole("link", { name:"장소 삭제" }).click();
  await expect(page.getByText(/연결된 일정 2개의 장소 연결을 해제/)).toBeVisible();
  await page.getByRole("button", { name:"장소 삭제 확인" }).click();
  await expect(page.getByText("저장된 장소가 없어요.")).toBeVisible();
  await page.goto(`${trip}/itinerary?date=2027-02-17`);
  await expect(page.getByRole("heading", { name:"첫 방문" })).toBeVisible();
  await expect(page.getByRole("heading", { name:"둘째 방문" })).toBeVisible();
  await expect(page.getByRole("link", { name:"지도에서 장소 보기" })).toHaveCount(0);
});

test("M3 debounces Japanese search, handles service errors and saves a selected result only on confirmation", async ({ page }) => {
  const trip = await seedFiveDayTrip("검색 테스트 여행");
  const queries:string[] = [];
  await page.route(mapStyle, (route) => route.fulfill({ json:testStyle, headers:{ "access-control-allow-origin":"*" } }));
  await page.route("**/api/places/search?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    queries.push(query);
    if (query === "검색 장애") return route.fulfill({ status:503, json:{ status:"unavailable" } });
    if (query === "검색 한도") return route.fulfill({ status:429, json:{ status:"limited" } });
    return route.fulfill({ json:{ status:"ok", results:[{
      id:"fixture-jp-sapporo", name:"札幌テスト駅", address:"北海道札幌市", latitude:43.068, longitude:141.35, language:"ja",
    }] } });
  });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(`${trip}/map?mode=add`);
  const search = page.getByRole("searchbox", { name:"일본 장소 검색" });
  await search.fill("검색 장애");
  await expect(page.getByText(/지금은 검색할 수 없어요/)).toBeVisible();
  await search.fill("검색 한도");
  await expect(page.getByText(/검색 한도에 도달했어요/)).toBeVisible();
  await search.fill("札");
  await search.fill("札幌");
  await search.fill("札幌駅");
  await page.getByRole("button", { name:/札幌テスト駅/ }).click();
  expect(queries).toEqual(["검색 장애","검색 한도","札幌駅"]);
  await expect(page.getByLabel("장소 이름", { exact:true })).toHaveValue("札幌テスト駅");
  await expect(page.getByText(/Geoapify에서 가져온 장소/)).toBeVisible();
  await page.getByRole("button", { name:"장소 저장" }).click();
  const detail = page.getByRole("article", { name:"선택한 장소" });
  await expect(detail.getByRole("heading", { name:"札幌テスト駅" })).toBeVisible();
  await expect(detail.getByRole("link", { name:"Geoapify" })).toBeVisible();
  await detail.getByRole("link", { name:"장소 수정" }).click();
  await page.getByLabel("장소 이름", { exact:true }).fill("札幌テスト駅 北口");
  await page.getByRole("button", { name:"장소 저장" }).click();
  await expect(detail.getByRole("heading", { name:"札幌テスト駅 北口" })).toBeVisible();
});

test("M3 keeps the place list when the basemap fails and denies a different owner", async ({ page, browser }) => {
  const trip = await seedFiveDayTrip("폴백 여행");
  const id = trip.split("/").at(-1);
  await page.route(mapStyle, (route) => route.abort("failed"));
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(`${trip}/map?mode=add`);
  await page.getByRole("button", { name:"직접 입력", exact:true }).click();
  await page.getByLabel("장소 이름", { exact:true }).fill("이름만 있는 장소");
  await page.getByRole("button", { name:"장소 저장" }).click();
  await expect(page.getByText(/지도를 불러오지 못했어요/)).toBeVisible({ timeout:12000 });
  const detail = page.getByRole("article", { name:"선택한 장소" });
  await expect(detail.getByRole("heading", { name:"이름만 있는 장소" })).toBeVisible();
  await expect(detail.getByText(/길찾기를 열려면 주소나 좌표/)).toBeVisible();
  await expect(detail.getByRole("link", { name:"Google Maps 길찾기" })).toHaveCount(0);
  const visitor = await browser.newPage();
  try {
    await visitor.goto(`${appUrl}/auth/confirm?type=email&token_hash=local-fixture-second`);
    await visitor.goto(`${appUrl}${trip}/map`);
    await expect(visitor.getByRole("heading", { name:"여행을 찾을 수 없어요" })).toBeVisible();
    const response = await visitor.request.get(`${appUrl}/api/places/search?tripId=${id}&q=Sapporo`);
    expect(response.status()).toBe(404);
  } finally { await visitor.close(); }
});

test("editorial home opens a keyboard-dismissable quick add without losing the date", async ({ page }) => {
  const trip = await seedFiveDayTrip("편집형 여행 수첩");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(trip);
  await expect(page.getByRole("region", { name: "여행 일정 한눈에 보기" })).toBeVisible();
  await page.getByRole("link", { name: "일정 보기", exact: true }).click();
  await page.getByRole("link", { name: "2027. 2. 19.", exact: true }).click();
  await page.getByRole("link", { name: "일정 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "일정 추가" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "저장한 장소" }).click();
  await expect(dialog.getByText("저장한 장소가 없어요.")).toBeVisible();
  await dialog.getByRole("button", { name: "직접 입력" }).click();
  await dialog.getByRole("button", { name: "일정 저장" }).click();
  expect(await dialog.getByLabel("일정 이름").evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await dialog.getByLabel("일정 이름").fill("느긋한 산책");
  await dialog.getByRole("button", { name: "일정 저장" }).click();
  await expect(page.getByRole("heading", { name: "느긋한 산책" })).toBeVisible();
  await expect(page).toHaveURL(/date=2027-02-19$/);
  await page.getByRole("link", { name: "일정 추가", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/date=2027-02-19$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page.route("**/api/places/search?*", (route) => route.fulfill({ json: { status: "ok", results: [
    { id: "editorial-search-fixture", name: "삿포로역", address: "홋카이도 삿포로", latitude: 43.068, longitude: 141.35, language: "ko" },
  ] } }));
  await page.getByRole("link", { name: "일정 추가", exact: true }).click();
  await dialog.getByRole("button", { name: "장소 검색", exact: true }).click();
  await dialog.getByRole("searchbox", { name: "일본 장소 검색" }).fill("삿포로역");
  await dialog.getByRole("button", { name: /삿포로역/ }).click();
  await expect(dialog.getByText("검색한 장소 · 저장 후 연결")).toBeVisible();
  await expect(dialog.getByRole("searchbox")).toHaveCount(0);
  await expect(dialog.getByLabel("일정 이름")).toHaveValue("삿포로역");
  await dialog.getByLabel("일정 이름").fill("삿포로역에서 만나기");
  await dialog.getByRole("button", { name: "일정 저장" }).click();
  const visit = page.locator("[data-schedule-id]").filter({ has: page.getByRole("heading", { name: "삿포로역에서 만나기" }) });
  await expect(visit.getByRole("link", { name: "지도에서 장소 보기" })).toBeVisible();
  const { rows: [saved] } = await asUser(database, ownerA, (tx) => tx.query(
    "select s.local_date::text, s.time_mode, p.display_name from itinerary_items s join trip_places p on p.id=s.place_id where s.title=$1",
    ["삿포로역에서 만나기"],
  ));
  expect(saved).toEqual({ local_date: "2027-02-19", time_mode: "UNSCHEDULED", display_name: "삿포로역" });
});

test("editorial desktop and mobile keep saved places and quick-add controls in reach", async ({ page }) => {
  const trip = await seedFiveDayTrip("삿포로 겨울 여행");
  const tripId = trip.split("/").at(-1);
  await asUser(database, ownerA, async (tx) => {
    await tx.query("update public.trips set traveler_count=2 where id=$1", [tripId]);
    const { rows: [park] } = await tx.query<{ id: string }>(
      "insert into public.trip_places (trip_id,display_name,address_text) values ($1,'오도리 공원','北海道札幌市中央区') returning id", [tripId],
    );
    await tx.query("insert into public.trip_places (trip_id,display_name) values ($1,'삿포로 TV 타워'),($1,'삿포로 맥주 박물관')", [tripId]);
    await tx.query(`insert into public.itinerary_items (trip_id,title,kind,local_date,time_mode,fixed_local_time,period,place_id)
      values ($1,'신치토세 공항 도착','MOVE','2027-02-17','FIXED','13:00',null,null),
      ($1,'오도리 공원 산책','PLACE','2027-02-17','PERIOD',null,'AFTERNOON',$2),
      ($1,'삿포로 TV 타워','PLACE','2027-02-17','UNSCHEDULED',null,null,null),
      ($1,'스프카레 먹기','NOTE','2027-02-17','PERIOD',null,'EVENING',null),
      ($1,'시내 둘러보기','NOTE','2027-02-18','UNSCHEDULED',null,null,null),
      ($1,'오타루 당일치기','NOTE','2027-02-19','UNSCHEDULED',null,null,null)`, [tripId, park.id]);
  });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  const capture = async (name: string) => {
    const directory = process.env.KIOKU_UI_SCREENSHOTS;
    if (directory) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });
    }
  };
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(trip);
    await expect(page.getByRole("heading", { name: "삿포로 겨울 여행" })).toBeVisible();
    await expect(page.locator(".editorial-stats")).toContainText("6개");
    await expect(page.locator(".editorial-stats")).toContainText("3개");
    const cover = await page.request.get("/kioku-winter-cover.webp");
    expect(cover.ok()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await capture(`home-${width}`);
    await page.getByRole("link", { name: "일정 보기", exact: true }).click();
    const places = page.getByRole("complementary", { name: "일정 장소 요약" });
    if (width === 1440) await expect(places).toBeVisible();
    else await expect(places).toBeHidden();
    await expect(page.getByRole("heading", { name: "오도리 공원 산책" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await capture(`itinerary-${width}`);
    await page.getByRole("link", { name: "일정 추가", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "일정 추가" });
    await dialog.getByRole("button", { name: "저장한 장소" }).click();
    await expect(dialog.getByRole("button", { name: "오도리 공원", exact: true })).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    if (width < 600) expect(Math.round(bounds.y + bounds.height)).toBe(844);
    await capture(`quick-add-${width}`);
    await dialog.getByRole("button", { name: "오도리 공원", exact: true }).click();
    await expect(dialog.getByText("저장한 장소 · 일정에 연결")).toBeVisible();
    await expect(dialog.getByRole("searchbox")).toHaveCount(0);
    await expect(dialog.getByLabel("일정 이름")).toHaveValue("오도리 공원");
    await capture(`quick-add-selected-${width}`);
    if (width < 600) {
      // Approximate an open on-screen keyboard by shrinking the visible viewport.
      await page.setViewportSize({ width, height: 480 });
      await dialog.getByLabel("일정 이름").focus();
      const save = dialog.getByRole("button", { name: "일정 저장" });
      await expect(save).toBeInViewport({ ratio: 1 });
      await capture(`quick-add-keyboard-${width}`);
      await page.setViewportSize({ width, height: 844 });
    }
    if (width === 320) {
      await dialog.getByRole("button", { name: "일정 저장" }).click();
      await expect(page.locator("[data-schedule-id]").filter({ has: page.getByRole("heading", { name: "오도리 공원", exact: true }) })
        .getByRole("link", { name: "지도에서 장소 보기" })).toBeVisible();
    } else {
      await dialog.getByRole("button", { name: "닫기" }).click();
      await expect(dialog).toHaveCount(0);
    }
  }
});

test("editorial places workspace keeps list, map and selection in sync on desktop and mobile", async ({ page }) => {
  test.setTimeout(90_000);
  const trip = await seedFiveDayTrip("삿포로 장소 수첩");
  const tripId = trip.split("/").at(-1);
  await asUser(database, ownerA, async (tx) => {
    const { rows } = await tx.query<{ id: string; display_name: string }>(`insert into public.trip_places
      (trip_id,display_name,address_text,address_ja,latitude,longitude,name_ja) values
      ($1,'오도리 공원','홋카이도 삿포로시 주오구','北海道札幌市中央区大通西',43.0606,141.3488,'大通公園'),
      ($1,'삿포로 TV 타워','홋카이도 삿포로시 주오구 오도리니시 1','北海道札幌市中央区大通西1',43.0611,141.3564,'さっぽろテレビ塔'),
      ($1,'오타루 운하','홋카이도 오타루시','北海道小樽市港町',43.199,140.994,'小樽運河'),
      ($1,'삿포로 맥주 박물관','홋카이도 삿포로시 히가시구',null,43.0715,141.3687,null),
      ($1,'수프카레 가게 후보',null,null,null,null,null) returning id, display_name`, [tripId]);
    const id = (name: string) => rows.find((row) => row.display_name === name)!.id;
    await tx.query(`insert into public.itinerary_items (trip_id,title,kind,local_date,time_mode,period,place_id) values
      ($1,'오도리 공원 산책','PLACE','2027-02-17','PERIOD','AFTERNOON',$2),
      ($1,'TV 타워 야경','PLACE','2027-02-17','PERIOD','EVENING',$3),
      ($1,'오타루 당일치기','PLACE','2027-02-19','UNSCHEDULED',null,$4)`, [tripId, id("오도리 공원"), id("삿포로 TV 타워"), id("오타루 운하")]);
  });
  if (process.env.PLAYWRIGHT_LIVE_MAP !== "1") {
    await page.route(mapStyle, (route) => route.fulfill({ json: testStyle, headers: { "access-control-allow-origin": "*" } }));
  }
  await page.route("**/api/places/search?**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "검색 장애") return route.fulfill({ status: 503, json: { status: "unavailable" } });
    return route.fulfill({ json: { status: "ok", results: [{ id: "fixture-clock-tower", name: "삿포로 시계탑",
      address: "北海道札幌市中央区北1条西2丁目", latitude: 43.0625, longitude: 141.3536, language: "ko" }] } });
  });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  const capture = async (name: string) => {
    const directory = process.env.KIOKU_UI_SCREENSHOTS;
    if (directory) {
      await page.evaluate(() => document.fonts.ready);
      if (process.env.PLAYWRIGHT_LIVE_MAP === "1") await page.waitForLoadState("networkidle").catch(() => {});
      await page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });
    }
  };
  const list = page.getByRole("region", { name: "저장된 장소" });
  const detail = page.getByRole("article", { name: "선택한 장소" });
  const pin = (name: string) => page.getByRole("button", { name: `지도 핀: ${name}` });
  const checkMapCredits = async () => {
    const sheet = (await detail.boundingBox())!;
    for (const name of ["OpenFreeMap", "© OpenMapTiles", "© OpenStreetMap"]) {
      const attribution = page.getByRole("link", { name, exact: true });
      await expect(attribution).toBeInViewport({ ratio: 1 });
      const credit = (await attribution.boundingBox())!;
      expect(credit.y + credit.height).toBeLessThanOrEqual(sheet.y);
      await attribution.click({ trial: true, timeout: 1500 });
    }
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${trip}/itinerary?date=2027-02-17`);
  await page.getByRole("navigation", { name: "일정 분류" }).getByRole("link", { name: "장소와 지도" }).click();
  await expect(page).toHaveURL(/map\?date=2027-02-17&filter=date$/);
  await expect(list.getByRole("button")).toHaveCount(2);
  await list.getByRole("link", { name: "전체" }).click();
  await expect(list.getByRole("button")).toHaveCount(5);
  const unpinnedPlace = list.getByRole("button", { name: /수프카레 가게 후보/ });
  await expect(unpinnedPlace).toContainText("주소 미정");
  await expect(unpinnedPlace).toContainText("좌표 없음");
  await unpinnedPlace.click();
  await expect(detail.getByText("좌표가 없어 지도에 핀이 표시되지 않아요.")).toBeVisible();
  await expect(pin("수프카레 가게 후보")).toHaveCount(0);
  await detail.getByRole("button", { name: "선택 닫기" }).click();
  await expect(pin("오도리 공원")).toBeVisible({ timeout: 12000 });
  await expect(page.locator("button.kioku-map-pin")).toHaveCount(4);
  await capture("places-1440");

  await list.getByRole("button", { name: /삿포로 TV 타워/ }).click();
  await expect(detail.getByRole("heading", { name: "삿포로 TV 타워" })).toBeVisible();
  await expect(detail.getByText("연결된 일정 1개")).toBeVisible();
  await expect(pin("삿포로 TV 타워")).toHaveAttribute("aria-pressed", "true");
  await capture("places-selected-1440");
  await pin("오도리 공원").click();
  await expect(list.getByRole("button", { name: /오도리 공원/ })).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByRole("heading", { name: "오도리 공원" })).toBeVisible();
  await page.getByRole("searchbox", { name: "저장된 장소 찾기" }).fill("운하");
  await expect(list.getByRole("button")).toHaveCount(1);
  await list.getByRole("button", { name: /오타루 운하/ }).click();
  await detail.getByRole("link", { name: "일정에 추가" }).click();
  const quick = page.getByRole("dialog", { name: "일정 추가" });
  await expect(quick.getByText("저장한 장소 · 일정에 연결")).toBeVisible();
  await quick.getByLabel("일정 이름").fill("운하 저녁 산책");
  await quick.getByRole("button", { name: "일정 저장" }).click();
  await expect(page).toHaveURL(/itinerary\?date=2027-02-17$/);
  await expect(page.locator("[data-schedule-id]").filter({ has: page.getByRole("heading", { name: "운하 저녁 산책" }) })
    .getByRole("link", { name: "지도에서 장소 보기" })).toBeVisible();

  await page.goto(`${trip}/map?date=2027-02-17`);
  await page.getByRole("link", { name: "장소 추가" }).click();
  const add = page.getByRole("dialog", { name: "장소 추가" });
  await add.getByRole("searchbox", { name: "일본 장소 검색" }).fill("검색 장애");
  await expect(add.getByText(/지금은 검색할 수 없어요/)).toBeVisible();
  await capture("place-search-failed-1440");
  await add.getByRole("button", { name: /직접 등록으로 계속/ }).click();
  await expect(add.getByLabel("장소 이름", { exact: true })).toHaveValue("검색 장애");
  await add.getByRole("button", { name: "닫기" }).click();
  await expect(add).toHaveCount(0);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${trip}/map?date=2027-02-17`);
    await expect(page.getByRole("button", { name: "목록", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "장소 지도" })).toBeHidden();
    await expect(list.getByRole("button")).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await capture(`places-${width}`);
    await list.getByRole("button", { name: /오도리 공원/ }).click();
    await expect(detail).toBeInViewport();
    const tabs = (await page.getByRole("navigation", { name: "여행 바로가기" }).boundingBox())!;
    const sheet = (await detail.boundingBox())!;
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(tabs.y + 1);
    await detail.getByRole("button", { name: "지도에서 보기" }).click();
    await expect(list).toBeHidden();
    await expect(pin("오도리 공원")).toHaveAttribute("aria-pressed", "true", { timeout: 12000 });
    await expect(pin("오도리 공원")).toBeInViewport();
    const marker = (await pin("오도리 공원").boundingBox())!;
    expect(marker.y + marker.height).toBeLessThan((await detail.boundingBox())!.y);
    await checkMapCredits();
    await capture(`places-map-${width}`);
    await pin("삿포로 TV 타워").click();
    await expect(detail.getByRole("heading", { name: "삿포로 TV 타워" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 650 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await checkMapCredits();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "장소 추가" }).click();
  await add.getByRole("searchbox", { name: "일본 장소 검색" }).fill("시계탑");
  await add.getByRole("button", { name: /삿포로 시계탑/ }).click();
  await expect(add.getByText("검색한 장소 · Geoapify")).toBeVisible();
  await expect(add.getByRole("button", { name: "장소 저장" })).toBeInViewport();
  await capture("place-add-390");
  await add.getByRole("button", { name: "장소 저장" }).click();
  await expect(detail.getByRole("heading", { name: "삿포로 시계탑" })).toBeVisible();
  await expect(pin("삿포로 시계탑")).toHaveAttribute("aria-pressed", "true", { timeout: 12000 });
  await detail.getByRole("link", { name: "일정에 추가" }).click();
  await expect(page.getByRole("dialog", { name: "일정 추가" }).getByLabel("일정 이름")).toHaveValue("삿포로 시계탑");

  await page.unroute(mapStyle);
  await page.route(mapStyle, (route) => route.abort("failed"));
  await page.goto(`${trip}/map?date=2027-02-17`);
  await page.getByRole("button", { name: "지도", exact: true }).click();
  await expect(page.getByText(/지도를 불러오지 못했어요/)).toBeVisible({ timeout: 12000 });
  const retry = (await page.getByRole("button", { name: "지도 다시 불러오기" }).boundingBox())!;
  expect(retry.y + retry.height).toBeLessThanOrEqual((await page.getByRole("navigation", { name: "여행 바로가기" }).boundingBox())!.y);
  await capture("places-map-failed-390");
  await page.getByRole("button", { name: "목록", exact: true }).click();
  await expect(list.getByRole("button")).toHaveCount(6);
});

test("editorial map lets users select places with overlapping pins", async ({ page }) => {
  const trip = await seedFiveDayTrip("가까운 장소 수첩");
  await asUser(database, ownerA, (tx) => tx.query(`insert into public.trip_places
    (trip_id,display_name,latitude,longitude) values
    ($1,'공원 입구',43.0606,141.3488), ($1,'공원 안내소',43.0606,141.3488)`, [trip.split("/").at(-1)]));
  await page.route(mapStyle, (route) => route.fulfill({ json: testStyle, headers: { "access-control-allow-origin": "*" } }));
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${trip}/map`);
    if (width < 840) await page.getByRole("button", { name: "지도", exact: true }).click();
    const markers = page.locator(".kioku-map-pin");
    await expect(markers).toHaveCount(2, { timeout: 12000 });
    await markers.last().click();

    const detail = page.getByRole("article", { name: "선택한 장소" });
    const nearby = detail.getByRole("group", { name: "가까운 지도 핀" });
    for (const name of ["공원 입구", "공원 안내소"]) {
      await nearby.getByRole("button", { name: new RegExp(name) }).click({ timeout: 2500 });
      await expect(detail.getByRole("heading", { name })).toBeVisible();
      await expect(page.getByRole("button", { name: `지도 핀: ${name}` })).toHaveAttribute("aria-pressed", "true");
    }
  }
});

test("M4 creates and edits flight, stay and tour cards with owner-only details", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const trip = await seedFiveDayTrip("북해도 겨울 수첩");
  const list = trip + "/bookings?date=2027-02-17";
  const dialog = page.getByRole("dialog");
  const add = async (kind: string) => {
    await page.getByRole("link", { name: "예약 추가", exact: true }).click();
    await dialog.getByRole("button", { name: kind, exact: true }).click();
  };
  const edit = async () => dialog.getByRole("link", { name: "예약 수정" }).click();
  const save = async (title: string) => {
    await dialog.getByRole("button", { name: "예약 저장" }).click();
    await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
  };
  const close = async () => {
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog).toHaveCount(0);
  };
  const capture = async (name: string) => {
    const folder = process.env.KIOKU_UI_SCREENSHOTS;
    if (!folder) return;
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: folder + "/" + name + ".png", animations: "disabled" });
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(list);
  await expect(page.getByRole("heading", { name: "예약 정보 미등록" })).toBeVisible();
  await add("항공");
  await dialog.getByLabel("항공 예약 이름").fill("홋카이도 왕복 항공");
  const first = dialog.getByRole("region", { name: "1구간" });
  await first.getByLabel("출발 공항 코드").fill("PUS");
  await first.getByLabel("도착 공항 코드").fill("CTS");
  await first.getByText("항공편 · 현지 날짜와 시각").click();
  await first.getByLabel("출발 현지 날짜").fill("2027-02-17");
  await first.getByLabel("출발 공항 시간대").fill("Asia/Seoul");
  await dialog.getByRole("button", { name: "항공 구간 추가" }).click();
  const second = dialog.getByRole("region", { name: "2구간" });
  await second.getByLabel("출발 공항 코드").fill("CTS");
  await second.getByLabel("도착 공항 코드").fill("PUS");
  await second.getByText("항공편 · 현지 날짜와 시각").click();
  await second.getByLabel("편명").fill("TEST42");
  await second.getByLabel("출발 현지 날짜").fill("2027-02-21");
  await second.getByLabel("출발 현지 시각").fill("12:30");
  await second.getByLabel("출발 공항 시간대").fill("Asia/Tokyo");
  await second.getByLabel("도착 현지 시각").fill("15:25");
  await dialog.getByText("비공개 정보", { exact: true }).click();
  await dialog.getByLabel("개인 메모").fill("synthetic private marker for assertions");
  await save("홋카이도 왕복 항공");
  await expect(dialog.getByText("예약 필요", { exact: true })).toBeVisible();
  await expect(dialog.getByText("시각 미입력", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("12:30", { exact: true })).toBeVisible();
  await expect(dialog.getByText("15:25", { exact: true })).toBeVisible();
  await expect(dialog.getByText("TEST42")).toBeVisible();
  const privateDetail = page.url();
  await expect(dialog.getByText("synthetic private marker for assertions")).toBeHidden();
  await dialog.getByText("비공개 정보", { exact: true }).click();
  await expect(dialog.getByText("synthetic private marker for assertions")).toBeVisible();
  await edit();
  await dialog.getByLabel("예약 상태").selectOption("CONFIRMED");
  await save("홋카이도 왕복 항공");
  await expect(dialog.getByText("예약 완료", { exact: true })).toBeVisible();
  await close();

  await add("숙소");
  await dialog.getByLabel("숙소명").fill("가상 삿포로 호텔");
  await dialog.getByLabel("숙소 주소").fill("北海道札幌市中央区");
  await dialog.getByLabel("체크인 날짜").fill("2027-02-17");
  await dialog.getByLabel("체크아웃 날짜").fill("2027-02-21");
  await dialog.getByText("체크인·체크아웃 시각과 인원").click();
  await dialog.getByLabel("체크인 시각").fill("15:00");
  await dialog.getByLabel("체크아웃 시각").fill("11:00");
  await dialog.getByLabel("예약 상태").selectOption("CONFIRMED");
  await save("가상 삿포로 호텔");
  await edit();
  await dialog.getByText("체크인·체크아웃 시각과 인원").click();
  await expect(dialog.getByLabel("체크인 날짜")).toHaveValue("2027-02-17");
  await expect(dialog.getByLabel("체크아웃 날짜")).toHaveValue("2027-02-21");
  await expect(dialog.getByLabel("체크아웃 시각")).toHaveValue("11:00");
  await dialog.getByLabel("체크아웃 시각").fill("10:30");
  await save("가상 삿포로 호텔");
  await expect(dialog.getByText("15:00", { exact: true })).toBeVisible();
  await expect(dialog.getByText("10:30", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Google Maps 길찾기" })).toBeVisible();
  await capture("m4-desktop-detail-1440");
  await close();

  await page.setViewportSize({ width: 390, height: 844 });
  await add("투어");
  await dialog.getByLabel("투어명").fill("비에이 설경 산책");
  await dialog.getByLabel("투어 날짜").fill("2027-02-18");
  await dialog.getByLabel("집합 장소").fill("가상 안내소");
  await dialog.getByText("시작·집합 시각과 주소").click();
  await dialog.getByLabel("투어 시작 시각").fill("09:30");
  await dialog.getByLabel("집합 시각").fill("08:15");
  await save("비에이 설경 산책");
  await edit();
  await dialog.getByText("시작·집합 시각과 주소").click();
  await expect(dialog.getByLabel("투어 시작 시각")).toHaveValue("09:30");
  await dialog.getByLabel("집합 시각").fill("08:45");
  await dialog.getByLabel("예약 상태").selectOption("PENDING");
  await dialog.getByRole("heading", { name: "예약 수정" }).click();
  await capture("m4-mobile-editor-390");
  await save("비에이 설경 산책");
  await expect(dialog.getByText("09:30", { exact: true })).toBeVisible();
  await expect(dialog.getByText("08:45", { exact: true })).toBeVisible();
  await expect(dialog.getByText("예약 진행 중", { exact: true })).toBeVisible();
  await capture("m4-mobile-detail-390");
  await close();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await expect(page.getByRole("article")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture("m4-bookings-" + width);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("navigation", { name: "예약 유형으로 이동" }).getByRole("link", { name: "투어" }).click();
  await expect(page.getByRole("heading", { name: "투어", exact: true })).toBeInViewport();
  expect(await page.content()).not.toContain("synthetic private marker for assertions");
  await page.goto(trip);
  await expect(page.getByRole("region", { name: "예약 한눈에 보기" }).getByText("가상 삿포로 호텔")).toBeVisible();
  expect(await page.content()).not.toContain("synthetic private marker for assertions");
  const other = await browser.newPage();
  try {
    await other.goto(appUrl + "/auth/confirm?type=email&token_hash=local-fixture-second");
    await other.goto(privateDetail);
    await expect(other.getByRole("heading", { name: "여행을 찾을 수 없어요" })).toBeVisible();
    expect(await other.content()).not.toContain("synthetic private marker for assertions");
  } finally { await other.close(); }
});

test("M4 links and detaches schedules without overwriting the itinerary or deleting the booking", async ({ page }) => {
  test.setTimeout(90_000);
  const trip = await seedFiveDayTrip("예약과 일정 수첩");
  const tripId = trip.split("/").at(-1);
  const { rows: [booking] } = await asUser(database, ownerA, (tx) =>
    tx.query<{ id: string }>("insert into public.bookings (trip_id,kind,title,status) values ($1,'TOUR','가상 투어','NEEDS_BOOKING') returning id", [tripId]));
  const detailUrl = trip + "/bookings?date=2027-02-18&mode=view&id=" + booking.id;
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(detailUrl);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("link", { name: "일정에 추가" }).click();
  await expect(dialog.getByText("연결된 예약 · 가상 투어")).toBeVisible();
  await dialog.getByLabel("일정 이름").fill("투어 전 만남");
  await dialog.getByText("일정 상세 설정").click();
  await dialog.getByLabel("시간 방식").selectOption("FIXED");
  await dialog.getByLabel("일본 현지 시각").fill("08:30");
  await dialog.getByRole("button", { name: "일정 저장" }).click();
  const entry = page.locator("[data-schedule-id]").filter({ hasText: "투어 전 만남" });
  await expect(entry.getByRole("link", { name: "예약 · 가상 투어" })).toBeVisible();
  await entry.getByRole("link", { name: "투어 전 만남 일정 수정" }).click();
  await page.getByLabel("연결할 예약").selectOption("");
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(entry.getByRole("link", { name: "예약 · 가상 투어" })).toHaveCount(0);
  await expect(entry.getByText("08:30", { exact: true })).toBeVisible();
  await entry.getByRole("link", { name: "투어 전 만남 일정 수정" }).click();
  await page.getByLabel("연결할 예약").selectOption(booking.id);
  await page.getByRole("button", { name: "일정 저장" }).click();
  await entry.getByRole("link", { name: "예약 · 가상 투어" }).click();
  await dialog.getByRole("link", { name: "예약 수정" }).click();
  await expect(dialog.getByText("투어 전 만남")).toBeVisible();
  await dialog.getByLabel("예약 상태").selectOption("CANCELLED");
  await dialog.getByRole("button", { name: "예약 저장" }).click();
  await expect(dialog.getByText("취소됨")).toBeVisible();
  await dialog.getByRole("link", { name: "예약 삭제" }).click();
  await expect(dialog.getByText("연결된 일정 1개")).toBeVisible();
  await expect(dialog.getByText("투어 전 만남")).toBeVisible();
  await dialog.getByRole("button", { name: "예약 삭제 확인" }).click();
  await expect(page.getByRole("heading", { name: "예약 정보 미등록" })).toBeVisible();
  await page.goto(trip + "/itinerary?date=2027-02-18");
  await expect(entry.getByText("08:30", { exact: true })).toBeVisible();
  await expect(entry.getByRole("link", { name: "예약 · 가상 투어" })).toHaveCount(0);
});

test("M5 shares only the permitted itinerary, map and bookings and rechecks each request", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const trip = await seedFiveDayTrip("삿포로 동행 수첩");
  const tripId = trip.split("/").at(-1);
  const otherTrip = await seedFiveDayTrip("공유되지 않은 별도 여행");
  await asUser(database, ownerA, async (tx) => {
    const { rows: [place] } = await tx.query<{ id: string }>("insert into public.trip_places (trip_id,display_name,address_text,latitude,longitude,notes) values ($1,'오도리 공원','北海道札幌市中央区大通西',43.0606,141.3488,'PRIVATE_PLACE_MARKER') returning id", [tripId]);
    await tx.query("insert into public.itinerary_items (trip_id,title,local_date,place_id,shared_note,private_note) values ($1,'공원 산책','2027-02-17',$2,'공유 약속 메모','PRIVATE_SCHEDULE_MARKER'),($1,'아침 산책','2027-02-18',null,null,null)", [tripId, place.id]);
    await tx.query("select public.save_booking($1,$2,null,$3)", [tripId, randomUUID(), {
      kind: "STAY", title: "가상 삿포로 호텔", status: "CONFIRMED", detail: {
        address_text: "札幌市中央区", check_in_local_date: "2027-02-17", check_in_local_time: "15:00",
      }, shared_note: "호텔 공유 메모", private: { confirmation_reference: "PRIVATE_REFERENCE_MARKER",
        private_note: "PRIVATE_BOOKING_MARKER", amount: 98654321, currency: "JPY" },
    }]);
  });
  const screenshot = async (tab: typeof page, name: string) => {
    if (!process.env.KIOKU_UI_SCREENSHOTS) return;
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: process.env.KIOKU_UI_SCREENSHOTS + "/" + name + ".png", animations: "disabled" });
  };
  const openLink = async () => {
    await page.getByRole("button", { name: "링크 확인" }).click();
    const input = page.getByRole("textbox", { name: "동행자 공유 링크" });
    await expect(input).toBeVisible();
    const value = await input.inputValue();
    expect(new URL(value).pathname.startsWith("/s/")).toBe(true);
    return value;
  };
  const apiFor = (url: string) => appUrl + "/api/shared/" + new URL(url).pathname.split("/").at(-1);
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/auth/confirm?type=email&token_hash=local-fixture-link");
  await page.goto(trip);
  await page.getByRole("link", { name: "여행 공유" }).click();
  await expect(page.getByText("공유 꺼짐", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "동행자 화면 미리보기" }).click();
  await expect(page.getByRole("heading", { name: "삿포로 동행 수첩" })).toBeVisible();
  await page.getByRole("link", { name: "공유 설정", exact: true }).click();
  await page.getByRole("button", { name: "링크 공유 켜기" }).click();
  await expect(page.getByText("공유 중", { exact: true })).toBeVisible();
  await screenshot(page, "m5-owner-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, "m5-owner-390");
  const link = await openLink();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: appUrl });
  await page.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.getByText("링크를 복사했어요.")).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())) === link).toBe(true);
  await page.reload();
  expect((await openLink()) === link).toBe(true);

  const guest = await browser.newPage();
  try {
    let mapSeen = false;
    let mapHasReferer = false;
    await guest.route(mapStyle, (route) => {
      mapSeen = true;
      mapHasReferer ||= Boolean(route.request().headers().referer);
      return process.env.PLAYWRIGHT_LIVE_MAP === "1" ? route.continue() :
        route.fulfill({ json: testStyle, headers: { "access-control-allow-origin": "*" } });
    });
    const response = (await guest.goto(link))!;
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    await expect(guest.getByRole("heading", { name: "공원 산책" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "가상 삿포로 호텔" })).toBeVisible();
    await expect(guest.getByRole("button", { name: "지도 핀: 오도리 공원" })).toBeVisible({ timeout: 12000 });
    expect(mapSeen).toBe(true);
    expect(mapHasReferer).toBe(false);
    const directions = guest.getByRole("link", { name: "Google Maps 길찾기" }).first();
    await expect(directions).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(guest.getByText("공유 약속 메모")).toHaveCount(0);
    await expect(guest.getByRole("link", { name: /수정|삭제|로그인/ })).toHaveCount(0);
    const api = await guest.request.get(apiFor(link));
    expect(api.status()).toBe(200);
    expect(api.headers()["cache-control"]).toContain("no-store");
    expect(await api.text()).not.toMatch(/PRIVATE_|98654321|공유되지 않은 별도 여행|encryptedToken|token_hash|owner_id/);
    expect(await guest.content()).not.toMatch(/PRIVATE_|98654321|공유되지 않은 별도 여행/);
    expect((await guest.request.post(apiFor(link), { data: {} })).status()).toBe(405);
    const fragment = await browser.newPage();
    const token = new URL(link).pathname.split("/").at(-1)!;
    const fragmentOrigin = appUrl + "/s";
    const fragmentResponse = fragment.waitForResponse((reply) =>
      reply.url() === appUrl + "/api/shared" && reply.request().method() === "POST");
    await fragment.goto(fragmentOrigin + "#" + token);
    expect((await fragmentResponse).status()).toBe(200);
    await expect(fragment.getByRole("heading", { name: "공원 산책" })).toBeVisible();
    await fragment.getByRole("navigation", { name: "공유 여행 바로가기" }).getByRole("link", { name: "장소" }).click();
    expect(new URL(fragment.url()).hash === "#" + token).toBe(true);
    await fragment.getByRole("navigation", { name: "공유 일정 날짜" }).getByRole("link", { name: /2027\. 2\. 18\./ }).click();
    await expect(fragment.getByRole("heading", { name: "아침 산책" })).toBeVisible();
    expect((await guest.request.get(appUrl + otherTrip, { maxRedirects: 0 })).status()).toBe(307);
    for (const width of [1440, 390, 320]) {
      await guest.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await screenshot(guest, "m5-shared-" + width);
    }
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.getByRole("navigation", { name: "공유 여행 바로가기" }).getByRole("link", { name: "장소" }).click();
    await expect(guest.getByRole("button", { name: "지도 핀: 오도리 공원" })).toBeInViewport();
    await screenshot(guest, "m5-map-390");
    await guest.setViewportSize({ width: 320, height: 844 });
    await guest.getByRole("navigation", { name: "공유 일정 날짜" }).getByRole("link", { name: /2027\. 2\. 18\./ }).click();
    await expect(guest.getByRole("heading", { name: "아침 산책" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "공원 산책" })).toHaveCount(0);
    await screenshot(guest, "m5-day-320");

    await page.getByLabel("항공·숙소·투어 일정").uncheck();
    await page.getByLabel("공유용 메모").check();
    await page.getByRole("button", { name: "공유 설정 저장" }).click();
    await expect(page.getByText("공유 설정을 저장했어요.")).toBeVisible();
    const changed = await (await guest.request.get(apiFor(link))).json();
    expect(changed.bookings).toBeNull();
    expect(changed.schedule[0].note).toBe("공유 약속 메모");
    await page.getByLabel("만료일 (일본 현지 날짜)").fill("2099-04-18");
    await page.getByRole("button", { name: "새 링크 발급" }).click();
    await expect(page.getByText("공유 링크를 발급했어요.")).toBeVisible();
    await expect(page.getByLabel("만료일 (일본 현지 날짜)")).toHaveValue("2099-04-18");
    const rotated = await openLink();
    expect(rotated !== link).toBe(true);
    expect((await guest.request.get(apiFor(link))).status()).toBe(404);
    await fragment.reload();
    await expect(fragment.getByRole("heading", { name: "공유 링크를 열 수 없어요" })).toBeVisible();
    await fragment.close();
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "공유 링크를 열 수 없어요" })).toBeVisible();
    expect((await guest.request.get(apiFor(rotated))).status()).toBe(200);
    await page.getByRole("button", { name: "공유 중지" }).click();
    await expect(page.getByText("공유 꺼짐", { exact: true })).toBeVisible();
    expect((await guest.request.get(apiFor(rotated))).status()).toBe(404);
    await page.getByRole("button", { name: "링크 공유 켜기" }).click();
    const expiring = await openLink();
    await database.query("update kioku_private.trip_share_links set expires_at=now() - interval '1 second' where trip_id=$1", [tripId]);
    expect((await guest.request.get(apiFor(expiring))).status()).toBe(404);
    await page.reload();
    await expect(page.getByText("링크 만료", { exact: true })).toBeVisible();
  } finally { await guest.close(); }
});
