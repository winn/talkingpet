const assert = require("node:assert/strict");
const test = require("node:test");

test("a dead kit is shown as the tool reply", async () => {
  const { mcpPetReply } = await import("../src/mcp-talk.js");
  const reply = mcpPetReply({
    ok: false,
    error: "Could not reach the ESP32 kit at https://example.com.",
    language: "th",
  });
  assert.match(reply.chatText, /ต่อชุดอุปกรณ์ไม่ได้/);
  assert.match(reply.instruction, /^ตอบด้วยประโยคนี้เท่านั้น/);
});
