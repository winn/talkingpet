import { getSession } from "./auth.js";
import { listMcpServers } from "./botnoi-client.js";
import { mcpPromptAppendix } from "../server/mcp.js";

/** System-prompt lines for the tools this pet is allowed to use. */
export async function loadTalkMcpNote(pet) {
  const links = Array.isArray(pet?.mcpLinks) ? pet.mcpLinks : [];
  if (!links.length) return "";
  let servers = [];
  try {
    servers = await listMcpServers();
  } catch {
    return "";
  }
  const tools = [];
  for (const link of links) {
    const row = servers.find((server) => server.id === link.serverId);
    if (!row || row.status === "inactive") continue;
    tools.push({
      name: row.name,
      description: row.description,
      when: link.when,
      parameters: row.parameters,
      parameter_hint: row.parameter_hint,
    });
  }
  return mcpPromptAppendix(tools);
}

/** Tell the live model to speak a tool result it cannot fetch itself. */
export function mcpResultInstruction({ userText, tool, serverName, result, language = "en" }) {
  const reply =
    language === "th"
      ? "พูดคำตอบเป็นภาษาไทยทันที ห้ามทักทายใหม่"
      : "Say the answer immediately. Do not greet again.";
  return (
    `\n\n${reply} The person just asked: "${String(userText || "").slice(0, 300)}". ` +
    `You already called ${tool} (${serverName}). Use only this result and do not invent facts:\n${result}`
  );
}

/** Run the pet's linked MCP servers against one spoken or typed line. */
export async function usePetMcp(pet, text) {
  const session = await getSession();
  if (!session?.access_token) return { matched: false };
  const res = await fetch("/api/mcp/use", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      text,
      links: Array.isArray(pet?.mcpLinks) ? pet.mcpLinks : [],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.matched) {
    const err = new Error(data.error || "Could not use the tool.");
    err.code = data.code;
    throw err;
  }
  return data;
}
