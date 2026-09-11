const test = require("node:test");
const assert = require("node:assert/strict");
test("Thai recipes localize every preset, retain custom writing, and match the teaching preview", async () => {
  const {
    PROMPT_CHOICES,
    recipeChoice,
    buildPrompt,
    promptParts,
    samplePrompt,
  } = await import("../src/prompt-builder.js");
  for (const [category, choices] of Object.entries(PROMPT_CHOICES)) {
    for (const choice of choices) {
      const translated = recipeChoice(
        { [category]: choice.id },
        category,
        "th",
      );
      assert.match(translated.label, /[ก-๙]/);
      assert.match(translated.instruction, /[ก-๙]/);
      assert.equal(translated.id, choice.id);
    }
  }
  const recipe = {
    gender: "male",
    vibe: "cozy",
    activity: "discover",
    style: "excited",
    custom: "Ask about dinosaurs. ชวนวาดดาว 🦕 <b>hi</b>",
  };
  const prompt = buildPrompt("ดาว⭐", "minidog", recipe, "th");
  assert.match(prompt, /หมาตัวจิ๋ว และเป็นเด็กผู้ชาย/);
  assert.match(prompt, /อ่อนโยน ใจเย็น และใจดี/);
  assert.ok(prompt.includes(recipe.custom));
  assert.equal(
    prompt,
    promptParts("ดาว⭐", "minidog", recipe, "th")
      .map((line) => line.map((part) => part.text).join(""))
      .join(" "),
  );
  assert.match(samplePrompt("ดาว⭐", recipe, "th"), /มานั่งสบาย/);
  assert.match(samplePrompt("ดาว⭐", recipe, "th"), /ใต้ทะเลหรืออวกาศ/);
});
test("chat instructions follow chosen language for new, saved and legacy pets", async () => {
  const { buildChatGreeting } = await import("../src/prompt-builder.js");
  const pet = {
    name: "Momo",
    petType: "minicat",
    personalityPrompt: "old English text",
    promptRecipe: { vibe: "silly", custom: "Keep my exact idea" },
  };
  const th = buildChatGreeting(pet, "th");
  assert.match(th, /เริ่มด้วยการแนะนำตัวอย่างอบอุ่นเป็นภาษาไทย/);
  assert.match(th, /ขี้เล่น เป็นมิตร/);
  assert.ok(th.includes("Keep my exact idea"));
  assert.ok(!th.includes("old English text"));
  assert.match(
    buildChatGreeting(pet, "en"),
    /Introduce yourself warmly in English/,
  );
  assert.match(
    buildChatGreeting(
      { name: "Old pet", personalityPrompt: "Tell me old stories." },
      "th",
    ),
    /Tell me old stories\./,
  );
});
