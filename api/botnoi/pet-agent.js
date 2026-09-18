import { json, jsonError, readJson } from "../../server/http.js";
import {
  agentDataWithTools,
  botnoiConfigured,
  createOrUpdateAgent,
} from "../../server/botnoi.js";
import { adminClient, userClient, userFromRequest } from "../../server/supabase.js";
import { mcpPromptAppendix, toolsForPet } from "../../server/mcp.js";

/**
 * PUT /api/botnoi/pet-agent
 * { petId, petName, personality?, language?, mcpLinks?: [{ serverId, when }] }
 *
 * Creates or updates a Botnoi Voice agent for this pet, attaching only the
 * MCP tools the pet checked. The "when" text is added to the system prompt.
 * The client should store agentId on the pet and pass it as ChatWidget widgetId.
 */
export async function PUT(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  if (!botnoiConfigured())
    return jsonError(
      "missing_botnoi_token",
      "Set BOTNOI_VOICE_TOKEN on the server first.",
      400,
    );
  const db = adminClient() ?? userClient(request);
  if (!db) return jsonError("not_configured", "Server is not configured.", 500);

  const body = await readJson(request);
  const petId = String(body.petId || body.pet_id || "").trim();
  const petName = String(body.petName || body.pet_name || "").trim() || "Momo";
  if (!petId) return jsonError("bad_request", "petId is required.", 400);

  const language = body.language === "th" ? "th" : "en";
  const personality = String(body.personality || body.greeting || "").trim();
  const existingAgentId = String(body.agentId || body.agent_id || "").trim() || null;
  const links = body.mcpLinks || body.mcp_links || [];
  const tools = await toolsForPet(db, user.id, links);
  const toolNames = tools.map((tool) => tool.botnoi_tool_name).filter(Boolean);
  const prompt = `${personality}${mcpPromptAppendix(tools)}`.slice(0, 8000);
  const botName = `tm_${String(user.id).replace(/-/g, "").slice(0, 8)}_${petId.slice(0, 12)}`;

  const agentData = agentDataWithTools(
    {
      language,
      system_prompt: prompt,
      greeting_instruction: personality.slice(0, 4000),
      pet_name: petName.slice(0, 60),
      talking_momo_pet_id: petId,
    },
    toolNames,
  );

  const payload = {
    bot_name: botName,
    agent_data: agentData,
    voice_data: body.voice_data || {},
  };
  if (existingAgentId) payload.agent_id = existingAgentId;

  try {
    const agent = await createOrUpdateAgent(payload);
    const agentId =
      agent?.agent_id ||
      agent?.agentId ||
      agent?.id ||
      agent?.data?.agent_id ||
      agent?.data?.id ||
      existingAgentId ||
      null;
    return json({
      agent,
      agentId,
      botName,
      toolNames,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Botnoi request failed.";
    const status =
      err?.status === 401 || err?.status === 403
        ? err.status
        : /unreachable/.test(message)
          ? 502
          : 500;
    return jsonError(message.split(":")[0], message, status);
  }
}
