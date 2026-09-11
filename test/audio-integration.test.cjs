// End-to-end check of the admin audio path against the real Supabase project:
// admin session → key saved in app_settings → /api/admin/sfx → stub ElevenLabs
// → storage upload under RLS → row insert → public URL. Skips without .env.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");

function loadDotEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
  return env;
}

const dotenv = loadDotEnv();
const haveCreds = dotenv.VITE_SUPABASE_URL && dotenv.VITE_SUPABASE_PUBLISHABLE_KEY && dotenv.E2E_EMAIL && dotenv.E2E_PASSWORD;

test("admin sfx generation stores a clip through RLS (stubbed ElevenLabs)", { skip: !haveCreds && "needs .env with Supabase and E2E credentials" }, async () => {
  Object.assign(process.env, dotenv);
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(dotenv.VITE_SUPABASE_URL, dotenv.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email: dotenv.E2E_EMAIL,
    password: dotenv.E2E_PASSWORD,
  });
  assert.equal(signInError, null);
  const token = signIn.session.access_token;
  const asAdmin = createClient(dotenv.VITE_SUPABASE_URL, dotenv.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Stub ElevenLabs: /v1/user accepts the key, /v1/sound-generation returns bytes.
  const stub = http.createServer((req, res) => {
    if (req.url === "/v1/user") {
      res.writeHead(req.headers["xi-api-key"] === "stub_key_1234567890" ? 200 : 401, { "content-type": "application/json" });
      return res.end("{}");
    }
    if (req.url === "/v1/sound-generation") {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(Buffer.from("ID3stubaudio"));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => stub.listen(0, r));
  process.env.ELEVENLABS_API_BASE = `http://127.0.0.1:${stub.address().port}`;

  const call = async (mod, method, body, query) => {
    const m = await import(`../api/admin/${mod}.js`);
    const url = `http://localhost/api/admin/${mod}${query ? `?${query}` : ""}`;
    const req = new Request(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const res = await m[method](req);
    return { status: res.status, body: await res.json() };
  };

  const cue = `t_${Date.now().toString(36)}`;
  let clip;
  try {
    const saved = await call("keys", "POST", { provider: "elevenlabs", action: "save", key: "stub_key_1234567890" });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.source, "database");
    assert.equal(saved.body.last4, "7890");

    const status = await call("keys", "GET", null, "provider=elevenlabs");
    assert.equal(status.body.source, "database");

    const made = await call("sfx", "POST", { title: "Test meow", prompt: `A test cat meow [${cue}]`, durationMs: 1000, tags: ["test"] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    clip = made.body.clip;
    assert.equal(clip.cue, cue);
    assert.equal(clip.prompt, `A test cat meow [${cue}]`);

    const publicUrl = `${dotenv.VITE_SUPABASE_URL}/storage/v1/object/public/sfx/${clip.storage_path}`;
    const audio = await fetch(publicUrl);
    assert.equal(audio.status, 200);
    assert.equal(Buffer.from(await audio.arrayBuffer()).toString(), "ID3stubaudio");

    const dup = await call("sfx", "POST", { title: "Dup", prompt: `Another [${cue}]`, durationMs: 1000 });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error, /sfx_cue_taken/);

    const unauth = await (await import("../api/admin/sfx.js")).POST(new Request("http://localhost/api/admin/sfx", { method: "POST", body: "{}" }));
    assert.equal(unauth.status, 403);
  } finally {
    if (clip) {
      await asAdmin.from("sfx_clips").delete().eq("id", clip.id);
      await asAdmin.storage.from("sfx").remove([clip.storage_path]);
    }
    await call("keys", "POST", { provider: "elevenlabs", action: "remove" });
    stub.close();
    delete process.env.ELEVENLABS_API_BASE;
  }
});
