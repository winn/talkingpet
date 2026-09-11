import { test, expect } from "./fixtures.js";

async function create(page) {
  await page.goto("/");
  await page.locator("#hubAdoptNewBtn").click();
  await page.locator(".type-card").first().click();
  await page.locator("#startBtn").click();
  await expect(page.locator("#modelStatus")).toBeHidden();
}
const pets = (page) =>
  page.evaluate(async () => (await import("/src/pet-db.js")).getAllPets());
const room = /indoor_house/;

test("all six image backdrops load and remain reachable in the phone picker", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await create(page);
  for (const [id, label] of [
    ["indoor-house", "Sunny room"],
    ["flower", "Flower sky"],
    ["magic", "Magic world"],
    ["indoor-apartment", "Cozy apartment"],
    ["indoor-bedroom", "Dreamy bedroom"],
    ["indoor-kitchen", "Sweet kitchen"],
  ]) {
    await page.locator("#backdropToggle").click();
    const choice = page.getByRole("button", { name: label, exact: true });
    await choice.scrollIntoViewIfNeeded();
    await choice.click();
    const loaded = await page.locator("#panel3D").evaluate(async (el) => {
      const url = getComputedStyle(el).backgroundImage.slice(5, -2);
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth > 0;
    });
    expect(loaded).toBe(true);
    await page.locator("#backdropToggle").click();
    await expect(page.locator(`[data-backdrop="${id}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator('#backdropPicker [popovertargetaction="hide"]').click();
  }
});

test("room selection survives save, prompt edits and reload; solid color clears it", async ({
  page,
}) => {
  await page.route("https://webavatar.didthat.cc/chat-widget.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.ChatWidget={destroy(){},updateConfig(config){Object.assign(window.ChatWidgetConfig,config)}};`,
    }),
  );
  await create(page);
  const texture = await page
    .locator("#paintCanvas")
    .evaluate((c) => c.toDataURL());
  await page.locator("#backdropToggle").click();
  await page.getByRole("button", { name: "Sunny room", exact: true }).click();
  await expect(page.locator("#backdropPicker")).toBeHidden();
  await expect(page.locator("#panel3D")).toHaveCSS("background-image", room);
  await page.screenshot({ path: "artifacts/ui-review/paint-room-desktop.png" });
  await page.locator("#nextPersonalityBtn").click();
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#talkScreen")).toBeVisible();
  await expect(page.locator("#chatWidgetContainer")).toHaveCSS(
    "background-image",
    room,
  );
  const saved = (await pets(page))[0];
  expect(saved.backgroundId).toBe("indoor-house");
  expect(saved.texturePng).toBe(texture);
  await page.locator("#exitTalkBtn").click();
  await expect(page.locator(".pet-preview")).toHaveCSS(
    "background-image",
    room,
  );
  await page.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  expect((await pets(page))[0].backgroundId).toBe("indoor-house");
  await page.reload();
  await page.getByRole("button", { name: "Edit colors", exact: true }).click();
  await expect(page.locator("#modelStatus")).toBeHidden();
  await expect(page.locator("#panel3D")).toHaveCSS("background-image", room);
  await page.locator("#backdropToggle").click();
  await expect(
    page.getByRole("button", { name: "Sunny room", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator("#bgColorPicker").fill("#c4dff6");
  await page.locator("#bgColorPicker").dispatchEvent("input");
  await expect(
    page.getByRole("button", { name: "Solid color", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#backdropPicker")).toBeHidden();
  await expect(page.locator("#panel3D")).toHaveCSS("background-image", "none");
  await page.locator("#nextPersonalityBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  expect((await pets(page))[0].backgroundId).toBeNull();
  await page.getByRole("button", { name: "Talk to Momo", exact: true }).click();
  await expect(page.locator("#chatWidgetContainer")).toHaveCSS(
    "background-image",
    "none",
  );
  await expect(page.locator("#chatWidgetContainer")).toHaveCSS(
    "background-color",
    "rgb(196, 223, 246)",
  );
});

test("Thai backdrop picker stays inside phone and landscape screens", async ({
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
    await page.locator('.studio-header [data-language="th"]').click();
    await page.locator("#backdropToggle").click();
    await expect(
      page.getByRole("button", { name: "ห้องแสงแดด", exact: true }),
    ).toBeVisible();
    const box = await page.locator("#backdropPicker").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({
      path: `artifacts/ui-review/backdrop-picker-${viewport.width}.png`,
    });
    await page.getByRole("button", { name: "ห้องแสงแดด", exact: true }).click();
    await expect(page.locator("#panel3D")).toHaveCSS("background-image", room);
    await page.screenshot({
      path: `artifacts/ui-review/paint-room-${viewport.width}.png`,
    });
    expect(errors).toEqual([]);
    await context.close();
  }
});
