const test = require("node:test");
const assert = require("node:assert/strict");

test("mergeTurns joins store + typed lines and drops duplicates", async () => {
  const { mergeTurns } = await import("../src/chat-log.js");
  const turns = mergeTurns(
    [
      { sender: "user", text: "Hi", timestamp: 10 },
      { sender: "bot", text: "Hello!", timestamp: 20 },
      { sender: "user", text: "old", timestamp: 1 },
    ],
    [
      { sender: "user", text: "Hi", timestamp: 11 },
      { sender: "user", text: "I like mango", timestamp: 30 },
    ],
    5,
  );
  assert.deepEqual(
    turns.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "Hi" },
      { role: "pet", text: "Hello!" },
      { role: "user", text: "I like mango" },
    ],
  );
});

test("mergeTurns reads bot reply.text the way the realtime widget stores it", async () => {
  const { mergeTurns } = await import("../src/chat-log.js");
  const turns = mergeTurns(
    [
      { sender: "user", text: "สวัสดี", uiText: "สวัสดี", timestamp: 10 },
      {
        sender: "bot",
        reply: { type: "text", text: "หวัดดีจ้า" },
        timestamp: 20,
      },
    ],
    [],
    0,
  );
  assert.deepEqual(
    turns.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "สวัสดี" },
      { role: "pet", text: "หวัดดีจ้า" },
    ],
  );
});

test("mergeTurns ignores empty text and unknown shapes", async () => {
  const { mergeTurns } = await import("../src/chat-log.js");
  assert.deepEqual(mergeTurns([null, { sender: "user", text: "  " }], []), []);
  assert.deepEqual(mergeTurns("nope", null), []);
});
