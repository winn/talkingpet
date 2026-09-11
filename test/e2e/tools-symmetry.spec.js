import { test, expect } from "@playwright/test";

async function create(page) {
  await page.goto("/");
  await page.locator("#hubAdoptNewBtn").click();
  await page.locator(".type-card").first().click();
  await page.locator("#startBtn").click();
  await expect(page.locator("#modelStatus")).toBeHidden();
}
const pixels = (page) =>
  page.locator("#paintCanvas").evaluate((c) => c.toDataURL());

test("More tools closes with its close button, outside tap, Escape and action selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  const menu = page.locator(".more-tools");
  const open = () => menu.locator("summary").click();
  await open();
  await page.screenshot({
    path: "artifacts/ui-review/more-tools-close-mobile.png",
  });
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open", "");
  await open();
  await page.locator("#toggle2DBtn").click();
  await expect(menu).not.toHaveAttribute("open", "");
  await open();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await open();
  await page.locator("#toggleMirrorBtn").click();
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(page.locator("#symmetryLine")).toBeVisible();
});

test("touch drag moves mirror axis without paint, follows sheet zoom, and reflects strokes around the new axis", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await create(page);
  await page.locator(".more-tools summary").click();
  await page.locator("#toggleMirrorBtn").click();
  const line = page.locator("#symmetryLine");
  const blank = await pixels(page);
  const client = await context.newCDPSession(page);
  const touch = (type, points) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p) => ({ ...p, id: 1, radiusX: 5, radiusY: 5 })),
    });
  const canvas = await page.locator("#paintCanvas").boundingBox();
  const handle = await line.locator("span").boundingBox();
  const y = handle.y + handle.height / 2;
  await touch("touchStart", [{ x: handle.x + handle.width / 2, y }]);
  await touch("touchMove", [{ x: canvas.x + canvas.width * 0.35, y }]);
  await touch("touchEnd", []);
  await expect(line).toHaveAttribute("aria-valuenow", "35");
  expect(await pixels(page)).toBe(blank);
  // Paint away from the axis, then inspect the source and reflected pixels.
  await page.mouse.click(
    canvas.x + canvas.width * 0.2,
    canvas.y + canvas.height * 0.65,
  );
  const samples = await page.locator("#paintCanvas").evaluate((c) => {
    const ctx = c.getContext("2d");
    return [0.2, 0.5, 0.8].map(
      (x) =>
        ctx.getImageData(
          Math.round(c.width * x),
          Math.round(c.height * 0.65),
          1,
          1,
        ).data[3],
    );
  });
  expect(samples[0]).toBeGreaterThan(0);
  expect(samples[1]).toBeGreaterThan(0);
  expect(samples[2]).toBe(0);
  await page.locator("#undoBtn").click();
  expect(await pixels(page)).toBe(blank);
  // Keyboard and pointer share the same coordinate state.
  await line.focus();
  await page.keyboard.press("ArrowRight");
  await expect(line).toHaveAttribute("aria-valuenow", "36");
  await page.locator("#zoom2DInBtn").click();
  await expect(line.locator("span")).toBeInViewport();
  const zoomed = await page.locator("#paintCanvas").boundingBox();
  const axisX = zoomed.x + zoomed.width * 0.36;
  const axisY = zoomed.y + zoomed.height * 0.5;
  await touch("touchStart", [{ x: axisX, y: axisY }]);
  await touch("touchMove", [{ x: zoomed.x + zoomed.width * 0.55, y: axisY }]);
  await touch("touchEnd", []);
  await expect(line).toHaveAttribute("aria-valuenow", "55");
  expect(await pixels(page)).toBe(blank);
  await page.screenshot({
    path: "artifacts/ui-review/movable-symmetry-mobile.png",
  });
  await context.close();
});
