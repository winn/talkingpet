const assert = require("node:assert/strict");
const test = require("node:test");

test("esp32 mcp lists the kit tools and calls only documented paths", async () => {
  const { handleRpc, ledPath, buzzerPath, rgbPath } = await import("../server/esp32-mcp.js");

  const listed = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    ["get_kit_status", "set_led", "set_buzzer", "set_rgb"],
  );

  assert.equal(ledPath({ pin: 15, state: "on" }), "/api/led?pin=15&state=on");
  assert.equal(ledPath({ pin: 17 }), "/api/led?pin=17&state=toggle");
  assert.throws(() => ledPath({ pin: 4 }), /15, 16, or 17/);
  assert.equal(buzzerPath({ state: "off" }), "/api/buzzer?state=off");
  assert.equal(rgbPath({ color: "cyan" }), "/api/rgb?color=cyan");
  assert.equal(rgbPath({ hex: "#ff00ff" }), "/api/rgb?hex=FF00FF");
  assert.equal(rgbPath({ r: 255, g: 0, b: 128 }), "/api/rgb?r=255&g=0&b=128");

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          temperature: 29.5,
          humidity: 70,
          ldr: 1453,
          led_15: false,
          led_16: true,
          led_17: false,
          buzzer: false,
          rgb: { state: true, hex: "#FF0080" },
        }),
    };
  };
  const status = await handleRpc(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_kit_status", arguments: {} } },
    { fetchImpl },
  );
  assert.match(calls[0], /\/api\/status$/);
  assert.match(status.result.content[0].text, /29\.5°C/);
  assert.equal(status.result.isError, false);

  const bad = await handleRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "set_led", arguments: { pin: 4, state: "on" } },
  });
  assert.equal(bad.result.isError, true);
});
