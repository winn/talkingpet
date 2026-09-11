const test = require("node:test");
const assert = require("node:assert/strict");
test("facial alpha holes let painting reach skin while visible eyes block it", async () => {
  const { DataTexture, Vector2 } = await import("three");
  const { pickPaintIntersection } = await import("../src/projected-paint.js");
  const texture = new DataTexture(
    new Uint8Array([255, 255, 255, 0, 255, 255, 255, 255]),
    2,
    1,
  );
  texture.flipY = false;
  const face = {
    visible: true,
    material: { name: "Eye", opacity: 1, alphaTest: 0.5, map: texture },
  };
  const skin = { visible: true, material: { name: "Head", opacity: 1 } };
  const hit = (object, x) => ({ object, uv: new Vector2(x, 0.5) });
  assert.equal(
    pickPaintIntersection(
      [hit(face, 0.1), hit(skin, 0.1)],
      (name) => name === "Head",
    ).object,
    skin,
  );
  assert.equal(
    pickPaintIntersection(
      [hit(face, 0.9), hit(skin, 0.9)],
      (name) => name === "Head",
    ),
    null,
  );
});
test("a fast projected stroke follows intermediate screen positions and retains pen samples", async () => {
  const { createProjectedStroke } = await import("../src/projected-paint.js");
  const points = [];
  const stroke = createProjectedStroke({
    project: (p) => p,
    start: (p) => points.push(p),
    move: (p) => points.push(p),
    finish() {},
    cancel() {},
  });
  stroke.start({ clientX: 0, clientY: 0 });
  stroke.move({
    clientX: 20,
    clientY: 0,
    getCoalescedEvents: () => [{ clientX: 10, clientY: 10 }],
  });
  stroke.end({ clientX: 24, clientY: 0 });
  assert(points.some((p) => p.clientX === 10 && p.clientY === 10));
  assert.equal(points.at(-1).clientX, 24);
  for (let i = 1; i < points.length; i++)
    assert(
      Math.hypot(
        points[i].clientX - points[i - 1].clientX,
        points[i].clientY - points[i - 1].clientY,
      ) <= 2.01,
    );
});
