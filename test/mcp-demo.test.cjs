const assert = require("node:assert/strict");
const test = require("node:test");

const quiet = { log() {} };

function rpc(method, params, id = 1) {
  return new Request("http://localhost/api/mcp/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

test("demo mcp handshake and tool listing", async () => {
  const { POST } = await import("../api/mcp/demo.js");

  const init = await (await POST(rpc("initialize", { protocolVersion: "2025-06-18" }))).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "talkingmomo-demo");

  const list = await (await POST(rpc("tools/list"))).json();
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ["get_weather", "roll_dice", "get_secret_word"],
  );

  const notified = await POST(
    new Request("http://localhost/api/mcp/demo", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }),
  );
  assert.equal(notified.status, 202);
});

test("demo mcp tools", async () => {
  const { handleRpc, secretWord } = await import("../server/mcp-demo.js");
  const call = (name, args, opts = quiet) =>
    handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, opts);

  const dice = await call("roll_dice", { sides: 6, count: 2 });
  assert.match(dice.result.content[0].text, /^Rolled 2d6: \d, \d \(total \d+\)\.$/);

  const secret = await call("get_secret_word", {});
  assert.ok(secret.result.content[0].text.includes(secretWord()));

  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("geocoding")
        ? { results: [{ name: "Bangkok", country: "Thailand", latitude: 13.75, longitude: 100.5 }] }
        : {
            current: {
              temperature_2m: 31,
              apparent_temperature: 37,
              relative_humidity_2m: 70,
              weather_code: 2,
              wind_speed_10m: 9,
            },
            daily: {
              time: ["2026-09-18"],
              weather_code: [95],
              temperature_2m_min: [26],
              temperature_2m_max: [33],
              precipitation_probability_max: [80],
            },
          },
  });
  const weather = await call("get_weather", { city: "Bangkok" }, { ...quiet, fetchImpl });
  const report = weather.result.content[0].text;
  assert.match(report, /Bangkok, Thailand/);
  assert.match(report, /partly cloudy, 31°C/);
  assert.match(report, /thunderstorm, 26–33°C, rain chance 80%/);

  const missing = await call("get_weather", {}, quiet);
  assert.equal(missing.result.isError, true);
});
