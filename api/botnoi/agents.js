import { json, jsonError, readJson } from "../../server/http.js";
import {
  agentDataWithTools,
  botnoiConfigured,
  createOrUpdateAgent,
  getAgent,
  listAgents,
} from "../../server/botnoi.js";
import { requireAdmin } from "../../server/supabase.js";

/**
 * GET /api/botnoi/agents — list Voice agents (or one via ?agentId=)
 * PUT /api/botnoi/agents — create or update an agent, optionally with tool names
 *
 * Body for PUT:
 * {
 *   bot_name, agent_id?,
 *   agent_data?, voice_data?, transfer?, webhook?,
 *   tool_names?: string[]   // merged into agent_data.tools / tool_names
 * }
 */
export async function GET(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  if (!botnoiConfigured())
    return jsonError(
      "missing_botnoi_token",
      "Set BOTNOI_VOICE_TOKEN on the server first.",
      400,
    );
  const agentId = new URL(request.url).searchParams.get("agentId");
  try {
    if (agentId) return json({ agent: await getAgent(agentId) });
    const agents = await listAgents();
    return json({
      agents: Array.isArray(agents) ? agents : agents?.data ?? agents,
    });
  } catch (err) {
    return botnoiError(err);
  }
}

export async function PUT(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  if (!botnoiConfigured())
    return jsonError(
      "missing_botnoi_token",
      "Set BOTNOI_VOICE_TOKEN on the server first.",
      400,
    );
  const body = await readJson(request);
  const botName = String(body.bot_name || body.botName || "").trim();
  if (!botName) return jsonError("bad_request", "bot_name is required.", 400);

  const toolNames = Array.isArray(body.tool_names)
    ? body.tool_names
    : Array.isArray(body.toolNames)
      ? body.toolNames
      : [];
  const agentData = agentDataWithTools(body.agent_data || body.agentData || {}, toolNames);

  const payload = {
    bot_name: botName,
    agent_data: agentData,
    voice_data: body.voice_data || body.voiceData || {},
    transfer: body.transfer || {},
    webhook: body.webhook || {},
  };
  const agentId = body.agent_id || body.agentId;
  if (agentId) payload.agent_id = String(agentId);

  try {
    const agent = await createOrUpdateAgent(payload);
    return json({ agent });
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
