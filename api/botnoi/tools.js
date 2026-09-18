import { json, jsonError, readJson } from "../../server/http.js";
import {
  BOTNOI_TOKEN_HINT,
  createTool,
  deleteTool,
  listTools,
  mcpToolPayload,
  resolveBotnoiToken,
  updateTool,
} from "../../server/botnoi.js";
import { requireAdmin } from "../../server/supabase.js";

/**
 * GET  /api/botnoi/tools — list platform tools on the Botnoi Voice account
 * POST /api/botnoi/tools — create a tool ({ tool_type, name, … } or mcp shortcut)
 *
 * Admins only. Uses BOTNOI_VOICE_TOKEN on the server.
 */
export async function GET(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const token = await resolveBotnoiToken(auth.client);
  if (!token) return jsonError("missing_botnoi_token", BOTNOI_TOKEN_HINT, 400);
  try {
    const tools = await listTools({ token });
    return json({ tools: Array.isArray(tools) ? tools : tools?.data ?? tools });
  } catch (err) {
    return botnoiError(err);
  }
}

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const token = await resolveBotnoiToken(auth.client);
  if (!token) return jsonError("missing_botnoi_token", BOTNOI_TOKEN_HINT, 400);
  const body = await readJson(request);
  try {
    let payload = body;
    if (body?.mcp === true || body?.tool_type === "mcp") {
      const name = String(body.name || "").trim();
      const url = String(body.url || body.endpoint || body.execution?.endpoint || "").trim();
      if (!name || !url)
        return jsonError("bad_request", "MCP tools need name and url.", 400);
      payload = mcpToolPayload({
        name,
        description: body.description,
        url,
        authHeader: body.authHeader || body.auth_header,
        authValue: body.authValue || body.auth_value || body.api_key,
        status: body.status || "active",
      });
    } else if (!body?.name || !body?.tool_type) {
      return jsonError("bad_request", "name and tool_type are required.", 400);
    }
    const created = await createTool(payload, { token });
    return json({ tool: created });
  } catch (err) {
    return botnoiError(err);
  }
}

export async function PUT(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const token = await resolveBotnoiToken(auth.client);
  if (!token) return jsonError("missing_botnoi_token", BOTNOI_TOKEN_HINT, 400);
  const body = await readJson(request);
  const toolId = String(body.toolId || body.tool_id || "").trim();
  if (!toolId) return jsonError("bad_request", "toolId is required.", 400);
  const { toolId: _a, tool_id: _b, ...rest } = body;
  try {
    const updated = await updateTool(toolId, rest, { token });
    return json({ tool: updated });
  } catch (err) {
    return botnoiError(err);
  }
}

export async function DELETE(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const token = await resolveBotnoiToken(auth.client);
  if (!token) return jsonError("missing_botnoi_token", BOTNOI_TOKEN_HINT, 400);
  const toolId = new URL(request.url).searchParams.get("toolId") || "";
  if (!toolId.trim())
    return jsonError("bad_request", "toolId query param is required.", 400);
  try {
    await deleteTool(toolId.trim(), { token });
    return json({ ok: true });
  } catch (err) {
    return botnoiError(err);
  }
}

function botnoiError(err) {
  const message = err instanceof Error ? err.message : "Botnoi request failed.";
  const status =
    err?.status === 401 || err?.status === 403
      ? err.status
      : /missing_botnoi/.test(message)
        ? 400
        : /unreachable/.test(message)
          ? 502
          : 500;
  return jsonError(message.split(":")[0], message, status);
}
