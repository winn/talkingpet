const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// Drives the Vite dev plugin's middleware with a bare Node server so the
// Web-handler bridge is covered without starting Vite.
async function withPlugin(run) {
  const { devApi } = await import("../tools/dev-api.js");
  const plugin = devApi();
  let middleware;
  plugin.configureServer({
    middlewares: { use: (fn) => (middleware = fn) },
    ssrLoadModule: async (id) => import(`..${id}`),
  });
  const server = http.createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 418;
      res.end("next");
    }),
  );
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
  }
}

test("dev api serves Web-handler functions from /api", async () => {
  await withPlugin(async (base) => {
    const res = await fetch(`${base}/api/billing-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.configured, "boolean");
  });
});

test("dev api passes non-api requests through and 404s unknown routes", async () => {
  await withPlugin(async (base) => {
    assert.equal((await fetch(`${base}/index.html`)).status, 418);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/billing-status`, { method: "DELETE" })).status, 405);
  });
});

test("register validates input before touching Supabase", async () => {
  await withPlugin(async (base) => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nope", password: "short" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "valid_email");
  });
});

test("checkout requires a signed-in user", async () => {
  await withPlugin(async (base) => {
    const res = await fetch(`${base}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packId: "pack_small" }),
    });
    assert.equal(res.status, 401);
  });
});

test("webhook rejects unsigned calls", async () => {
  await withPlugin(async (base) => {
    const res = await fetch(`${base}/api/stripe/webhook`, { method: "POST", body: "{}" });
    assert.ok([400, 503].includes(res.status));
  });
});
