import { json, jsonError, readJson } from "../../server/http.js";
import {
  BOTNOI_TOKEN_HINT,
  BOTNOI_WSS_URL,
  attachMcpConnections,
  botnoiToolName,
  buildPetAgentData,
  consolePreservingPayload,
  createOrUpdateAgent,
  createTool,
  extractAgentId,
  extractToolId,
  getAgent,
  mcpToolPayload,
  petVoiceData,
  readStoredAgent,
  resolveBotnoiConnectorKey,
  resolveBotnoiToken,
} from "../../server/botnoi.js";
import { mcpPromptAppendix, toolsForPet } from "../../server/mcp.js";
import { adminClient, userClient, userFromRequest } from "../../server/supabase.js";

/**
 * PUT /api/botnoi/pet-agent
 * Creates or updates one Botnoi Voice agent for this pet (gemini_live /
 * voice2voice, the same envelope Talking Jelly uses) and registers the MCP
 * servers the pet checked.
 */
export async function PUT(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  const db = adminClient() ?? userClient(request);
  if (!db) return jsonError("not_configured", "Server is not configured.", 500);
  const token = await resolveBotnoiToken(db);
  if (!token) return jsonError("missing_botnoi_token", BOTNOI_TOKEN_HINT, 400);

  const body = await readJson(request);
  const petId = String(body.petId || body.pet_id || "").trim();
  const petName = String(body.petName || body.pet_name || "").trim() || "Momo";
  if (!petId) return jsonError("bad_request", "petId is required.", 400);

  const language = body.language === "th" ? "th" : "en";
  const personality = String(body.personality || body.greeting || "").trim();
  const existingAgentId = String(body.agentId || body.agent_id || "").trim() || null;
  const links = body.mcpLinks || body.mcp_links || [];
  const tools = await toolsForPet(db, user.id, links);
  const toolNames = await registerMissingTools(db, user.id, tools, token);
  const prompt = `${personality}${mcpPromptAppendix(tools)}`.slice(0, 7000);
  const botName = `tm_${String(user.id).replace(/-/g, "").slice(0, 8)}_${petId.slice(0, 12)}`;
  const instruction = `Your name is ${petName}.\n${prompt}`;
  const greeting = personality.slice(0, 240) || petName;

  const createPayload = {
    bot_name: botName.slice(0, 80),
    agent_data: buildPetAgentData({
      personality: instruction,
      greeting,
      language,
      toolNames,
    }),
    voice_data: petVoiceData(language),
  };
  if (existingAgentId) createPayload.agent_id = existingAgentId;

  let stored = null;
  let skipWrite = false;
  if (existingAgentId) {
    try {
      stored = readStoredAgent(await getAgent(existingAgentId, { token }));
      if (!stored.voice_data && !stored.agent_data) skipWrite = true;
    } catch (err) {
      if (err?.status !== 404) skipWrite = true;
    }
  }
  const payload = skipWrite ? null : consolePreservingPayload(createPayload, stored, toolNames);

  try {
    let agentId = existingAgentId;
    if (payload) {
      const agent = await createOrUpdateAgent(payload, { token });
      agentId = extractAgentId(agent) || existingAgentId;
    }
    if (!agentId) {
      return jsonError("botnoi_agent", "Botnoi did not return an agent id.", 502);
    }
    const connections = await attachMcpConnections(agentId, tools, { token });
    const discovered = connections.flatMap((row) => row.toolNames || []);
    const merged = [...new Set([...toolNames, ...discovered])];
    if (payload && discovered.some((name) => !toolNames.includes(name))) {
      payload.agent_id = agentId;
      payload.agent_data = {
        ...payload.agent_data,
        tools: merged.map((name) => ({ name })),
        tool_names: merged,
      };
      await createOrUpdateAgent(payload, { token });
    }
    const apiKey = await resolveBotnoiConnectorKey(db);
    return json({
      engine: "botnoi",
      agentId,
      botName: payload?.bot_name || stored?.bot_name || createPayload.bot_name,
      toolNames: merged,
      wssUrl: BOTNOI_WSS_URL,
      apiKey: apiKey || null,
      connections: connections.map(({ name, connectionId, toolNames: names, error }) => ({
        name,
        connectionId,
        toolNames: names || [],
        error: error || null,
      })),
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

/** Create platform tools that were saved before a token existed. */
async function registerMissingTools(db, userId, tools, token) {
  const names = [];
  for (const tool of tools) {
    let name = tool.botnoi_tool_name || null;
    if (!tool.botnoi_tool_id && tool.url) {
      const toolName = name || botnoiToolName(userId, tool.name);
      try {
        const created = await createTool(
          mcpToolPayload({
            name: toolName,
            description: tool.description,
            url: tool.url,
            authHeader: tool.auth_header,
            authValue: tool.auth_value,
            parameters: tool.parameters,
            parameterHint: tool.parameter_hint,
          }),
          { token },
        );
        const id = extractToolId(created);
        if (id) {
          await db
            .from("mcp_servers")
            .update({ botnoi_tool_id: id, botnoi_tool_name: toolName })
            .eq("id", tool.id)
            .eq("user_id", userId);
          name = toolName;
        }
      } catch (err) {
        console.warn(
          "[pet-agent] tool register failed:",
          tool.name,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (name) names.push(name);
  }
  return names;
}
