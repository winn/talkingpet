const test = require("node:test");
const assert = require("node:assert/strict");

test("cat rubs pick meow or purr clips from the library", async () => {
  const { pickFamilyClips, pickRandomPetClip, resetSfxLibrary } =
    await import("../src/pet-sounds.js");
  resetSfxLibrary();
  const clips = [
    { cue: "meow", url: "a" },
    { cue: "playful_upbeat_meow", url: "b" },
    { cue: "purr", url: "c" },
    { cue: "warm_vibrating_purr", url: "d" },
    { cue: "bark", url: "e" },
    { cue: "sparkle", url: "f" },
  ];
  assert.deepEqual(
    pickFamilyClips(clips, "minicat", "meow").map((c) => c.cue),
    ["meow", "playful_upbeat_meow"],
  );
  assert.deepEqual(
    pickFamilyClips(clips, "minicat", "purr").map((c) => c.cue),
    ["purr", "warm_vibrating_purr"],
  );
  const meow = pickRandomPetClip(clips, "minicat", () => 0);
  assert.match(meow.cue, /meow|mew|purr/);
  const purrSide = pickRandomPetClip(clips, "minicat", () => 0.6);
  assert.match(purrSide.cue, /purr/);
});

test("dog rubs pick bark or pant clips", async () => {
  const { pickFamilyClips, pickRandomPetClip, resetSfxLibrary } =
    await import("../src/pet-sounds.js");
  resetSfxLibrary();
  const clips = [
    { cue: "bark", url: "a" },
    { cue: "puppy_happy_yip", url: "b" },
    { cue: "pant", url: "c" },
    { cue: "eager_dog_sniff", url: "d" },
    { cue: "meow", url: "e" },
  ];
  assert.equal(pickFamilyClips(clips, "minidog", "bark").length, 2);
  assert.equal(pickFamilyClips(clips, "minidog", "pant").length, 2);
  assert.equal(pickRandomPetClip(clips, "minidog_f", () => 0).cue, "bark");
});

test("petting motion waits for travel and cooldown before playing", async () => {
  const { notePettingMotion, resetSfxLibrary } = await import(
    "../src/pet-sounds.js"
  );
  resetSfxLibrary();
  const plays = [];
  const play = (type) => plays.push(type);
  assert.equal(
    notePettingMotion(40, "minicat", { now: 1000, play }),
    false,
  );
  assert.equal(
    notePettingMotion(60, "minicat", { now: 1000, play }),
    true,
  );
  assert.deepEqual(plays, ["minicat"]);
  assert.equal(
    notePettingMotion(200, "minicat", { now: 1200, play }),
    false,
  );
  assert.equal(
    notePettingMotion(200, "minicat", { now: 3000, play }),
    true,
  );
  assert.deepEqual(plays, ["minicat", "minicat"]);
});

test("petting motion still reacts when sound is busy", async () => {
  const { notePettingMotion, resetSfxLibrary, playClip } = await import(
    "../src/pet-sounds.js"
  );
  resetSfxLibrary();
  const reactions = [];
  playClip({ url: "about:blank" }, {
    AudioCtor: function FakeAudio() {
      this.paused = false;
      this.ended = false;
      this.volume = 1;
      this.play = () => Promise.resolve();
      this.pause = () => {
        this.paused = true;
      };
      this.addEventListener = () => {};
    },
  });
  assert.equal(
    notePettingMotion(200, "minicat", {
      now: 5000,
      play: () => reactions.push("sound"),
      react: () => reactions.push("react"),
    }),
    true,
  );
  assert.deepEqual(reactions, ["react"]);
});

test("petting tap fires a one-shot reaction with cooldown", async () => {
  const { notePettingTap, resetSfxLibrary } = await import(
    "../src/pet-sounds.js"
  );
  resetSfxLibrary();
  const plays = [];
  assert.equal(
    notePettingTap("minicat", {
      now: 1000,
      play: () => plays.push("a"),
      react: () => plays.push("r"),
    }),
    true,
  );
  assert.deepEqual(plays, ["a", "r"]);
  assert.equal(
    notePettingTap("minicat", {
      now: 1200,
      play: () => plays.push("a2"),
      react: () => plays.push("r2"),
    }),
    false,
  );
});

test("hover rub tracks mouse move without a held button", async () => {
  const { attachHoverRub, resetSfxLibrary } = await import(
    "../src/pet-sounds.js"
  );
  resetSfxLibrary();
  const moves = [];
  const el = {
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    removeEventListener(type) {
      delete this.listeners[type];
    },
  };
  const rub = attachHoverRub(el, { onRub: (d) => moves.push(d) });
  el.listeners.pointermove({
    pointerType: "mouse",
    buttons: 0,
    clientX: 0,
    clientY: 0,
  });
  el.listeners.pointermove({
    pointerType: "mouse",
    buttons: 0,
    clientX: 30,
    clientY: 40,
  });
  assert.deepEqual(moves, [50]);
  el.listeners.pointermove({
    pointerType: "mouse",
    buttons: 1,
    clientX: 130,
    clientY: 40,
  });
  assert.deepEqual(moves, [50]);
  rub.detach();
});
