import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const output = "artifacts/ui-review";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const base = process.argv[2] || "http://localhost:8091";
const problems = [];
for (const [label, size] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
  ["small-phone", { width: 320, height: 568 }],
  ["landscape", { width: 844, height: 390 }],
]) {
  const context = await browser.newContext({
    viewport: size,
    isMobile: label !== "desktop",
    hasTouch: label !== "desktop",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      problems.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  if (label === "desktop" || label === "mobile")
    await page.screenshot({ path: `${output}/hub-${label}.png` });
  await page.getByRole("button", { name: "Create a pet", exact: true }).click();
  if (label === "desktop")
    await page.screenshot({ path: `${output}/choose-desktop.png` });
  await page.getByRole("button", { name: /Mini Cat/ }).click();
  await page.getByRole("button", { name: "Let’s paint" }).click();
  await page.locator("#modelStatus").waitFor({ state: "hidden" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}/paint-${label}.png` });
  await page.locator("#nextPersonalityBtn").click();
  if (label === "desktop" || label === "mobile")
    await page.screenshot({ path: `${output}/prompt-${label}.png` });
  if (label === "desktop") {
    await page.getByRole("button", { name: "Cozy", exact: true }).click();
    await page
      .getByRole("button", { name: "Discover things", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Try my prompt", exact: true })
      .click();
    await page.screenshot({ path: `${output}/prompt-recipe-desktop.png` });
  }
  await context.close();
}
await browser.close();
writeFileSync(
  `${output}/verification.json`,
  JSON.stringify(
    {
      base,
      viewports: ["1440×1000", "390×844", "320×568", "844×390"],
      errors: problems,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ screenshots: output, errors: problems }));
if (problems.length) process.exitCode = 1;
