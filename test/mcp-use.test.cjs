const assert = require("node:assert/strict");
const test = require("node:test");

test("pet when-clause matches weather talk and picks get_weather", async () => {
  const { textMatchesWhen, pickTool, chooseCall, placeQuery, buildArguments } = await import(
    "../server/mcp-use.js"
  );

  const when = "หากโดนถามว่าอากาศดีมั้ย ฝนตกมั้ย หรือถามสภาพอากาศ";
  assert.equal(textMatchesWhen("วันนี้อากาศเป็นไง", when), true);
  assert.equal(textMatchesWhen("ฝนจะตกไหม", when), true);
  assert.equal(textMatchesWhen("สวัสดีครับ", when), false);

  const tools = [
    {
      name: "get_weather",
      description: "Current weather and rain for a city.",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string", description: "City name" } },
        required: ["city"],
      },
    },
    { name: "roll_dice", description: "Roll dice.", inputSchema: { type: "object", properties: {} } },
    { name: "get_secret_word", description: "Secret word.", inputSchema: { type: "object", properties: {} } },
  ];
  assert.equal(pickTool(tools, "วันนี้อากาศเป็นไง", when).name, "get_weather");

  const choice = chooseCall(
    [{ id: "s1", name: "weather", description: "บอกสภาพอากาศ", when, tools }],
    "วันนี้อากาศที่เชียงใหม่เป็นไง",
  );
  assert.equal(choice.tool, "get_weather");
  assert.equal(choice.args.city, "เชียงใหม่");
  assert.equal(choice.assumedPlace, false);

  const assumed = buildArguments(tools[0], "อากาศดีมั้ย");
  assert.equal(assumed.args.city, "Bangkok");
  assert.equal(assumed.assumedPlace, true);

  assert.deepEqual(placeQuery("Bangkok"), { query: "Bangkok", assumed: false });
  assert.equal(placeQuery("").query, "");
});

test("mcp client parses a stateless tools/list", async () => {
  const { listRemoteTools, callRemoteTool } = await import("../server/mcp-client.js");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body).method);
    assert.equal(String(url).startsWith("https://"), true);
    const method = JSON.parse(init.body).method;
    if (method === "tools/list") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "" },
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { tools: [{ name: "get_weather", description: "weather", inputSchema: { type: "object", properties: {} } }] },
          }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: "Sunny, 31°C." }] },
        }),
    };
  };
  const listed = await listRemoteTools("https://www.talkingmomo.com/api/mcp/demo", { fetchImpl });
  assert.equal(listed.tools[0].name, "get_weather");
  const result = await callRemoteTool("https://www.talkingmomo.com/api/mcp/demo", "get_weather", { city: "Bangkok" }, { fetchImpl });
  assert.match(result.content[0].text, /31°C/);
  assert.deepEqual(calls, ["tools/list", "tools/call"]);
});
