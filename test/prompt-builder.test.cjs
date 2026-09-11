const test = require("node:test");
const assert = require("node:assert/strict");
test("pet picker has only two animals and old gender IDs keep their voices", async () => {
  const { PET_CONFIGS, getPetConfig, petGender } =
    await import("../src/pet-configs.js");
  assert.deepEqual(Object.keys(PET_CONFIGS), ["minicat", "minidog"]);
  assert.equal(getPetConfig("minicat_m").widgetId, "nj5368d1");
  assert.equal(getPetConfig("minidog_f").widgetId, "pusjdwpg");
  assert.equal(getPetConfig("minidog", "male").widgetId, "a93cmh90");
  assert.equal(petGender({ petType: "minicat_m" }), "male");
});
test("prompt recipe composes all selections and bounds custom text", async () => {
  const { buildPrompt, normalizeRecipe, normalizeBackground } =
    await import("../src/prompt-builder.js");
  const prompt = buildPrompt("Pip", "minidog", {
    gender: "male",
    vibe: "cozy",
    activity: "riddles",
    style: "short",
    custom: "Talk about dinosaurs.",
  });
  assert.match(prompt, /mini dog and a boy/);
  assert.match(prompt, /gentle, calm/);
  assert.match(prompt, /give hints before revealing answers/);
  assert.match(prompt, /Talk about dinosaurs/);
  assert.equal(normalizeRecipe({ custom: "a".repeat(400) }).custom.length, 300);
  assert.equal(normalizeBackground("bad"), "#e7ede4");
  assert.equal(normalizeBackground("#abc123"), "#abc123");
});
