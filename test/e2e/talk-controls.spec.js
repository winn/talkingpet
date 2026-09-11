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
window.ChatWidget={destroy(){document.querySelector('#chatWidgetContainer').replaceChildren()},playAnimation(n){window.played.push(n)},updateConfig(config){window.ChatWidgetConfig={...window.ChatWidgetConfig,...config};document.querySelector(window.ChatWidgetConfig.container).innerHTML='<canvas aria-label="Test avatar" width="600" height="600" style="width:100%;height:100%"></canvas><div id="bcw-rt-controls" style="position:absolute;right:16px;bottom:16px;display:flex;flex-direction:column;align-items:center;gap:12px"><div id="bcw-rt-volume-wrap"><button class="bcw-rt-btn" aria-label="Volume">V</button></div><div id="bcw-rt-ar-toggle-wrap"><button id="bcw-rt-ar-toggle-btn" class="bcw-rt-btn" aria-label="Enter AR">AR</button></div><div id="bcw-rt-call-btn-wrap"><button id="bcw-rt-call-btn" class="bcw-rt-btn" aria-label="Connect to AI">C</button></div></div>'}};
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

test("leaving talk gets the chat remembered; memory can be viewed, added and forgotten from Settings", async ({
  page,
}) => {
  const memories = new Map();
  const summaries = [];
  const upserts = [];
  await page.route("**/api/memories/summarize", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    summaries.push(body);
    const added = {
      id: "m1",
      key: "name",
      value: "John",
      pet_name: body.petName,
      created_at: "2026-09-11T00:00:00Z",
    };
    memories.set(added.id, added);
    await route.fulfill({ json: { added: [added] } });
  });
  await page.route("**/rest/v1/user_memories**", (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET") return route.fulfill({ json: [...memories.values()] });
    if (method === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      upserts.push({ body, prefer: request.headers().prefer || "" });
      const row = {
        id: `manual-${upserts.length}`,
        key: body.key,
        value: body.value,
        pet_name: body.pet_name ?? null,
        created_at: "2026-09-12T00:00:00Z",
      };
      memories.set(row.id, row);
      return route.fulfill({ status: 201, json: row });
    }
    if (method === "DELETE") {
      const id = new URL(request.url()).searchParams.get("id");
      if (id) memories.delete(id.replace(/^eq\./, ""));
      else memories.clear();
      return route.fulfill({ status: 204, body: "" });
    }
    return route.continue();
  });
  await openTalk(page);
  expect(await page.evaluate(() => window.ChatWidgetConfig.greetingInstruction)).toMatch(
    /If your friend asks you to remember something/,
  );
  // The hosted widget stores each session's turns in localStorage.
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem(
      "botnoi_history_test",
      JSON.stringify([
        { sender: "user", text: "stale line from last week", timestamp: now - 86400000 },
        { sender: "user", text: "My name is John", uiText: "My name is John", timestamp: now },
        { sender: "bot", text: "Nice to meet you, John!", timestamp: now + 1 },
      ]),
    );
  });
  await page.locator("#exitTalkBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  await expect(page.locator("#toast")).toHaveText("Momo will remember what you shared today.");
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({
    petId: "talk-controls",
    petName: "Momo",
    language: "en",
    transcript: [
      { role: "user", text: "My name is John" },
      { role: "pet", text: "Nice to meet you, John!" },
    ],
  });

  // The next chat is told what the pet remembers, as key: value lines.
  await page.getByRole("button", { name: "Talk to Momo", exact: true }).click();
  await expect(page.locator("#chatWidgetContainer canvas")).toBeVisible();
  expect(await page.evaluate(() => window.ChatWidgetConfig.greetingInstruction)).toMatch(
    /Things you remember about your friend from earlier chats:\n- name: John/,
  );

  // Settings → Memory opens the table over the pet.
  await page.locator("#talkSettingsBtn").click();
  await page.locator("#talkMemoryBtn").click();
  const modal = page.locator("#memoryModal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#memoryTitle")).toHaveText("What Momo remembers");
  const rows = page.locator("#memoryRows tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Name");
  await expect(rows.first()).toContainText("John");
  await expect(rows.first()).toContainText("from Momo");

  // Adding by hand stores a snake_case key and updates the current chat's instructions.
  await page.locator("#memoryKey").fill("Favorite subject");
  await page.locator("#memoryValue").fill("  Science  ");
  await page.locator("#memoryAddBtn").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Favorite subject");
  await expect(rows.first()).toContainText("Science");
  expect(upserts[0].body).toMatchObject({ key: "favorite_subject", value: "Science" });
  expect(upserts[0].prefer).toContain("resolution=merge-duplicates");
  await expect
    .poll(() => page.evaluate(() => window.ChatWidgetConfig.greetingInstruction))
    .toMatch(/- favorite subject: Science\n- name: John/);
  await expect(page.locator("#memoryKey")).toHaveValue("");

  // Forgetting one, then everything.
  await rows.first().getByRole("button", { name: "Forget this memory" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("John");
  await page.locator("#forgetAllBtn").click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator("#memoryEmpty")).toBeVisible();
  await expect(page.locator("#forgetAllBtn")).toBeHidden();
  expect(memories.size).toBe(0);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await page.locator("#exitTalkBtn").click();
  await expect(page.locator("#petHubScreen")).toBeVisible();
  expect(summaries).toHaveLength(1);

  // The account sheet reaches the same table.
  await page.locator("#accountBtn").click();
  await page.locator("#accountMemoryBtn").click();
  await expect(modal).toBeVisible();
  await expect(page.locator("#memoryTitle")).toHaveText("What your pets remember");
  await expect(page.locator("#memoryEmpty")).toBeVisible();
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
