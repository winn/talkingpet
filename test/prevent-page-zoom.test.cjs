const test = require("node:test");
const assert = require("node:assert/strict");

test("initPreventPageZoom attaches listeners and prevents default on page zoom gestures", async () => {
  const { initPreventPageZoom } = await import(
    "../src/prevent-page-zoom.js"
  );

  const listeners = {};
  const mockDoc = {
    addEventListener(event, handler, options) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push({ handler, options });
    },
  };
  const mockWindow = { document: mockDoc };

  initPreventPageZoom(mockWindow);

  assert.ok(listeners["gesturestart"], "gesturestart listener registered");
  assert.ok(listeners["gesturechange"], "gesturechange listener registered");
  assert.ok(listeners["gestureend"], "gestureend listener registered");
  assert.ok(listeners["touchmove"], "touchmove listener registered");
  assert.ok(listeners["wheel"], "wheel listener registered");

  // Verify gesturestart calls preventDefault
  let gesturePrevented = false;
  listeners["gesturestart"][0].handler({
    preventDefault() {
      gesturePrevented = true;
    },
  });
  assert.equal(gesturePrevented, true, "gesturestart calls preventDefault");

  // Verify multi-touch touchmove calls preventDefault
  let multiTouchPrevented = false;
  listeners["touchmove"][0].handler({
    touches: [{}, {}],
    preventDefault() {
      multiTouchPrevented = true;
    },
  });
  assert.equal(
    multiTouchPrevented,
    true,
    "multi-touch touchmove calls preventDefault",
  );

  // Verify single-touch touchmove does NOT call preventDefault (so scroll works)
  let singleTouchPrevented = false;
  listeners["touchmove"][0].handler({
    touches: [{}],
    preventDefault() {
      singleTouchPrevented = true;
    },
  });
  assert.equal(
    singleTouchPrevented,
    false,
    "single-touch touchmove does not call preventDefault",
  );

  // Verify ctrlKey wheel calls preventDefault
  let ctrlWheelPrevented = false;
  listeners["wheel"][0].handler({
    ctrlKey: true,
    preventDefault() {
      ctrlWheelPrevented = true;
    },
  });
  assert.equal(ctrlWheelPrevented, true, "ctrlKey wheel calls preventDefault");

  // Verify normal wheel does NOT call preventDefault
  let normalWheelPrevented = false;
  listeners["wheel"][0].handler({
    ctrlKey: false,
    preventDefault() {
      normalWheelPrevented = true;
    },
  });
  assert.equal(
    normalWheelPrevented,
    false,
    "normal wheel does not call preventDefault",
  );
});
