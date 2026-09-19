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
  assert.equal(tool.execution.headers.Authorization, "secret");

  const exact = mcpToolPayload({
    name: "weather",
    url: "https://example.com/mcp",
    authHeader: "Authorization",
    authValue: "Bearer token",
  });
  assert.equal(exact.execution.auth.api_key, "token");
  assert.equal(exact.execution.headers.Authorization, "Bearer token");

  const keyed = mcpToolPayload({
    name: "weather",
    url: "https://example.com/mcp",
    authHeader: "X-API-Key",
    authValue: "abc",
  });
  assert.equal(keyed.execution.headers["X-API-Key"], "abc");
  assert.equal(keyed.execution.auth, undefined);

  const data = agentDataWithTools({ language: "th" }, ["tm_abc_github", ""]);
  assert.deepEqual(data.tool_names, ["tm_abc_github"]);
  assert.deepEqual(data.tools, [{ name: "tm_abc_github" }]);
  assert.equal(data.language, "th");
});
