// Botnoi Voice HTTP API (staging / production).
// Docs: https://voicebot-stg.botnoigroup.com/llms.txt
// Auth today is a console bearer token (BOTNOI_VOICE_TOKEN). API keys are
// not public yet per their docs.
import { env } from "./env.js";

export const BOTNOI_DEFAULT_BASE =
  "https://api-voicebot-stg.botnoigroup.com";

export function botnoiBaseUrl() {
  return env("BOTNOI_VOICE_API_BASE", BOTNOI_DEFAULT_BASE).replace(/\/$/, "");
}

export function botnoiToken() {
  return env("BOTNOI_VOICE_TOKEN") || env("BOTNOI_API_TOKEN");
}

export function botnoiConfigured() {
  return Boolean(botnoiToken());
}

/**
 * Call the Voice API. Throws Error with message `botnoi_<status>: …` on
 * non-2xx. Never logs the bearer token.
 */
export async function botnoiFetch(
  path,
  { method = "GET", body, token = botnoiToken(), fetchImpl = fetch } = {},
) {
  if (!token) throw new Error("missing_botnoi_token");
  const url = `${botnoiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(body != null ? { "content-type": "application/json" } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("botnoi_unreachable");
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
  }
  if (!res.ok) {
    const detail =
      (data && (data.detail || data.error || data.message)) ||
      text.slice(0, 200) ||
      res.statusText;
    const err = new Error(`botnoi_${res.status}: ${detail}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** POST /platform-config/tools — register http | mcp | function tools. */
export async function createTool(tool, opts) {
  return botnoiFetch("/platform-config/tools", {
    method: "POST",
    body: tool,
    ...opts,
  });
}

export async function listTools(opts) {
  return botnoiFetch("/platform-config/tools", opts);
}

export async function updateTool(toolId, tool, opts) {
  return botnoiFetch(`/platform-config/tools/${encodeURIComponent(toolId)}`, {
    method: "PUT",
    body: tool,
    ...opts,
  });
}

export async function deleteTool(toolId, opts) {
  return botnoiFetch(`/platform-config/tools/${encodeURIComponent(toolId)}`, {
    method: "DELETE",
    ...opts,
  });
}

/** PUT /agent/create_update_agent — preferred upsert. */
export async function createOrUpdateAgent(payload, opts) {
  return botnoiFetch("/agent/create_update_agent", {
    method: "PUT",
    body: payload,
    ...opts,
  });
}

export async function listAgents(opts) {
  return botnoiFetch("/agents", opts);
}

export async function getAgent(agentId, opts) {
  return botnoiFetch(`/agents/${encodeURIComponent(agentId)}`, opts);
}

/**
 * Build a CreateToolRequest for an MCP server.
 * Botnoi's OpenAPI only documents shared ToolExecution (HTTP-shaped); for MCP
 * we put the server URL in `execution.endpoint` and optional auth headers.
 */
export function mcpToolPayload({
  name,
  description = "",
  url,
  authHeader,
  authValue,
  status = "active",
}) {
  const headers = {};
  if (authHeader && authValue) headers[authHeader] = authValue;
  const isAuthorization = String(authHeader || "Authorization").toLowerCase() === "authorization";
  const token = String(authValue || "").replace(/^Bearer\s+/i, "");
  return {
    name: String(name).trim().slice(0, 80),
    description: String(description || `MCP server ${url}`).slice(0, 500),
    tool_type: "mcp",
    status,
    parameters: { type: "object", properties: {}, required: [] },
    execution: {
      method: "POST",
      endpoint: String(url).trim(),
      headers,
      timeout: 60,
      ...(authValue && isAuthorization
        ? {
            auth: {
              type: "bearer",
              api_key: token,
              header_name: authHeader || "Authorization",
            },
          }
        : {}),
    },
  };
}

/**
 * agent_data fragment that asks the voice runtime to use named tools.
 * Botnoi's agent schema is open-ended; we send both `tools` and `tool_names`
 * so either shape is accepted if the platform expects one of them.
 */
export function agentDataWithTools(base = {}, toolNames = []) {
  const names = [...new Set(toolNames.filter(Boolean))];
  return {
    ...base,
    tools: names.map((name) => ({ name })),
    tool_names: names,
  };
}
