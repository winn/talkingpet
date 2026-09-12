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

test("history tap records user speech objects without slowing other pushes", async () => {
  const {
    clearCapturedTurns,
    getCapturedTurns,
    startChatCapture,
    stopChatCapture,
  } = await import("../src/chat-capture.js");
  clearCapturedTurns();
  startChatCapture(null);
  try {
    const sink = [];
    sink.push(1, 2, 3);
    sink.push({ foo: "bar" });
    sink.push({ sender: "user", text: "My name is Momo", timestamp: 50 });
    sink.push({ sender: "bot", text: "Nice to meet you", timestamp: 60 });
    assert.deepEqual(getCapturedTurns(), [
      { sender: "user", text: "My name is Momo", timestamp: 50 },
      { sender: "bot", text: "Nice to meet you", timestamp: 60 },
    ]);
  } finally {
    stopChatCapture();
    clearCapturedTurns();
  }
});
