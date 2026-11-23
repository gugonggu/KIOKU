import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
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
    const send = (status: number, payload: object | boolean | string) => {
      response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
    };
    const readJson = async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    };
    const sendSession = (user: { id: string; email: string }) => {
      const payload = encode({
        sub: user.id, aud: "authenticated", role: "authenticated", aal: "aal1",
        exp: Math.floor(Date.now() / 1000) + 3600, iss: `${providerUrl}/auth/v1`,
      });
      const unsigned = `${encode({ alg: "ES256", kid })}.${payload}`;
      const signature = sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" });
      const accessToken = `${unsigned}.${signature.toString("base64url")}`;
      issuedTokens.set(accessToken, user.id);
      return send(200, {
        access_token: accessToken,
        refresh_token: "fixture-refresh", expires_in: 3600, token_type: "bearer", user,
      });
    };

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
      if (auth_code !== "fixture-issued-code" || !pkceChallenge || challenge !== pkceChallenge) {
        return send(400, { code: "bad_code_verifier", message: "fixture invalid or consumed code" });
      }
      pkceChallenge = undefined;
      return sendSession({ id: ownerA, email: "pkce@example.test" });
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

    if (["/rest/v1/itinerary_items", "/rest/v1/trip_places", "/rest/v1/rpc/save_trip_place", "/rest/v1/rpc/delete_trip_place",
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
  await database.exec("truncate table public.itinerary_items, public.trip_places, public.trips");
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
  await expect(page.getByRole("img", { name: "겨울 거리의 기본 여행 표지" })).toBeVisible();
  await expect(page.getByText("날짜 미정", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

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
  await expect(page.getByLabel("볼 날짜")).toHaveValue("2027-02-17");
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
  await page.getByRole("link", { name: "다음 날짜" }).click();
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
  await expect(page.getByText("오후", { exact: true })).toBeVisible();
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
  await page.getByLabel("장소 이름", { exact:true }).fill("삿포로 테스트 장소");
  await page.getByLabel("주소", { exact:true }).fill("홋카이도 삿포로시");
  await page.getByText("다국어 이름과 메모", { exact:true }).click();
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
  await expect(page.getByRole("region", { name:"저장된 장소" }).getByRole("button", { name:/삿포로 테스트 장소/ })).toBeVisible();

  await page.setViewportSize({ width:1440, height:900 });
  const mapBounds = await page.getByRole("region", { name:"장소 지도" }).boundingBox();
  const listBounds = await page.getByRole("region", { name:"저장된 장소" }).boundingBox();
  expect(mapBounds!.x + mapBounds!.width).toBeLessThan(listBounds!.x);

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
    { id: "editorial-search-fixture", name: "삿포로역", address: "홋카이도 삿포로", latitude: 43.068, longitude: 141.35 },
  ] } }));
  await page.getByRole("link", { name: "일정 추가", exact: true }).click();
  await dialog.getByRole("button", { name: "장소 검색", exact: true }).click();
  await dialog.getByRole("searchbox", { name: "일본 장소 검색" }).fill("삿포로역");
  await dialog.getByRole("button", { name: /삿포로역/ }).click();
  await expect(dialog.getByLabel("일정 이름")).toHaveValue("삿포로역");
  await dialog.getByRole("button", { name: "일정 저장" }).click();
  await expect(page.getByRole("heading", { name: "삿포로역", exact: true })).toBeVisible();
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
    if (width === 320) {
      await dialog.getByRole("button", { name: "오도리 공원", exact: true }).click();
      await expect(dialog.getByLabel("일정 이름")).toHaveValue("오도리 공원");
      await dialog.getByRole("button", { name: "일정 저장" }).click();
      await expect(page.locator("[data-schedule-id]").filter({ has: page.getByRole("heading", { name: "오도리 공원", exact: true }) })
        .getByRole("link", { name: "지도에서 장소 보기" })).toBeVisible();
    } else {
      await dialog.getByRole("button", { name: "닫기" }).click();
      await expect(dialog).toHaveCount(0);
    }
  }
});
