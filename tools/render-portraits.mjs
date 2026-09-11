import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.goto("http://localhost:8090");
for (const [type, url] of [
  ["minicat", "/assets/minicat/PaintAnimationFaceoldbodyCat96.vrm"],
  ["minidog", "/assets/minidog/base.vrm"],
]) {
  const data = await page.evaluate(async (url) => {
    const { renderPortrait } = await import("/tools/render-portraits.js");
    return renderPortrait(url);
  }, url);
  writeFileSync(
    "assets/" + type + "/portrait.png",
    Buffer.from(data.split(",")[1], "base64"),
  );
}
await browser.close();
