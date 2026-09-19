const assert = require("node:assert/strict");
const test = require("node:test");

test("a pet with the kit server calls the matching tool", async () => {
  const { chooseCall } = await import("../server/mcp-use.js");
  const server = {
    id: "kit",
    name: "ESP32",
    description: "Kit lights and sensors",
    when: "",
    tools: [
      { name: "get_kit_status", description: "Read temperature humidity and light", inputSchema: { type: "object", properties: {} } },
      { name: "set_led", description: "Turn an LED on or off", inputSchema: { type: "object", properties: { pin: { type: "integer" }, state: { type: "string" } } } },
      { name: "set_buzzer", description: "Turn the buzzer on or off", inputSchema: { type: "object", properties: { state: { type: "string" } } } },
      { name: "set_rgb", description: "Set the RGB color", inputSchema: { type: "object", properties: { color: { type: "string" } } } },
    ],
  };
  const led = chooseCall([server], "เปิดไฟ 15");
  assert.equal(led.tool, "set_led");
  assert.deepEqual(led.args, { pin: 15, state: "on" });
  const status = chooseCall([server], "อุณหภูมิเท่าไหร่");
  assert.equal(status.tool, "get_kit_status");
  assert.equal(chooseCall([server], "สวัสดี"), null);
});
