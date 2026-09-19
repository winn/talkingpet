import { json, jsonError, readJson } from "../../server/http.js";
import {
  botnoiConfigured,
  createTool,
  deleteTool,
  mcpToolPayload,
  updateTool,
} from "../../server/botnoi.js";
import { adminClient, userClient, userFromRequest } from "../../server/supabase.js";

/** Service role when present; otherwise the signed-in user, enforced by RLS. */
function dbFor(request) {
  return adminClient() ?? userClient(request);
}

/**
 * User-facing MCP connections for their pets.
 *
 * GET  /api/mcp/servers — list (no secrets)
 * POST /api/mcp/servers — create + register as Botnoi tool_type=mcp
 * PUT  /api/mcp/servers — update + re-sync
 * DELETE /api/mcp/servers?id= — remove locally and on Botnoi when possible
 */
export async function GET(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  const admin = dbFor(request);
  if (!admin) return jsonError("not_configured", "Server is not configured.", 500);
  const { data, error } = await admin
    .from("mcp_servers")
    .select(
      "id, name, description, url, auth_header, botnoi_tool_id, botnoi_tool_name, status, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return jsonError("db", error.message, 500);
  return json({ servers: data ?? [] });
}

export async function POST(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  const admin = dbFor(request);
  if (!admin) return jsonError("not_configured", "Server is not configured.", 500);

  const body = await readJson(request);
  const name = sanitizeName(body.name);
  const url = httpsUrl(body.url);
  if (!name || !String(body.url || "").trim())
    return jsonError("bad_request", "name and url are required.", 400);
  if (!url) return jsonError("bad_request", "MCP server URL must start with https.", 400);
  const description = String(body.description || "").trim().slice(0, 500);
  const header = cleanHeader(body);
  if (header.error) return jsonError("bad_request", header.error, 400);
  const { authHeader, authValue } = header;
  const toolName = botnoiToolName(user.id, name);

  let botnoiToolId = null;
  if (botnoiConfigured()) {
    try {
      const created = await createTool(
        mcpToolPayload({
          name: toolName,
          description,
          url,
          authHeader,
          authValue,
        }),
      );
      botnoiToolId = extractToolId(created);
    } catch (err) {
      return botnoiError(err);
    }
  }

  const { data, error } = await admin
    .from("mcp_servers")
    .insert({
      user_id: user.id,
      name,
      description,
      url,
      auth_header: authHeader,
      auth_value: authValue,
      botnoi_tool_id: botnoiToolId,
      botnoi_tool_name: toolName,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .select(
      "id, name, description, url, auth_header, botnoi_tool_id, botnoi_tool_name, status, created_at, updated_at",
    )
    .single();
  if (error) {
    if (botnoiToolId) {
      try {
        await deleteTool(botnoiToolId);
      } catch {}
    }
    return jsonError("db", error.message, 500);
  }
  return json({ server: data });
}

export async function PUT(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  const admin = dbFor(request);
  if (!admin) return jsonError("not_configured", "Server is not configured.", 500);
  if (!botnoiConfigured())
    return jsonError(
      "missing_botnoi_token",
      "Set BOTNOI_VOICE_TOKEN on the server first.",
      400,
    );

  const body = await readJson(request);
  const id = String(body.id || "").trim();
  if (!id) return jsonError("bad_request", "id is required.", 400);

  const { data: existing, error: readError } = await admin
    .from("mcp_servers")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return jsonError("db", readError.message, 500);
  if (!existing) return jsonError("not_found", "MCP server not found.", 404);

  const name = body.name != null ? sanitizeName(body.name) : existing.name;
  const url = body.url != null ? String(body.url).trim() : existing.url;
  const description =
    body.description != null
      ? String(body.description).trim().slice(0, 500)
      : existing.description;
  const authHeader =
    body.authHeader != null || body.auth_header != null
      ? String(body.authHeader || body.auth_header || "").trim() || null
      : existing.auth_header;
  const authValue =
    body.authValue != null || body.auth_value != null || body.api_key != null
      ? String(body.authValue || body.auth_value || body.api_key || "").trim() || null
      : existing.auth_value;
  const status = body.status === "inactive" ? "inactive" : "active";
  const toolName = existing.botnoi_tool_name || botnoiToolName(user.id, name);
  const payload = mcpToolPayload({
    name: toolName,
    description,
    url,
    authHeader,
    authValue,
    status,
  });

  try {
    if (existing.botnoi_tool_id) {
      await updateTool(existing.botnoi_tool_id, {
        ...payload,
        status,
      });
    } else {
      const created = await createTool(payload);
      existing.botnoi_tool_id = extractToolId(created);
    }
  } catch (err) {
    return botnoiError(err);
  }

  const { data, error } = await admin
    .from("mcp_servers")
    .update({
      name,
      description,
      url,
      auth_header: authHeader,
      auth_value: authValue,
      botnoi_tool_id: existing.botnoi_tool_id,
      botnoi_tool_name: toolName,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select(
      "id, name, description, url, auth_header, botnoi_tool_id, botnoi_tool_name, status, created_at, updated_at",
    )
    .single();
  if (error) return jsonError("db", error.message, 500);
  return json({ server: data });
}

export async function DELETE(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  const admin = dbFor(request);
  if (!admin) return jsonError("not_configured", "Server is not configured.", 500);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id.trim()) return jsonError("bad_request", "id is required.", 400);

  const { data: existing, error: readError } = await admin
    .from("mcp_servers")
    .select("id, botnoi_tool_id")
    .eq("id", id.trim())
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return jsonError("db", readError.message, 500);
  if (!existing) return jsonError("not_found", "MCP server not found.", 404);

  if (existing.botnoi_tool_id && botnoiConfigured()) {
    try {
      await deleteTool(existing.botnoi_tool_id);
    } catch {}
  }
  const { error } = await admin
    .from("mcp_servers")
    .delete()
    .eq("id", existing.id)
    .eq("user_id", user.id);
  if (error) return jsonError("db", error.message, 500);
  return json({ ok: true });
}

function httpsUrl(value) {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

function cleanHeader(body) {
  const authValue = String(body.authValue || body.auth_value || body.api_key || "").trim();
  const authHeader = String(body.authHeader || body.auth_header || "").trim();
  if (!authValue) return { authHeader: null, authValue: null };
  if (!/^[A-Za-z0-9-]{1,80}$/.test(authHeader)) {
    return { error: "Header name is not allowed." };
  }
  return { authHeader, authValue: authValue.slice(0, 2000) };
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[^\p{L}\p{N}_\- ]+/gu, "")
    .slice(0, 60);
}

function botnoiToolName(userId, name) {
  const short = String(userId).replace(/-/g, "").slice(0, 8);
  const slug = String(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `tm_${short}_${slug || "mcp"}`;
}

function extractToolId(created) {
  if (!created || typeof created !== "object") return null;
  return (
    created.id ||
    created.tool_id ||
    created.toolId ||
    created.data?.id ||
    created.data?.tool_id ||
    null
  );
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
