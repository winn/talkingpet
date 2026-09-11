const test = require("node:test");
const assert = require("node:assert/strict");
test("camera controls allow two-finger rotation and pinch zoom", async () => {
  const { configureOrbitControls } = await import("../src/camera-controls.js");
  const controls = {};
  configureOrbitControls(controls, {
    MOUSE: { ROTATE: 0, PAN: 2 },
    TOUCH: { ROTATE: 0, DOLLY_ROTATE: 3 },
  });
  assert.equal(controls.touches.TWO, 3);
  assert.equal(controls.mouseButtons.LEFT, 0);
  assert.equal(controls.enableZoom, true);
});
