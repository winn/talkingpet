/** Minimal MCP client (Streamable HTTP, JSON or one-shot SSE). */

function assertPublicHttps(url) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    throw new Error("Tool URL is not valid.");
  }
  if (parsed.protocol !== "https:") throw new Error("Tool URL must be https.");
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    host.startsWith("172.16.") ||
    host.includes("metadata");
  if (blocked) throw new Error("Tool URL is not allowed.");
  return parsed.toString();
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream") || text.includes("\ndata:")) {
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    const last = events.at(-1);
    return last ? JSON.parse(last) : null;
  }
  return JSON.parse(text);
}

let rpcId = 1;

export async function mcpRpc(url, method, params, { headers = {}, sessionId = "", fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const endpoint = assertPublicHttps(url);
  const id = method.startsWith("notifications/") ? undefined : rpcId++;
  const message = {
    jsonrpc: "2.0",
    method,
    ...(id !== undefined ? { id } : {}),
    ...(params !== undefined ? { params } : {}),
  };
  const reqHeaders = new Headers(headers);
  reqHeaders.set("content-type", "application/json");
  reqHeaders.set("accept", "application/json, text/event-stream");
  if (!reqHeaders.has("mcp-protocol-version")) reqHeaders.set("mcp-protocol-version", "2025-03-26");
  if (sessionId) reqHeaders.set("mcp-session-id", sessionId);
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const nextSession = res.headers.get("mcp-session-id") || sessionId;
  if (res.status === 202 || res.status === 204) return { sessionId: nextSession, body: null };
  const body = await parseBody(res);
  if (!res.ok || body?.error) {
    throw new Error(body?.error?.message || `MCP error (${res.status}).`);
  }
  return { sessionId: nextSession, body };
}

export function mcpAuthHeaders(row) {
  const headers = {};
  const name = String(row?.auth_header || "").trim();
  const value = String(row?.auth_value || "").trim();
  if (name && value && name.length <= 80 && value.length <= 2000) headers[name] = value;
  return headers;
}

/** tools/list, opening a session first when the server requires one. */
export async function listRemoteTools(url, { headers = {}, fetchImpl = fetch } = {}) {
  try {
    const listed = await mcpRpc(url, "tools/list", {}, { headers, fetchImpl, timeoutMs: 8000 });
    const tools = listed.body?.result?.tools;
    if (Array.isArray(tools)) return { tools, sessionId: listed.sessionId };
  } catch {
    /* retry after initialize */
  }
  const init = await mcpRpc(
    url,
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "talkingmomo", version: "1.0.0" },
    },
    { headers, fetchImpl, timeoutMs: 8000 },
  );
  await mcpRpc(url, "notifications/initialized", undefined, {
    headers,
    sessionId: init.sessionId,
    fetchImpl,
    timeoutMs: 4000,
  }).catch(() => {});
  const listed = await mcpRpc(url, "tools/list", {}, {
    headers,
    sessionId: init.sessionId,
    fetchImpl,
    timeoutMs: 8000,
  });
  return { tools: listed.body?.result?.tools || [], sessionId: listed.sessionId || init.sessionId };
}

export async function callRemoteTool(url, name, args, { headers = {}, sessionId = "", fetchImpl = fetch } = {}) {
  const called = await mcpRpc(
    url,
    "tools/call",
    { name, arguments: args || {} },
    { headers, sessionId, fetchImpl, timeoutMs: 12000 },
  );
  return called.body?.result ?? null;
}
