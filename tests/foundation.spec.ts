import { expect, test } from "@playwright/test";

test("the entry point opens the Korean login with safe configuration guidance", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  await expect(page.getByLabel("이메일 주소")).toHaveAttribute("type", "email");
  await expect(page.getByText("로그인 설정이 필요해요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그인 링크 받기" })).toBeDisabled();
  expect((await page.request.get("/favicon.ico")).status()).toBe(200);
});

for (const path of ["/trips", "/trips/new"]) {
  test(`visitors are redirected before seeing ${path}`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/login");
    expect(response.headers()["cache-control"]).toMatch(/no-store/);
    expect(await response.text()).not.toContain("새 여행을 준비해요");
  });
}

test("an incomplete magic link returns to login with a retry message", async ({ page }) => {
  const response = await page.goto("/auth/confirm?type=email");
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login\?notice=link$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("새 로그인 링크를 요청해 주세요");
});

test("an unknown route offers a working return link", async ({ page }) => {
  const response = await page.goto("/unknown-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeVisible();
  await page.getByRole("link", { name: "처음으로 돌아가기" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

for (const width of [320, 390, 1440]) {
  test(`login fits ${width}px and provides a touch-sized focusable form`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
    const email = page.getByLabel("이메일 주소");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(email).toBeFocused();
    expect((await email.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
