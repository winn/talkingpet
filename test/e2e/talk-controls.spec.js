import { test, expect } from "@playwright/test";

// The hosted widget is stubbed at its integration boundary with the same
// globals it exposes in production: ChatWidget.playAnimation and
// WebAvatar.avatarGroup / setEmotion.
const stubChat = (page) =>
  page.route("https://webavatar.didthat.cc/chat-widget.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.played=[];window.emotions=[];
window.WebAvatar={isARMode:false,avatarGroup:{rotation:{y:0},position:{x:0,y:0,z:-0.8},scale:{x:1,y:1,z:1,set(a,b,c){this.x=a;this.y=b;this.z=c;}}},setEmotion(n,w){window.emotions.push(n);}};
window.ChatWidget={destroy(){document.querySelector('#chatWidgetContainer').replaceChildren()},playAnimation(n){window.played.push(n)},updateConfig(config){window.ChatWidgetConfig=config;document.querySelector(config.container).innerHTML='<canvas aria-label="Test avatar" width="600" height="600" style="width:100%;height:100%"></canvas><div id="bcw-rt-controls" style="position:absolute;right:16px;bottom:16px;display:flex;flex-direction:column;align-items:center;gap:12px"><div id="bcw-rt-volume-wrap"><button class="bcw-rt-btn" aria-label="Volume">V</button></div><div id="bcw-rt-ar-toggle-wrap"><button id="bcw-rt-ar-toggle-btn" class="bcw-rt-btn" aria-label="Enter AR">AR</button></div><div id="bcw-rt-call-btn-wrap"><button id="bcw-rt-call-btn" class="bcw-rt-btn" aria-label="Connect to AI">C</button></div></div>'}};
window.ChatWidget.updateConfig(window.ChatWidgetConfig);`,
    }),
  );

const stubPets = (page) => {
  const rows = new Map();
  return page.route("**/rest/v1/pets**", (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET") {
      return route.fulfill({ json: [...rows.values()] });
    }
    if (method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      for (const row of Array.isArray(body) ? body : [body])
        rows.set(row.id, row);
      return route.fulfill({ status: 201, json: [] });
    }
    if (method === "DELETE") {
      const id = new URL(request.url()).searchParams.get("id");
      rows.delete(id ? id.replace(/^eq\./, "") : "");
      return route.fulfill({ status: 204, body: "" });
    }
    return route.continue();
  });
};

async function openTalk(page) {
  await stubChat(page);
  await stubPets(page);
  await page.goto("/");
  await page.evaluate(async () => {
    const { savePet } = await import("/src/pet-db.js");
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    c.getContext("2d").fillRect(0, 0, 64, 64);
    await savePet({
      id: "talk-controls",
      petType: "minicat",
      gender: "female",
      name: "Momo",
      personalityPrompt: "Friendly.",
      texturePng: c.toDataURL("image/png"),
      previewFrames: [],
      createdAt: 1,
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Talk to Momo", exact: true }).click();
  await expect(page.locator("#chatWidgetContainer canvas")).toBeVisible();
}

test("talk mode keeps the tray and tip hidden for a clean pet view", async ({
  page,
}) => {
  await openTalk(page);
  await expect(page.locator("#talkActionTray")).toBeHidden();
  await expect(page.locator("#talkGestureHint")).toBeHidden();
  await expect(page.locator("#chatWidgetContainer")).toHaveCSS(
    "background-image",
    /indoor_house|url\(/,
  );
});

test("talk swaps the widget's AR toggle for a Settings button that changes language", async ({
  page,
}) => {
  await openTalk(page);
  await expect(page.locator("#bcw-rt-ar-toggle-wrap")).toBeHidden();
  await expect(page.locator(".talk-nav .language-switch")).toHaveCount(0);
  const settings = page.locator("#bcw-rt-controls #talkSettingsBtn");
  await expect(settings).toBeVisible();
  await expect(settings).toHaveAttribute("aria-label", "Settings");
  // The Settings button sits where the AR toggle was: just above the call button.
  const order = await page
    .locator("#bcw-rt-controls > *")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(order.indexOf("talkSettingsWrap")).toBe(
    order.indexOf("bcw-rt-call-btn-wrap") - 1,
  );
  const panel = page.locator("#talkSettingsPanel");
  await expect(panel).toBeHidden();
  await settings.click();
  await expect(panel).toBeVisible();
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  await panel.locator('[data-language="th"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.locator("#exitTalkBtn")).toHaveText("← เพื่อนของเรา");
  await expect(settings).toHaveAttribute("aria-label", "ตั้งค่า");
  await expect(panel).toBeHidden();
  await settings.click();
  await expect(panel.locator('[data-language="th"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await settings.click();
  await panel.locator('[data-language="en"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.locator("#exitTalkBtn").click();
  await expect(page.locator("#talkScreen")).toBeHidden();
});

test("holding and dragging spins the pet; wheel zooms and double-click resets", async ({
  page,
}) => {
  await openTalk(page);
  const canvas = page.locator("#chatWidgetContainer canvas");
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const group = () =>
    page.evaluate(() => {
      const g = window.WebAvatar.avatarGroup;
      return {
        r: g.rotation.y,
        x: g.position.x,
        y: g.position.y,
        s: g.scale.x,
      };
    });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width / 4, cy + 30, { steps: 8 });
  await page.mouse.up();
  let g = await group();
  expect(g.r).toBeCloseTo(Math.PI / 2, 1);
  expect(g.x).toBe(0);
  expect(g.y).toBe(0);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - box.width / 2, cy, { steps: 8 });
  await page.mouse.up();
  g = await group();
  expect(g.r).toBeCloseTo(-Math.PI / 2, 1);
  await page.mouse.wheel(0, -300);
  g = await group();
  expect(g.s).toBeGreaterThan(1);
  await page.mouse.dblclick(cx, cy);
  g = await group();
  expect(g).toEqual({ r: 0, x: 0, y: 0, s: 1 });
  await page.locator("#exitTalkBtn").click();
  await expect(page.locator("#talkScreen")).toBeHidden();
});
