/** Helpers for Talking Momo MCP rows synced to Botnoi tools. */

const EMPTY_PARAMETERS = { type: "object", properties: {}, required: [] };

export async function activeToolNamesForUser(admin, userId) {
  if (!admin || !userId) return [];
  const { data } = await admin
    .from("mcp_servers")
    .select("botnoi_tool_name, status")
    .eq("user_id", userId)
    .eq("status", "active");
  return (data || []).map((row) => row.botnoi_tool_name).filter(Boolean);
}

/**
 * JSON Schema object the LLM is allowed to fill. Throws on bad input.
 * An empty string or null means the tool takes no arguments.
 */
export function normalizeParameters(value) {
  if (value == null || value === "") return { ...EMPTY_PARAMETERS, properties: {}, required: [] };
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Parameters must be JSON.");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Parameters must be a JSON object.");
  const properties =
    parsed.properties && typeof parsed.properties === "object" && !Array.isArray(parsed.properties)
      ? parsed.properties
      : {};
  const names = Object.keys(properties).slice(0, 40);
  const kept = {};
  for (const name of names) {
    const spec = properties[name];
    kept[name] =
      spec && typeof spec === "object" && !Array.isArray(spec)
        ? {
            type: String(spec.type || "string").slice(0, 40),
            ...(spec.description ? { description: String(spec.description).slice(0, 200) } : {}),
          }
        : { type: "string" };
  }
  const required = (Array.isArray(parsed.required) ? parsed.required : [])
    .map((name) => String(name))
    .filter((name) => name in kept)
    .slice(0, 40);
  const schema = { type: "object", properties: kept, required };
  if (JSON.stringify(schema).length > 8000) throw new Error("Parameters are too long.");
  return schema;
}

/** Servers this pet checked, in the order the pet saved them. */
export async function toolsForPet(db, userId, links) {
  const selected = Array.isArray(links) ? links : [];
  const ids = [
    ...new Set(
      selected
        .map((link) => String(link?.serverId || link?.id || "").trim())
        .filter(Boolean),
    ),
  ];
  if (!db || !userId || !ids.length) return [];
  const { data } = await db
    .from("mcp_servers")
    .select("id, name, description, parameters, parameter_hint, botnoi_tool_name, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("id", ids);
  const byId = new Map((data || []).map((row) => [row.id, row]));
  return selected
    .map((link) => {
      const row = byId.get(String(link?.serverId || link?.id || ""));
      if (!row) return null;
      return { ...row, when: String(link?.when || "").trim().slice(0, 300) };
    })
    .filter(Boolean);
}

/** Extra system-prompt lines so the model knows when and how to call each tool. */
export function mcpPromptAppendix(tools) {
  if (!tools?.length) return "";
  const blocks = tools.map((tool) => {
    const hint = String(tool.parameter_hint || "").trim() || summarizeParameters(tool.parameters);
    return [
      `- ${tool.name}: ${tool.description || "No description."}`,
      `  Call only when: ${tool.when || "it clearly helps what the person just said."}`,
      hint ? `  Send: ${hint}` : "  This tool takes no extra details.",
    ].join("\n");
  });
  return (
    "\n\nYou may call these tools. Do not call a tool unless its condition matches what the person just said.\n" +
    blocks.join("\n")
  );
}

export function summarizeParameters(parameters) {
  const props = parameters?.properties;
  if (!props || typeof props !== "object") return "";
  const required = new Set(parameters.required || []);
  return Object.entries(props)
    .map(([name, spec]) => {
      const type = spec?.type || "string";
      const desc = spec?.description ? ` — ${spec.description}` : "";
      return `${name} (${type}${required.has(name) ? ", required" : ""})${desc}`;
    })
    .join("; ");
}
