import { json, jsonError, readJson } from "../../server/http.js";
import { adminClient, userClient, userFromRequest } from "../../server/supabase.js";
import { callRemoteTool, listRemoteTools, mcpAuthHeaders } from "../../server/mcp-client.js";
import { chooseCall, textMatchesWhen, toolResultText } from "../../server/mcp-use.js";

/**
 * POST /api/mcp/use
 * Body: { text, links: [{ serverId, when }] }
 * Calls a linked MCP server when the user's line matches that pet's when-clause.
 * The shared species widget cannot register one account's tools, so talk does this itself.
 */
export async function POST(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  const db = adminClient() ?? userClient(request);
  if (!db) return jsonError("not_configured", "Server is not configured.", 500);

  const body = await readJson(request);
  const text = String(body.text || "").trim().slice(0, 1000);
  const links = (Array.isArray(body.links) ? body.links : []).slice(0, 8);
  if (!text || !links.length) return json({ matched: false });

  const ids = [
    ...new Set(links.map((link) => String(link?.serverId || "").trim()).filter(Boolean)),
  ];
  if (!ids.length) return json({ matched: false });

  const { data, error } = await db
    .from("mcp_servers")
    .select("id, name, description, url, auth_header, auth_value, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .in("id", ids);
  if (error) return jsonError("db", error.message, 500);

  const byId = new Map((data || []).map((row) => [row.id, row]));
  const ordered = [];
  for (const link of links) {
    const row = byId.get(String(link?.serverId || ""));
    if (!row?.url) continue;
    ordered.push({
      id: row.id,
      name: row.name,
      description: row.description || "",
      when: String(link?.when || "").trim().slice(0, 300),
      url: row.url,
      headers: mcpAuthHeaders(row),
    });
  }
  if (!ordered.length) return json({ matched: false });

  const candidates = ordered.filter((server) =>
    textMatchesWhen(text, server.when || server.description),
  );
  if (!candidates.length) return json({ matched: false });

  const withTools = [];
  for (const server of candidates) {
    try {
      const listed = await listRemoteTools(server.url, { headers: server.headers });
      withTools.push({ ...server, tools: listed.tools, sessionId: listed.sessionId });
    } catch (err) {
      console.warn(`[mcp-use] list failed for ${server.name}:`, err instanceof Error ? err.message : err);
    }
  }

  const choice = chooseCall(withTools, text);
  if (!choice) return json({ matched: false });
  const server = withTools.find((item) => item.id === choice.serverId);
  if (!server) return json({ matched: false });

  try {
    const result = await callRemoteTool(server.url, choice.tool, choice.args, {
      headers: server.headers,
      sessionId: server.sessionId,
    });
    let textOut = toolResultText(result);
    if (result?.isError) {
      return json({
        matched: true,
        ok: false,
        serverName: choice.serverName,
        tool: choice.tool,
        error: textOut || "Tool failed.",
      });
    }
    if (!textOut) textOut = "The tool returned nothing.";
    if (choice.assumedPlace) textOut += "\nNo city was named, so this is Bangkok.";
    return json({
      matched: true,
      ok: true,
      serverName: choice.serverName,
      tool: choice.tool,
      result: textOut,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool failed.";
    console.warn(`[mcp-use] call failed ${choice.tool}:`, message);
    return json({
      matched: true,
      ok: false,
      serverName: choice.serverName,
      tool: choice.tool,
      error: message,
    });
  }
}
