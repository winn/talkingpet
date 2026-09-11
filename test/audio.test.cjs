const test = require("node:test");
const assert = require("node:assert/strict");

test("sfx prompts split into text and cue, and cues derive from titles", async () => {
  const { splitSfxPrompt, cueFromTitle, withCueTag, CUE_RE } = await import("../server/audio.js");
  assert.deepEqual(splitSfxPrompt("A small cat meowing once [meow]"), { text: "A small cat meowing once", cue: "meow" });
  assert.deepEqual(splitSfxPrompt("No tag here"), { text: "No tag here", cue: null });
  assert.equal(cueFromTitle("Paws Crawling!"), "paws_crawling");
  assert.match(cueFromTitle("แมวร้อง"), /^sfx_[a-z0-9]{8}$/);
  assert.equal(withCueTag("Rain on glass [old]", "rain"), "Rain on glass [rain]");
  assert.ok(CUE_RE.test("cozy_room2"));
  assert.ok(!CUE_RE.test("Cozy Room"));
});

test("composeSfx and composeMusic call ElevenLabs and surface its errors", async () => {
  const { composeSfx, composeMusic } = await import("../server/audio.js");
  const calls = [];
  const okFetch = async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const clip = await composeSfx({ apiKey: "k", text: "A cat meowing", durationMs: 1500, fetchImpl: okFetch });
  assert.equal(clip.byteLength, 3);
  assert.equal(calls[0][0], "https://api.elevenlabs.io/v1/sound-generation");
  assert.deepEqual(calls[0][1], { text: "A cat meowing", duration_seconds: 1.5, model_id: "eleven_text_to_sound_v2", output_format: "mp3_44100_128" });
  await composeMusic({ apiKey: "k", prompt: "gentle ukulele", durationMs: 60000, fetchImpl: okFetch });
  assert.equal(calls[1][0], "https://api.elevenlabs.io/v1/music");
  assert.equal(calls[1][1].force_instrumental, true);
  assert.equal(calls[1][1].music_length_ms, 60000);

  const denied = async () => ({ ok: false, status: 401, text: async () => "nope" });
  await assert.rejects(composeSfx({ apiKey: "bad", text: "x", durationMs: 1000, fetchImpl: denied }), /invalid_key/);
  const quota = async () => ({ ok: false, status: 402, text: async () => "quota exceeded" });
  await assert.rejects(composeMusic({ apiKey: "k", prompt: "x", durationMs: 30000, fetchImpl: quota }), /elevenlabs_failed: 402 quota/);
  const down = async () => { throw new Error("ECONNRESET"); };
  await assert.rejects(composeSfx({ apiKey: "k", text: "x", durationMs: 1000, fetchImpl: down }), /elevenlabs_unreachable/);
});

test("normalizePlan clamps lengths, tags cues, and avoids taken cues", async () => {
  const { normalizePlan } = await import("../server/audio.js");
  const sfx = normalizePlan("sfx", {
    clips: [
      { title: "Cat meow", prompt: "A cat meowing once [meow]", seconds: 1.5, tags: ["cat"] },
      { title: "Dog bark", prompt: "A dog barking", seconds: 99, tags: [] },
      { title: "", prompt: "x", seconds: 1, tags: [] },
    ],
  }, { count: 5, takenCues: ["meow"] });
  assert.equal(sfx.length, 2);
  assert.match(sfx[0].cue, /^meow_[a-z0-9]{4}$/);
  assert.equal(sfx[0].prompt, `A cat meowing once [${sfx[0].cue}]`);
  assert.equal(sfx[1].cue, "dog_bark");
  assert.equal(sfx[1].durationMs, 30000);
  const music = normalizePlan("music", { tracks: [{ title: "Sunny", prompt: "ukulele and bells, no vocals", seconds: 1, mood: "happy", tags: ["a", "a", "b"] }] }, { count: 1 });
  assert.equal(music[0].durationMs, 10000);
  assert.deepEqual(music[0].tags, ["a", "b"]);
});

test("provider keys: stored key wins, env falls back, and verification maps statuses", async () => {
  const { describeProviderKey, getProviderKey, verifyKey } = await import("../server/settings.js");
  const fakeClient = (row) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  });
  process.env.ELEVENLABS_API_KEY = "";
  await assert.rejects(getProviderKey(fakeClient(null), "elevenlabs"), /missing_elevenlabs_key/);
  process.env.ELEVENLABS_API_KEY = "envkey1234";
  assert.equal(await getProviderKey(fakeClient(null), "elevenlabs"), "envkey1234");
  assert.equal(await getProviderKey(fakeClient({ value: "dbkey5678", updated_at: "2026-09-11", updated_by: null }), "elevenlabs"), "dbkey5678");
  const status = await describeProviderKey(fakeClient({ value: "dbkey5678", updated_at: "2026-09-11", updated_by: null }), "elevenlabs");
  assert.deepEqual(status, { provider: "elevenlabs", source: "database", last4: "5678", updatedAt: "2026-09-11", envFallbackAvailable: true });
  delete process.env.ELEVENLABS_API_KEY;

  await verifyKey("elevenlabs", "k", async () => ({ ok: true, status: 200 }));
  await verifyKey("elevenlabs", "k", async () => ({ ok: false, status: 401, json: async () => ({ detail: { status: "missing_permissions" } }) }));
  await assert.rejects(verifyKey("gemini", "k", async () => ({ ok: false, status: 400, json: async () => ({}) })), /invalid_key/);
  await assert.rejects(verifyKey("gemini", "k", async () => { throw new Error("down"); }), /verify_unreachable/);
});
