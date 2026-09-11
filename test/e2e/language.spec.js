import { test, expect } from "./fixtures.js";
const switchTo = async (page, lang) => {
  // In Talk the switch lives behind the Settings button over the pet.
  const settings = page.locator("#talkSettingsBtn");
  if (await settings.isVisible()) {
    await settings.click();
    await expect(page.locator("#talkSettingsPanel")).toBeVisible();
  }
  const button = page.locator(`[data-language="${lang}"]:not([inert] *)`);
  await expect(button).toHaveCount(1);
  await button.click();
};
const petData = (page) =>
  page.evaluate(async () => (await import("/src/pet-db.js")).getAllPets());
const texture = (page) =>
  page.locator("#paintCanvas").evaluate((canvas) => canvas.toDataURL());
async function startThai(page) {
  await page.goto("/");
  await switchTo(page, "th");
  await page
    .getByRole("button", { name: "สร้างเพื่อนใหม่", exact: true })
    .click();
  await page.getByRole("button", { name: /แมวตัวจิ๋ว/ }).click();
  await page.locator("#nameInput").fill("ดาว⭐");
  await page.getByRole("button", { name: "ไประบายสีกัน" }).click();
  await expect(page.locator("#modelStatus")).toBeHidden();
}
test("language switch preserves art and ideas, persists, and changes saved pet instructions", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://webavatar.didthat.cc/chat-widget.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.ChatWidget={destroy(){document.querySelector('#chatWidgetContainer').replaceChildren()},updateConfig(config){Object.assign(window.ChatWidgetConfig,config);document.querySelector(window.ChatWidgetConfig.container).innerHTML='<canvas></canvas>'}};window.ChatWidget.updateConfig(window.ChatWidgetConfig);`,
    }),
  );
  await startThai(page);
  await expect(page.locator("#userNameDisplay")).toHaveText(
    "ห้องระบายสีของ ดาว⭐",
  );
  await page.locator("#backdropToggle").click();
  await page.locator("#bgColorPicker").fill("#c4dff6");
  await page.locator("#bgColorPicker").dispatchEvent("input");
  await page.locator("#backdropPicker [popovertargetaction=hide]").click();
  const canvas = page.locator("#paintCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, {
    steps: 10,
  });
  await page.mouse.up();
  const painted = await texture(page);
  await switchTo(page, "en");
  expect(await texture(page)).toBe(painted);
  await expect(page.locator("#userNameDisplay")).toHaveText("ดาว⭐'s Studio");
  await page.locator("#nextPersonalityBtn").click();
  await page.getByRole("button", { name: "Boy", exact: true }).click();
  await page.getByRole("button", { name: "Cozy", exact: true }).click();
  await page.locator("#customPromptBtn").click();
  const idea = "Ask about dinosaurs. ชวนวาดดาว <b>สวัสดี</b>";
  await page.locator("#personalityInput").fill(idea);
  await page.locator("#tryPromptBtn").click();
  await switchTo(page, "th");
  await expect(
    page.getByRole("button", { name: "เด็กผู้ชาย", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#personalityInput")).toHaveValue(idea);
  await expect(page.locator("#promptRecipe")).toContainText(
    "อ่อนโยน ใจเย็น และใจดี",
  );
  await expect(page.locator("#promptRecipe")).toContainText(idea);
  await expect(page.locator("#promptRecipe b")).toHaveCount(0);
  await expect(page.locator("#promptExample")).toContainText("มานั่งสบาย");
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#talkScreen")).toBeVisible();
  const saved = (await petData(page))[0];
  expect(saved.promptLanguage).toBe("th");
  expect(saved.gender).toBe("male");
  expect(saved.texturePng).toBe(painted);
  expect(saved.backgroundColor).toBe("#c4dff6");
  expect(saved.personalityPrompt).toContain("เด็กผู้ชาย");
  expect(saved.promptRecipe.custom).toBe(idea);
  expect(
    await page.evaluate(() => window.ChatWidgetConfig.greetingInstruction),
  ).toContain("เริ่มด้วยการแนะนำตัวอย่างอบอุ่นเป็นภาษาไทย");
  await switchTo(page, "en");
  await expect(page.locator("#chatWidgetContainer canvas")).toHaveCount(1);
  expect(
    await page.evaluate(() => window.ChatWidgetConfig.greetingInstruction),
  ).toContain("Introduce yourself warmly in English");
  await page.locator("#exitTalkBtn").click();
  await page.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await expect(page.locator("#promptRecipe")).toContainText(
    "gentle, calm, and kind",
  );
  await expect(page.locator("#personalityInput")).toHaveValue(idea);
  await switchTo(page, "th");
  await page.locator("#savePetBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.locator(".pet-card h3")).toHaveText("ดาว⭐");
  await page.getByRole("button", { name: "แก้ไขสี", exact: true }).click();
  await expect(page.locator("#petHubScreen")).toBeHidden();
  // Canvas PNG round-trips may round RGB channels by one; alpha and artwork stay intact.
  expect(
    await page.locator("#paintCanvas").evaluate(async (canvas, png) => {
      const image = new Image();
      image.src = png;
      await image.decode();
      const expected = document.createElement("canvas");
      expected.width = canvas.width;
      expected.height = canvas.height;
      const context = expected.getContext("2d");
      context.drawImage(image, 0, 0);
      const actual = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      return context
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.every(
          (value, i) => Math.abs(value - actual[i]) <= (i % 4 === 3 ? 0 : 1),
        );
    }, painted),
  ).toBe(true);
  await switchTo(page, "en");
  await page.locator("#nextPersonalityBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  const recolored = (await petData(page))[0];
  expect(recolored.personalityPrompt).toBe(saved.personalityPrompt);
  expect(recolored.promptLanguage).toBe("th");
  expect(errors).toEqual([]);
});
test("Thai menus and painting controls fit narrow phones and landscape", async ({
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
    await startThai(page);
    const check = async (selector) => {
      const box = await page.locator(selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    };
    await check("#nextPersonalityBtn");
    await check(".studio-header .language-switch");
    await check("#vrmCanvas");
    await check("#undoBtn");
    await page.screenshot({
      path: `artifacts/ui-review/th-paint-${viewport.width}.png`,
    });
    await page.locator("#nextPersonalityBtn").click();
    await page.screenshot({
      path: `artifacts/ui-review/th-prompt-${viewport.width}.png`,
    });
    await expect(
      page.getByRole("button", { name: "เด็กผู้หญิง", exact: true }),
    ).toBeVisible();
    await page.locator("#savePetBtn").scrollIntoViewIfNeeded();
    await check("#savePetBtn");
    const overflow = await page
      .locator("#personalityModal")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    await context.close();
  }
});

test("chat label adapter translates controls both ways without changing conversation or balances", async ({
  page,
}) => {
  await page.goto("/");
  await switchTo(page, "th");
  await page.evaluate(async () => {
    const { localizeChatControls } = await import("/src/chat-labels.js");
    const wrapper = document.createElement("div");
    wrapper.id = "translation-fixture";
    wrapper.innerHTML =
      '<div id="bcw-rt-controls"><button aria-label="Connect to AI"></button><input aria-label="Volume level"></div><div id="bcw-rt-credit-drawer"><span>Available credits</span><span>123.45</span><button>Log out</button></div><div id="bcw-rt-bubble-container">Available credits</div>';
    document.body.append(wrapper);
    localizeChatControls(wrapper);
  });
  const fixture = page.locator("#translation-fixture");
  await expect(fixture.locator("button").first()).toHaveAttribute(
    "aria-label",
    "เริ่มคุยกับ AI",
  );
  await expect(fixture.locator("#bcw-rt-credit-drawer")).toContainText(
    "เครดิตที่เหลือ",
  );
  await expect(fixture.locator("#bcw-rt-credit-drawer")).toContainText(
    "123.45",
  );
  await expect(fixture.locator("#bcw-rt-bubble-container")).toHaveText(
    "Available credits",
  );
  await switchTo(page, "en");
  await page.evaluate(async () => {
    (await import("/src/chat-labels.js")).localizeChatControls(
      document.querySelector("#translation-fixture"),
    );
  });
  await expect(fixture.locator("button").first()).toHaveAttribute(
    "aria-label",
    "Connect to AI",
  );
  await expect(fixture.locator("#bcw-rt-credit-drawer")).toContainText(
    "Available credits",
  );
});
