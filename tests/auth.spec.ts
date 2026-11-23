import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { e2eHost, e2ePorts, e2eUrls } from "./support/e2e-ports";
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
  const kid = "e2e-signing-key";
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedTokens = new Map<string, string>();
  const savedWithLostReply = new Set<string>();
  database = await createTripsDatabase();

  provider = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", providerUrl);
    const send = (status: number, payload: object) => {
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

    return send(404, { code: "not_found", message: "fixture route not found" });
  });

  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject).listen(e2ePorts.provider, e2eHost, resolve);
  });
});

test.beforeEach(async () => {
  failNextTripRead = false;
  pkceChallenge = undefined;
  await database.exec("truncate table public.trips");
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
  await expect(page.getByRole("img", { name: "산과 해가 그려진 기본 여행 표지" })).toBeVisible();
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
