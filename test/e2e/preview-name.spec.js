import { test, expect } from "./fixtures.js";
const pixels = (page) =>
  page.locator("#paintCanvas").evaluate((c) => c.toDataURL());
const pets = (page) =>
  page.evaluate(async () => (await import("/src/pet-db.js")).getAllPets());
async function create(page) {
  await page.goto("/");
  await page.locator("#hubAdoptNewBtn").click();
  await page.locator(".type-card").first().click();
  await page.locator("#startBtn").click();
  await expect(page.locator("#modelStatus")).toBeHidden();
}
async function draw(page) {
  const box = await page.locator("#paintCanvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.44, box.y + box.height * 0.55, {
    steps: 10,
  });
  await page.mouse.up();
}
test("mobile sheet preview stays live, rotates without paint, and preserves sheet zoom and undo", async ({
  browser,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await create(page);
    await page.locator("#toggle2DBtn").click();
    await expect(page.locator("#panel3D")).toBeHidden();
    await page.getByRole("button", { name: "3D preview", exact: true }).click();
    await expect(page.locator("#toggle3DPreviewBtn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#toggle2DBtn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#panel2D")).toBeVisible();
    const sheet = await page.locator("#panel2D").boundingBox(),
      preview = await page.locator("#panel3D").boundingBox();
    expect(preview.x).toBeGreaterThan(sheet.x);
    expect(preview.x + preview.width).toBeLessThan(sheet.x + sheet.width);
    expect(preview.y + preview.height).toBeLessThanOrEqual(
      sheet.y + sheet.height,
    );
    expect(preview.width).toBeLessThanOrEqual(122);
    const blank = await pixels(page);
    await draw(page);
    const painted = await pixels(page);
    expect(painted).not.toBe(blank);
    await page.screenshot({
      path: `artifacts/ui-review/sheet-preview-${viewport.width}.png`,
    });
    const canvas = await page.locator("#vrmCanvas").boundingBox();
    await page.mouse.move(
      canvas.x + canvas.width * 0.2,
      canvas.y + canvas.height * 0.6,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvas.x + canvas.width * 0.8,
      canvas.y + canvas.height * 0.6,
      { steps: 10 },
    );
    await page.mouse.up();
    expect(await pixels(page)).toBe(painted);
    if (viewport.width === 390) {
      const touch = await context.newCDPSession(page);
      const point = (id, x, y) => ({
        id,
        x: canvas.x + canvas.width * x,
        y: canvas.y + canvas.height * y,
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point(1, 0.3, 0.6)],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(1, 0.6, 0.65)],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point(1, 0.3, 0.6), point(2, 0.7, 0.6)],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(1, 0.2, 0.5), point(2, 0.8, 0.7)],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [point(1, 0.2, 0.5)],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(1, 0.4, 0.6)],
      });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      expect(await pixels(page)).toBe(painted);
    }
    await page.locator("#zoom2DInBtn").click();
    const transform = await page
      .locator("#canvasTransformWrapper")
      .getAttribute("style");
    await page.locator("#toggle3DPreviewBtn").click();
    await expect(page.locator("#panel3D")).toBeHidden();
    await expect(page.locator("#toggle3DPreviewBtn")).toBeFocused();
    await page.locator("#toggle3DPreviewBtn").click();
    expect(
      await page.locator("#canvasTransformWrapper").getAttribute("style"),
    ).toBe(transform);
    await page.locator("#undoBtn").click();
    expect(await pixels(page)).toBe(blank);
    await page.locator("#redoBtn").click();
    expect(await pixels(page)).toBe(painted);
    await page.locator("#toggle3DBtn").click();
    await expect(page.locator("#centerCameraBtn")).toBeVisible();
    // Returning to the sheet restores the glance without discarding any work.
    await page.locator("#toggle2DBtn").click();
    await expect(page.locator("#toggle3DPreviewBtn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    if (viewport.width === 390) {
      await page.locator('.studio-header [data-language="th"]').click();
      await expect(
        page.getByRole("button", { name: "ดูตัวเพื่อน", exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1200, height: 850 });
      await expect(page.locator("#toggle3DPreviewBtn")).toBeHidden();
      await expect(page.locator("#panel3D")).toBeVisible();
      await expect(page.locator("#panel2D")).toBeVisible();
      expect(
        (await page.locator("#panel3D").boundingBox()).width,
      ).toBeGreaterThan(300);
    }
    expect(errors).toEqual([]);
    await context.close();
  }
});
test("rename from the prompt builder updates recipes, samples, saved cards and chat without changing artwork", async ({
  page,
}) => {
  await page.route("https://webavatar.didthat.cc/chat-widget.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `window.ChatWidget={destroy(){document.querySelector('#chatWidgetContainer').replaceChildren()},updateConfig(config){window.ChatWidgetConfig=config;document.querySelector(config.container).innerHTML='<canvas></canvas>'}};window.ChatWidget.updateConfig(window.ChatWidgetConfig);`,
    }),
  );
  await create(page);
  await draw(page);
  const painted = await pixels(page);
  await page.locator("#nextPersonalityBtn").click();
  await page
    .getByRole("textbox", { name: "Your pet’s name", exact: true })
    .fill("ดาว Pip");
  await expect(page.locator("#promptRecipe")).toContainText("You are ดาว Pip");
  await page.locator("#tryPromptBtn").click();
  await expect(page.locator("#promptExample")).toContainText("ดาว Pip");
  await page.locator("#promptPetName").fill("ดาว <b>Pip</b>");
  await expect(page.locator("#promptExample")).toContainText("ดาว <b>Pip</b>");
  await expect(page.locator("#promptRecipe b")).toHaveCount(0);
  await page.locator('#personalityModal [data-language="th"]').click();
  await expect(
    page.getByRole("textbox", { name: "ชื่อเพื่อนของเรา", exact: true }),
  ).toHaveValue("ดาว <b>Pip</b>");
  await page.locator("#backToPaintBtn").click();
  await expect(page.locator("#userNameDisplay")).toHaveText(
    "ห้องระบายสีของ ดาว <b>Pip</b>",
  );
  await page.locator("#nextPersonalityBtn").click();
  await expect(page.locator("#promptPetName")).toHaveValue("ดาว <b>Pip</b>");
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#talkScreen")).toBeVisible();
  const first = (await pets(page))[0];
  expect(first.name).toBe("ดาว <b>Pip</b>");
  expect(first.texturePng).toBe(painted);
  expect(
    await page.evaluate(() => window.ChatWidgetConfig.greetingInstruction),
  ).toContain("ดาว <b>Pip</b>");
  await page.locator("#exitTalkBtn").click();
  await expect(page.locator(".pet-card h3")).toHaveText(first.name);
  await page.locator(".edit-prompt-btn").click();
  await page.locator("#promptPetName").fill("Mochi");
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  const renamed = (await pets(page))[0];
  expect(renamed.id).toBe(first.id);
  expect(renamed.name).toBe("Mochi");
  expect(renamed.texturePng).toBe(first.texturePng);
  expect(renamed.previewFrames).toEqual(first.previewFrames);
  expect(renamed.backgroundColor).toBe(first.backgroundColor);
  await page.reload();
  await expect(page.locator(".pet-card h3")).toHaveText("Mochi");
  await page.locator(".edit-prompt-btn").click();
  await page.locator("#promptPetName").fill("  ");
  await page.locator("#tryPromptBtn").click();
  await expect(page.locator("#promptPetName")).toHaveValue("Momo");
  await expect(page.locator("#promptRecipe")).toContainText("Momo");
  await page.screenshot({ path: "artifacts/ui-review/prompt-rename-th.png" });
  await page.locator("#closePersonalityBtn").click();
  await expect(page.locator(".pet-card h3")).toHaveText("Mochi");
});
