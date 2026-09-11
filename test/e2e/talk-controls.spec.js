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
window.ChatWidget={destroy(){document.querySelector('#chatWidgetContainer').replaceChildren()},playAnimation(n){window.played.push(n)},updateConfig(config){window.ChatWidgetConfig=config;document.querySelector(config.container).innerHTML='<canvas aria-label="Test avatar" width="600" height="600" style="width:100%;height:100%"></canvas>'}};
window.ChatWidget.updateConfig(window.ChatWidgetConfig);`,
    }),
  );

async function openTalk(page) {
  await stubChat(page);
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

test("talk mode shows one-tap moves and faces that call the widget directly", async ({
  page,
}) => {
  await openTalk(page);
  const tray = page.locator("#talkActionTray");
  await expect(tray).toBeVisible();
  await expect(page.locator("#talkGestureHint")).toBeVisible();
  await tray.getByRole("button", { name: "Wave" }).click();
  await tray.getByRole("button", { name: "Jump" }).click();
  await tray.getByRole("button", { name: "Happy" }).click();
  expect(await page.evaluate(() => window.played)).toEqual(["Waving", "Jump"]);
  expect(await page.evaluate(() => window.emotions)).toEqual(["happy"]);
  const talkNav = page.locator("#talkScreen .talk-nav");
  await talkNav.getByRole("button", { name: "ไทย", exact: true }).click();
  await expect(tray.getByRole("button", { name: "โบกมือ" })).toBeVisible();
  await talkNav.getByRole("button", { name: "English", exact: true }).click();
});

test("dragging turns the pet, shift-drag moves it, wheel zooms and reset restores", async ({
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
  await page.mouse.move(cx + 60, cy, { steps: 6 });
  await page.mouse.up();
  let g = await group();
  expect(g.r).toBeGreaterThan(0.3);
  expect(g.x).toBe(0);
  await page.keyboard.down("Shift");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy - 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  g = await group();
  expect(g.x).toBeGreaterThan(0);
  expect(g.y).toBeGreaterThan(0);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  g = await group();
  expect(g.s).toBeGreaterThan(1);
  await page
    .locator("#talkActionTray")
    .getByRole("button", { name: "Reset view" })
    .click();
  g = await group();
  expect(g).toEqual({ r: 0, x: 0, y: 0, s: 1 });
  await page.locator("#exitTalkBtn").click();
  await expect(page.locator("#talkActionTray")).toBeHidden();
});
