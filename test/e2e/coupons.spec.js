import { test, expect } from "./fixtures.js";

const points = (page) => page.locator("#pointsValue").textContent().then((t) => Number(t.replace(/,/g, "")));

test("admin creates a coupon at /admin and a user redeems it once", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("#adminScreen")).toBeVisible();
  await page.getByRole("tab", { name: "Coupons" }).click();
  const form = page.locator("#couponCreateForm");
  await form.locator("[name=points]").fill("7");
  await form.locator("[name=note]").fill("e2e");
  await form.getByRole("button", { name: "Create coupons" }).click();
  await expect(page.locator("#couponBatch")).toBeVisible();
  const code = (await page.locator("#couponBatchCodes").inputValue()).trim();
  expect(code).toMatch(/^MOMO-[A-Z2-9]{8}$/);
  await expect(page.locator("#adminCouponList")).toContainText(code);

  await page.locator("#adminBackBtn").click();
  await expect(page).toHaveURL(/\/$/);
  const before = await points(page);
  await page.locator("#accountBtn").click();
  await page.locator("#couponCode").fill(code.toLowerCase());
  await page.locator("#couponRedeemBtn").click();
  await expect(page.locator("#couponMessage")).toHaveText("7 points added!");
  await expect(page.locator("#accountPoints")).toHaveText(String(before + 7));
  expect(await points(page)).toBe(before + 7);

  await page.locator("#couponCode").fill(code);
  await page.locator("#couponRedeemBtn").click();
  await expect(page.locator("#couponMessage")).toHaveText("You have already redeemed this coupon.");
  expect(await points(page)).toBe(before + 7);
});

test("non-admin route guard sends /admin visitors home when the screen is closed", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("#adminScreen")).toBeVisible();
  await page.locator("#adminBackBtn").click();
  await expect(page.locator("#adminScreen")).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});
