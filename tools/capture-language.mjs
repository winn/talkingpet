import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const base = process.argv[2] || "http://localhost:8091";
const errors = [];
for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({
    viewport,
    isMobile: name === "mobile",
    hasTouch: name === "mobile",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(base);
  await page.locator('#petHubScreen [data-language="th"]').click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `artifacts/ui-review/th-hub-${name}.png` });
  await page.locator("#hubAdoptNewBtn").click();
  await page.screenshot({ path: `artifacts/ui-review/th-choose-${name}.png` });
  await page.getByRole("button", { name: /แมวตัวจิ๋ว/ }).click();
  await page.screenshot({ path: `artifacts/ui-review/th-name-${name}.png` });
  await page.locator("#startBtn").click();
  await page.locator("#modelStatus").waitFor({ state: "hidden" });
  await page.screenshot({ path: `artifacts/ui-review/th-paint-${name}.png` });
  await page.locator("#nextPersonalityBtn").click();
  await page.getByRole("button", { name: "อบอุ่น", exact: true }).click();
  await page.locator("#tryPromptBtn").click();
  await page.screenshot({ path: `artifacts/ui-review/th-prompt-${name}.png` });
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ errors }));
if (errors.length) process.exitCode = 1;
