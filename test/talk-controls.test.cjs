const test = require("node:test");
const assert = require("node:assert/strict");

const fakeGroup = () => ({
  rotation: { y: 0 },
  position: { x: 0, y: 0, z: -0.8 },
  scale: {
    x: 1,
    y: 1,
    z: 1,
    set(a, b, c) {
      this.x = a;
      this.y = b;
      this.z = c;
    },
  },
});

test("avatar api is detected only when the widget exposes its scene group", async () => {
  const { getAvatarApi } = await import("../src/talk-controls.js");
  assert.equal(getAvatarApi({}), null);
  assert.equal(getAvatarApi({ WebAvatar: {} }), null);
  const played = [];
  const emotions = [];
  const api = getAvatarApi({
    WebAvatar: {
      avatarGroup: fakeGroup(),
      isARMode: false,
      setEmotion: (name, weight) => emotions.push([name, weight]),
    },
    ChatWidget: { playAnimation: (name) => played.push(name) },
  });
  api.playAnimation("Waving");
  api.setEmotion("happy");
  assert.deepEqual(played, ["Waving"]);
  assert.deepEqual(emotions, [["happy", 1]]);
  assert.equal(api.isAr(), false);
  const bare = getAvatarApi({ WebAvatar: { avatarGroup: fakeGroup() } });
  assert.equal(bare.playAnimation, null);
  assert.equal(bare.setEmotion, null);
});

test("pose controller turns, moves within limits, zooms within limits and resets", async () => {
  const { createPoseController, POSE_LIMITS } =
    await import("../src/talk-controls.js");
  const group = fakeGroup();
  group.rotation.y = 0.25;
  const pose = createPoseController(group);
  pose.turnRadians(1);
  assert.ok(Math.abs(group.rotation.y - 1.25) < 1e-9);
  pose.move(10, -10);
  assert.equal(group.position.x, POSE_LIMITS.maxOffset);
  assert.equal(group.position.y, -POSE_LIMITS.maxOffset);
  pose.zoom(100);
  assert.equal(group.scale.x, POSE_LIMITS.maxScale);
  pose.zoom(0.0001);
  assert.equal(group.scale.z, POSE_LIMITS.minScale);
  pose.reset();
  assert.deepEqual(
    [group.rotation.y, group.position.x, group.position.y, group.scale.x],
    [0.25, 0, 0, 1],
  );
});

test("every talk action and face label has a Thai translation", async () => {
  const { TALK_ACTIONS, TALK_FACES } = await import("../src/talk-controls.js");
  const { TH } = await import("../src/locales/th.js");
  const ids = new Set();
  for (const item of [...TALK_ACTIONS, ...TALK_FACES]) {
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    assert.match(
      TH[item.label] || "",
      /[ก-๙]/,
      `missing Thai for ${item.label}`,
    );
  }
  for (const key of [
    "Moves",
    "Faces",
    "View",
    "Bigger",
    "Smaller",
    "Reset view",
    "Pet actions",
    "Hold and drag the pet to spin it · Pinch or wheel to resize · Double tap resets",
  ])
    assert.match(TH[key] || "", /[ก-๙]/, `missing Thai for ${key}`);
});
