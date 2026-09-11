import { test, expect } from "@playwright/test";
const stubChat = async (page) =>
  page.route("https://webavatar.didthat.cc/chat-widget.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.ChatWidget={destroy(){document.querySelector('#chatWidgetContainer').replaceChildren()},updateConfig(config){window.ChatWidgetConfig=config;document.querySelector(config.container).innerHTML='<canvas aria-label="Test avatar"></canvas>'}};window.ChatWidget.updateConfig(window.ChatWidgetConfig);`,
    }),
  );
const pets = (page) =>
  page.evaluate(async () => {
    const db = await import("/src/pet-db.js");
    return db.getAllPets();
  });
const pixels = (page) =>
  page.locator("#paintCanvas").evaluate((canvas) => canvas.toDataURL());
async function create(page, type = "Mini Cat") {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a pet", exact: true }).click();
  await expect(page.locator(".type-card")).toHaveCount(2);
  await page.getByRole("button", { name: new RegExp(type) }).click();
  await page.getByRole("button", { name: "Let’s paint" }).click();
  await expect(page.locator("#modelStatus")).toBeHidden();
}
async function chooseBackground(page, color) {
  await page.locator("#backdropToggle").click();
  await page.locator("#bgColorPicker").fill(color);
  await page.locator("#bgColorPicker").dispatchEvent("input");
  await page
    .getByRole("button", { name: "Close backdrop picker", exact: true })
    .click();
}
async function paintSheet(page) {
  if (await page.locator("#toggle2DBtn").isVisible())
    await page.locator("#toggle2DBtn").click();
  const box = await page.locator("#paintCanvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35, {
    steps: 6,
  });
  await page.mouse.up();
}
test("new pet, undo/redo, prompt preview, save and independent edits survive reload", async ({
  page,
}) => {
  await stubChat(page);
  await create(page);
  const blank = await pixels(page);
  await paintSheet(page);
  const painted = await pixels(page);
  expect(painted).not.toBe(blank);
  await page.locator("#undoBtn").click();
  expect(await pixels(page)).toBe(blank);
  await page.locator("#redoBtn").click();
  expect(await pixels(page)).toBe(painted);
  await chooseBackground(page, "#c4dff6");
  await page.locator("#nextPersonalityBtn").click();
  await expect(page.locator("#customPromptArea")).toBeHidden();
  await page.getByRole("button", { name: "Boy", exact: true }).click();
  await page.getByRole("button", { name: /Cozy/ }).click();
  await page.getByRole("button", { name: "Play guessing games" }).click();
  await page.getByRole("button", { name: "Try my prompt" }).click();
  await expect(page.locator("#promptExample")).toContainText("Come get comfy");
  await page.getByRole("button", { name: "Add my own idea" }).click();
  await page.locator("#personalityInput").fill("Ask me about dinosaurs.");
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#talkScreen")).toBeVisible();
  const saved = (await pets(page))[0];
  expect(saved.gender).toBe("male");
  expect(saved.backgroundColor).toBe("#c4dff6");
  expect(saved.texturePng).toBe(painted);
  expect(saved.personalityPrompt).toContain("Ask me about dinosaurs.");
  expect(saved.previewFrames.length).toBe(18);
  expect(await page.evaluate(() => window.ChatWidgetConfig.widgetId)).toBe(
    "nj5368d1",
  );
  await expect(page.locator("#talkScreen")).toHaveCSS(
    "background-color",
    "rgb(196, 223, 246)",
  );
  await page.locator("#exitTalkBtn").click();
  await page.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await page.getByRole("button", { name: /Adventurous/ }).click();
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  const revised = (await pets(page))[0];
  expect(revised.texturePng).toBe(saved.texturePng);
  expect(revised.previewFrames).toEqual(saved.previewFrames);
  expect(revised.createdAt).toBe(saved.createdAt);
  expect(revised.backgroundColor).toBe(saved.backgroundColor);
  await page.getByRole("button", { name: "Edit colors", exact: true }).click();
  await expect(page.locator("#petHubScreen")).toBeHidden();
  expect(await pixels(page)).toBe(painted);
  await chooseBackground(page, "#f6d6d7");
  await paintSheet(page);
  await page.locator("#nextPersonalityBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  const recolored = (await pets(page))[0];
  expect(recolored.personalityPrompt).toBe(revised.personalityPrompt);
  expect(recolored.gender).toBe("male");
  expect(recolored.backgroundColor).toBe("#f6d6d7");
  await page.reload();
  await expect(page.locator(".pet-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Talk to Momo" }).click();
  await expect(page.locator("#talkScreen")).toHaveCSS(
    "background-color",
    "rgb(246, 214, 215)",
  );
});
test("touch pinch cancels accidental paint and never paints with the remaining finger", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await create(page);
  const cdp = await context.newCDPSession(page);
  const gesture = async (selector, tool = "brush") => {
    await page.locator(`[data-tool="${tool}"]`).click();
    const before = await pixels(page);
    const viewBefore = await page.locator(selector).screenshot();
    const b = await page.locator(selector).boundingBox();
    const x = Math.round(b.x + b.width * 0.45),
      y = Math.round(b.y + b.height * 0.55);
    const touch = (id, x, y) => ({ id, x, y, radiusX: 4, radiusY: 4 });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(1, x, y)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [touch(1, x, y), touch(2, x + 45, y + 30)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touch(1, x - 25, y), touch(2, x + 65, y + 35)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [touch(1, x - 25, y)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touch(1, x - 45, y + 30)],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(await pixels(page)).toBe(before);
    expect((await page.locator(selector).screenshot()).equals(viewBefore)).toBe(
      false,
    );
    expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
  };
  await gesture("#vrmCanvas");
  await page.locator("#toggle2DBtn").click();
  await gesture("#paintCanvas");
  expect(
    await page
      .locator("#canvasTransformWrapper")
      .evaluate((el) => getComputedStyle(el).transform),
  ).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  await page.locator("#reset2DBtn").click();
  await gesture("#paintCanvas", "fill");
  await page.locator('[data-tool="brush"]').click();
  await paintSheet(page);
  await expect(page.locator("#undoBtn")).toBeEnabled();
  await context.close();
});
test("small phone layouts keep painting controls visible and dialogs usable", async ({
  browser,
}) => {
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const context = await browser.newContext({
      viewport: size,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await create(page, "Mini Dog");
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    for (const selector of [
      "#nextPersonalityBtn",
      '[data-tool="brush"]',
      '[data-tool="move"]',
      "#undoBtn",
      "#vrmCanvas",
    ]) {
      const b = await page.locator(selector).boundingBox();
      expect(b.width).toBeGreaterThan(0);
      expect(b.y + b.height).toBeLessThanOrEqual(size.height + 1);
    }
    await page.locator("#nextPersonalityBtn").click();
    await page.locator("#genderChoices").scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Girl", exact: true }),
    ).toBeVisible();
    await page.locator("#savePetBtn").scrollIntoViewIfNeeded();
    const b = await page.locator("#savePetBtn").boundingBox();
    expect(b.y + b.height).toBeLessThanOrEqual(size.height + 1);
    await context.close();
  }
});
test("legacy male dog opens the correct animal and prompt edit preserves old artwork", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { savePet } = await import("/src/pet-db.js");
    await savePet({
      id: "legacy",
      petType: "minidog_m",
      name: "Old pal",
      personalityPrompt: "Likes space stories.",
      texturePng: "",
      previewFrames: [],
      createdAt: 12345,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Boy", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#personalityInput")).toHaveValue(
    "Likes space stories.",
  );
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#toast")).toContainText("New ideas saved!");
  const saved = (await pets(page))[0];
  expect(saved.petType).toBe("minidog");
  expect(saved.gender).toBe("male");
  expect(saved.createdAt).toBe(12345);
  expect(saved.texturePng).toBe("");
});
test("storage failure keeps draft and retry saves it; deletion needs confirmation", async ({
  page,
}) => {
  await stubChat(page);
  await create(page);
  await paintSheet(page);
  await page.locator("#nextPersonalityBtn").click();
  // Simulate Supabase rejecting the write (e.g. quota or outage).
  const failWrites = (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 507,
          contentType: "application/json",
          body: JSON.stringify({ message: "storage full" }),
        })
      : route.continue();
  await page.route("**/rest/v1/pets**", failWrites);
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#toast")).toContainText("Your work is still here");
  expect(await pets(page)).toHaveLength(0);
  await page.unroute("**/rest/v1/pets**", failWrites);
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#talkScreen")).toBeVisible();
  await page.locator("#exitTalkBtn").click();
  await page.getByRole("button", { name: "Delete Momo", exact: true }).click();
  await page.locator("#cancelDeleteBtn").click();
  expect(await pets(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Delete Momo", exact: true }).click();
  await page.locator("#confirmDeleteBtn").click();
  await expect(page.locator(".pet-card")).toHaveCount(0);
});

test("picture stamping supports touch dragging, rotation, cancel, and undo", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await create(page);
  await page.locator("#toggle2DBtn").click();
  await page
    .locator("#imageUpload")
    .setInputFiles("assets/minicat/portrait.png");
  await expect(page.locator("#transformOverlay")).toBeVisible();
  const original = await page.locator("#transformOverlay").boundingBox();
  const cdp = await context.newCDPSession(page);
  const x = original.x + original.width * 0.5,
    y = original.y + original.height * 0.5;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 1, x: x + 20, y: y + 15 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const moved = await page.locator("#transformOverlay").boundingBox();
  expect(moved.x).toBeGreaterThan(original.x + 10);
  const handle = await page.locator("#handleRotate").boundingBox();
  const rx = handle.x + handle.width / 2,
    ry = handle.y + handle.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: rx, y: ry }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 1, x: rx + 45, y: ry + 20 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(
    await page
      .locator("#transformOverlay")
      .evaluate((el) => el.style.transform),
  ).not.toBe("rotate(0rad)");
  const blank = await pixels(page);
  await page.locator("#commitImageBtn").click();
  expect(await pixels(page)).not.toBe(blank);
  await page.locator("#undoBtn").click();
  expect(await pixels(page)).toBe(blank);
  await page
    .locator("#imageUpload")
    .setInputFiles("assets/minicat/portrait.png");
  await page.locator("#cancelImageBtn").click();
  expect(await pixels(page)).toBe(blank);
  await expect(page.locator("#transformOverlay")).toBeHidden();
  await context.close();
});
test("cancelled touch rolls back its stroke and keyboard focus stays in the current screen", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await create(page);
  await page.locator("#toggle2DBtn").click();
  const blank = await pixels(page);
  const b = await page.locator("#paintCanvas").boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: b.x + b.width * 0.4, y: b.y + b.height * 0.4 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 1, x: b.x + b.width * 0.5, y: b.y + b.height * 0.5 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  expect(await pixels(page)).toBe(blank);
  await page.locator("#nextPersonalityBtn").click();
  await page.locator("#savePetBtn").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#closePersonalityBtn")).toBeFocused();
  expect(await page.locator(".studio").evaluate((el) => el.inert)).toBe(true);
  await context.close();
});

test("real cat facial alpha holes paint, eyes stay protected, and fast 3D strokes stay continuous", async ({
  page,
}) => {
  await create(page);
  const rect = await page.locator("#vrmCanvas").boundingBox();
  const samples = await page.evaluate(async (rect) => {
    const { locateFaceSamples } = await import("/test/fixtures/paint-model.js");
    return locateFaceSamples(rect);
  }, rect);
  expect(samples.gaps.length).toBeGreaterThan(0);
  expect(samples.protectedPoint).toBeTruthy();
  expect(samples.line.length).toBeGreaterThan(12);
  for (const point of samples.gaps.slice(0, 4)) {
    const before = await pixels(page);
    await page.mouse.click(point.x, point.y);
    expect(await pixels(page)).not.toBe(before);
    await page.locator("#undoBtn").click();
  }
  const before = await pixels(page);
  await page.mouse.click(samples.protectedPoint.x, samples.protectedPoint.y);
  expect(await pixels(page)).toBe(before);
  await page.locator("#popoverBrushSize").fill("6");
  const start = samples.line[0],
    end = samples.line.at(-1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 1 });
  await page.mouse.up();
  const coverage = await page
    .locator("#paintCanvas")
    .evaluate(
      (canvas, points) =>
        points
          .slice(2, -2)
          .map(
            (p) =>
              canvas
                .getContext("2d")
                .getImageData(Math.floor(p.uv.x), Math.floor(p.uv.y), 1, 1)
                .data[3],
          ),
      samples.line,
    );
  expect(
    coverage.filter((alpha) => alpha > 0).length / coverage.length,
  ).toBeGreaterThan(0.9);
  await page.screenshot({ path: "artifacts/ui-review/face-paint-fixed.png" });
});
test("dragging saved previews rotates without selecting text and talk has no extra label", async ({
  page,
}) => {
  await stubChat(page);
  await create(page);
  await page.locator("#nextPersonalityBtn").click();
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#talkScreen")).toBeVisible();
  await page.locator("#chatWidgetContainer").evaluate((el) => {
    const button = document.createElement("div");
    button.id = "bcw-rt-call-btn-wrap";
    el.appendChild(button);
  });
  expect(
    await page
      .locator("#bcw-rt-call-btn-wrap")
      .evaluate((el) => getComputedStyle(el, "::after").content),
  ).toBe("none");
  await page.locator("#exitTalkBtn").click();
  const preview = page.locator(".rotator");
  await preview.scrollIntoViewIfNeeded();
  const initial = await preview.locator("img").getAttribute("src");
  const b = await preview.boundingBox();
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  expect((await preview.locator("img").getAttribute("src")) !== initial).toBe(
    true,
  );
  expect(await page.evaluate(() => getSelection().toString())).toBe("");
  await expect(preview).toHaveCSS("user-select", "none");
});
