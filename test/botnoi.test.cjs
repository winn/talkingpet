const assert = require("node:assert/strict");
const test = require("node:test");

test("mcp tool payload and agent tool wiring", async () => {
  const { mcpToolPayload, agentDataWithTools, botnoiConfigured } =
    await import("../server/botnoi.js");

  assert.equal(botnoiConfigured(), false);

  const tool = mcpToolPayload({
    name: "github",
    description: "GitHub MCP",
    url: "https://mcp.example.com/sse",
    authHeader: "Authorization",
    authValue: "secret",
  });
  assert.equal(tool.tool_type, "mcp");
  assert.equal(tool.name, "github");
  assert.equal(tool.execution.endpoint, "https://mcp.example.com/sse");
  assert.equal(tool.execution.auth.api_key, "secret");
  assert.deepEqual(tool.parameters.required, []);

  const withParams = mcpToolPayload({
    name: "weather",
    description: "Weather",
    url: "https://example.com/mcp",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City" } },
      required: ["city"],
    },
  });
  assert.deepEqual(withParams.parameters.required, ["city"]);
  assert.equal(withParams.parameters.properties.city.description, "City");
  const hinted = mcpToolPayload({
    name: "weather",
    description: "Weather",
    url: "https://example.com/mcp",
    parameterHint: "province name and the date",
  });
  assert.match(hinted.description, /What to send: province name and the date/);

  const data = agentDataWithTools({ language: "th" }, ["tm_abc_github", ""]);
  assert.deepEqual(data.tool_names, ["tm_abc_github"]);
  assert.deepEqual(data.tools, [{ name: "tm_abc_github" }]);
  assert.equal(data.language, "th");
});

test("mcp parameters and pet call instructions", async () => {
  const { normalizeParameters, mcpPromptAppendix } = await import("../server/mcp.js");
  const schema = normalizeParameters(
    '{"type":"object","properties":{"city":{"type":"string","description":"City name"}},"required":["city","nope"]}',
  );
  assert.deepEqual(schema.required, ["city"]);
  assert.equal(schema.properties.city.description, "City name");
  assert.throws(() => normalizeParameters("{"), /JSON/);

  const prompt = mcpPromptAppendix([
    {
      name: "weather",
      description: "Current weather",
      when: "they ask about the weather",
      parameter_hint: "province name and the date to check",
      parameters: schema,
    },
  ]);
  assert.match(prompt, /Call only when: they ask about the weather/);
  assert.match(prompt, /Send: province name and the date to check/);
});

test("saved Botnoi token is used like the other AI keys", async () => {
  const { resolveBotnoiToken } = await import("../server/botnoi.js");
  const { verifyKey } = await import("../server/settings.js");
  delete process.env.BOTNOI_VOICE_TOKEN;
  delete process.env.BOTNOI_API_TOKEN;
  const fake = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { value: "savedtoken1234", updated_at: null, updated_by: null },
            error: null,
          }),
        }),
      }),
    }),
  };
  assert.equal(await resolveBotnoiToken(fake), "savedtoken1234");
  await verifyKey("botnoi", "token", async (url, init) => {
    assert.match(String(url), /\/platform-config\/tools$/);
    assert.match(init.headers.authorization, /^Bearer token$/);
    return { ok: true, status: 200 };
  });
  await assert.rejects(
    verifyKey("botnoi", "nope", async () => ({ ok: false, status: 401, json: async () => ({}) })),
    /invalid_key/,
  );
});

test("pet agent uses the Talking Jelly live envelope", async () => {
  const { buildPetAgentData, extractAgentId, petVoiceData, attachMcpConnections } =
    await import("../server/botnoi.js");
  const data = buildPetAgentData({
    personality: "You are Noodle. Stay playful.",
    greeting: "You are Noodle.",
    language: "th",
    toolNames: ["tm_weather"],
  });
  assert.equal(data.select_agent, "gemini_live");
  assert.equal(data.engine_type, "voice2voice");
  assert.equal(data.gemini_live_model, "models/gemini-3.1-flash-live-preview");
  assert.match(data.system_instruction, /You are Noodle/);
  assert.equal(data.greeting_text, "You are Noodle.");
  assert.deepEqual(data.tool_names, ["tm_weather"]);
  assert.equal(petVoiceData("th").provider, "botnoivoice");
  assert.equal(petVoiceData("th").speaker_id, "1");
  assert.equal(petVoiceData("th").language, "th");
  assert.equal(extractAgentId({ bot_info: { agent_id: "agt_1" } }), "agt_1");

  const calls = [];
  const bound = await attachMcpConnections(
    "agt_1",
    [{ name: "weather", url: "https://example.com/mcp" }],
    {
      token: "t",
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init.method, body: init.body });
        if (String(url).endsWith("/mcp/connections") && init.method === "GET") {
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
        }
        if (String(url).endsWith("/mcp/connections") && init.method === "POST") {
          return new Response(
            JSON.stringify({ id: "conn_1", tools: [{ name: "get_weather" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  );
  assert.equal(bound[0].connectionId, "conn_1");
  assert.deepEqual(bound[0].toolNames, ["get_weather"]);
  assert.ok(calls.some((call) => call.method === "POST" && String(call.body).includes("server_url")));
  assert.ok(calls.some((call) => call.method === "PUT" && call.url.includes("/mcp/agents/agt_1/connections/conn_1")));
});

test("an existing agent keeps the voice and prompt edited in the console", async () => {
  const { consolePreservingPayload, readStoredAgent } = await import("../server/botnoi.js");
  const stored = readStoredAgent({
    bot_info: {
      bot_name: "Noodle",
      agent_id: "agt_9",
      voice_data: { provider: "botnoivoice", speaker_id: "42", language: "th" },
      agent_data: {
        select_agent: "gemini_live",
        system_instruction: "Speak like a cat.",
        model: "custom-model",
        tool_names: ["console_tool"],
      },
    },
  });
  const payload = consolePreservingPayload(
    {
      bot_name: "tm_default",
      agent_id: "agt_9",
      voice_data: { provider: "botnoivoice", speaker_id: "1", language: "en" },
      agent_data: { system_instruction: "default", model: "gemini-3.1-flash-live-preview" },
    },
    stored,
    ["tm_weather"],
  );
  assert.equal(payload.bot_name, "Noodle");
  assert.equal(payload.voice_data.speaker_id, "42");
  assert.equal(payload.voice_data.language, "th");
  assert.equal(payload.agent_data.system_instruction, "Speak like a cat.");
  assert.equal(payload.agent_data.model, "custom-model");
  assert.deepEqual(payload.agent_data.tool_names, ["console_tool", "tm_weather"]);
});
