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
