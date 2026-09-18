import { callRemoteTool, listRemoteTools, mcpAuthHeaders } from "./mcp-client.js";
import { mapSampleArgs, pickTool, toolResultText } from "./mcp-use.js";

/** List the server's tools, then call the one that matches the description. */
export async function runMcpTest({
  url,
  description = "",
  parameters = {},
  sample = {},
  authHeader = "",
  authValue = "",
  fetchImpl = fetch,
} = {}) {
  const headers = mcpAuthHeaders({ auth_header: authHeader, auth_value: authValue });
  const listed = await listRemoteTools(url, { headers, fetchImpl });
  const tools = Array.isArray(listed.tools) ? listed.tools : [];
  const names = tools.map((tool) => tool?.name).filter(Boolean);
  const blob = [description, ...Object.values(sample || {}).map((value) => String(value || ""))].filter(Boolean).join("\n");
  const tool = pickTool(tools, blob, description);
  if (!tool?.name) return { ok: true, tools: names, tool: null, arguments: {}, result: "" };
  const args = mapSampleArgs(tool, parameters, sample);
  const result = await callRemoteTool(url, tool.name, args, {
    headers,
    sessionId: listed.sessionId,
    fetchImpl,
  });
  const text = toolResultText(result);
  if (result?.isError) {
    return { ok: false, tools: names, tool: tool.name, arguments: args, error: text || "Tool failed." };
  }
  return { ok: true, tools: names, tool: tool.name, arguments: args, result: text };
}
