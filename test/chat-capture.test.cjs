const test = require("node:test");
const assert = require("node:assert/strict");

test("captured turns keep bot lines and ignore blank/dup bursts", async () => {
  const {
    clearCapturedTurns,
    getCapturedTurns,
    pushCapturedTurn,
  } = await import("../src/chat-capture.js");
  clearCapturedTurns();
  pushCapturedTurn({ sender: "bot", text: "  Hi!  ", timestamp: 100 });
  pushCapturedTurn({ sender: "bot", text: "Hi!", timestamp: 200 });
  pushCapturedTurn({ sender: "user", text: "Hello", timestamp: 300 });
  pushCapturedTurn({ sender: "bot", text: "   ", timestamp: 400 });
  assert.deepEqual(getCapturedTurns(), [
    { sender: "bot", text: "Hi!", timestamp: 100 },
    { sender: "user", text: "Hello", timestamp: 300 },
  ]);
  clearCapturedTurns();
  assert.deepEqual(getCapturedTurns(), []);
});
