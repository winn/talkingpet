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
      parameters: schema,
    },
  ]);
  assert.match(prompt, /Call only when: they ask about the weather/);
  assert.match(prompt, /city \(string, required\)/);
});
