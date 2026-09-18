// Browser helpers for Botnoi Voice agents + MCP connections.
import { getSession } from "./auth.js";

async function authHeaders() {
  const session = await getSession();
  if (!session?.access_token) throw new Error("Sign in first.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function readApi(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.code || res.statusText);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function listMcpServers() {
  const res = await fetch("/api/mcp/servers", { headers: await authHeaders() });
  const data = await readApi(res);
  return Array.isArray(data.servers) ? data.servers : [];
}

export async function createMcpServer(input) {
  const res = await fetch("/api/mcp/servers", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const data = await readApi(res);
  return data.server;
}

export async function updateMcpServer(input) {
  const res = await fetch("/api/mcp/servers", {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const data = await readApi(res);
  return data.server;
}

export async function deleteMcpServer(id) {
  const res = await fetch(`/api/mcp/servers?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  await readApi(res);
  return true;
}

/**
 * Ensure this pet has a Botnoi Voice agent with the user's MCP tools attached.
 * Resolves { agentId, toolNames } or null when Botnoi is not set up.
 */
export async function ensurePetVoiceAgent(pet, { personality = "", language = "en" } = {}) {
  if (!pet?.id) return null;
  try {
    const res = await fetch("/api/botnoi/pet-agent", {
      method: "PUT",
      headers: await authHeaders(),
      body: JSON.stringify({
        petId: pet.id,
        petName: pet.name,
        personality,
        language,
        agentId: pet.botnoiAgentId || null,
        mcpLinks: Array.isArray(pet.mcpLinks) ? pet.mcpLinks : [],
      }),
    });
    if (res.status === 400) {
      const data = await res.json().catch(() => ({}));
      if (data.code === "missing_botnoi_token") return null;
    }
    const data = await readApi(res);
    if (!data.agentId) return null;
    return { agentId: data.agentId, toolNames: data.toolNames || [], botName: data.botName };
  } catch (err) {
    console.warn("[TalkingMomo] pet agent ensure failed:", err);
    return null;
  }
}
