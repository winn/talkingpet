/** Decide which linked MCP tool a pet should call for one user line. */

const STOP_WORDS = [
  "หาก",
  "โดน",
  "ถาม",
  "ว่า",
  "หรือ",
  "มั้ย",
  "ไหม",
  "เมื่อ",
  "ตอน",
  "ที่",
  "the",
  "when",
  "they",
  "ask",
  "about",
  "and",
  "or",
  "to",
  "if",
  "is",
  "for",
  "with",
  "them",
  "this",
  "that",
  "just",
  "said",
  "please",
  "ดี",
];

/** Words that mean the same thing across the when-clause and the user's line. */
const ALIAS_GROUPS = [
  ["อากาศ", "ฝน", "อุณหภูมิ", "weather", "rain", "forecast", "ร้อน", "หนาว", "umbrella"],
  ["เต๋า", "dice", "ทอย", "roll"],
  ["คำลับ", "secret"],
];

const PLACE_FILLERS = [
  "วันนี้อากาศ",
  "วันนี้",
  "วันนี",
  "สภาพอากาศ",
  "อากาศเป็นยังไง",
  "อากาศเป็นไง",
  "เป็นยังไง",
  "เป็นอย่างไร",
  "เป็นไงบ้าง",
  "เป็นไง",
  "ยังไงบ้าง",
  "ยังไง",
  "หรือเปล่า",
  "ฝนจะตกไหม",
  "ฝนจะตกมั้ย",
  "ฝนจะตก",
  "จะตก",
  "ตกไหม",
  "ตกมั้ย",
  "ฝนตกไหม",
  "ฝนตกมั้ย",
  "ฝนตก",
  "อุณหภูมิ",
  "อากาศ",
  "จังหวัด",
  "อยากรู้",
  "หน่อย",
  "what's the weather",
  "what is the weather",
  "how's the weather",
  "how is the weather",
  "weather in",
  "weather at",
  "weather",
  "forecast",
  "today",
  "please",
  "มั้ย",
  "ไหม",
  "ครับ",
  "ค่ะ",
  "คะ",
  "ฝน",
  "ดีมั้ย",
  "ดีไหม",
  "ดี",
];

const PLACE_PARAM = /city|town|province|จังหวัด|เมือง|location|place|ที่ตั้ง/i;

const TOOL_FAMILIES = [
  {
    tool: /weather|forecast|อากาศ|ฝน|อุณหภูมิ/i,
    text: /อากาศ|ฝน|อุณหภูมิ|weather|rain|forecast|ร้อน|หนาว|umbrella/i,
  },
  { tool: /dice|เต๋า|random/i, text: /เต๋า|dice|ทอย|roll/i },
  { tool: /secret|คำลับ/i, text: /secret|คำลับ|รหัสลับ/i },
];

export function whenKeywords(text) {
  let source = String(text || "");
  const phrases = [...STOP_WORDS].sort((a, b) => b.length - a.length);
  for (const word of phrases) {
    if (/^[a-z]/i.test(word)) source = source.replace(new RegExp(`\\b${word}\\b`, "gi"), " ");
    else source = source.split(word).join(" ");
  }
  return source
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !STOP_WORDS.includes(part));
}

/** True when the user's line fits the pet's "call only when" note. */
export function textMatchesWhen(userText, when) {
  const user = String(userText || "");
  const condition = String(when || "");
  if (!user.trim() || !condition.trim()) return false;
  const lower = user.toLowerCase();
  if (whenKeywords(condition).some((key) => lower.includes(key.toLowerCase()))) return true;
  return ALIAS_GROUPS.some(
    (group) =>
      group.some((alias) => condition.toLowerCase().includes(alias.toLowerCase())) &&
      group.some((alias) => lower.includes(alias.toLowerCase())),
  );
}

/**
 * Place name to send to a weather-style argument.
 * A question with no place falls back to Bangkok so the lookup still returns weather.
 */
export function placeQuery(raw) {
  const original = String(raw || "").trim();
  if (!original) return { query: "", assumed: false };
  let cleaned = original;
  const fillers = [...PLACE_FILLERS].sort((a, b) => b.length - a.length);
  for (const filler of fillers) cleaned = cleaned.split(filler).join(" ");
  cleaned = cleaned
    .replace(/[?？!！.,，。]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  cleaned = cleaned.replace(/^(ที่|in|at|the|for)\s+/i, "").replace(/^ที่/, "").trim();
  if (!cleaned || [...cleaned].length <= 2) return { query: "Bangkok", assumed: true };
  if (cleaned.length > 40) {
    const words = cleaned.split(/\s+/).filter(Boolean);
    cleaned = words.slice(-3).join(" ");
  }
  return { query: cleaned, assumed: false };
}

export function pickTool(tools, userText, when = "") {
  const list = Array.isArray(tools) ? tools : [];
  if (!list.length) return null;
  const blob = `${userText}\n${when}`;
  let best = null;
  let bestScore = 0;
  for (const tool of list) {
    const desc = `${tool?.name || ""} ${tool?.description || ""}`;
    let score = 0;
    for (const family of TOOL_FAMILIES) {
      if (family.tool.test(desc) && family.text.test(blob)) score += 3;
    }
    for (const key of whenKeywords(desc)) {
      if (key.length >= 4 && blob.toLowerCase().includes(key.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      best = tool;
      bestScore = score;
    }
  }
  if (best) return best;
  return list.length === 1 ? list[0] : null;
}

function schemaOf(tool) {
  return tool?.inputSchema || tool?.input_schema || tool?.parameters || {};
}

/** Fill the tool's arguments from the user's sentence. */
export function buildArguments(tool, userText) {
  const props = schemaOf(tool)?.properties || {};
  const names = Object.keys(props);
  const args = {};
  let assumedPlace = false;
  for (const name of names) {
    const spec = props[name] && typeof props[name] === "object" ? props[name] : {};
    const type = String(spec.type || "string");
    const blob = `${name} ${spec.description || ""}`;
    if (type === "integer" || type === "number") {
      const match = String(userText || "").match(/\d+/);
      if (match && (names.length === 1 || /side|count|ลูก|จำนวน/i.test(blob))) {
        const n = Number(match[0]);
        args[name] = type === "integer" ? Math.round(n) : n;
      }
      continue;
    }
    if (type === "boolean") continue;
    if (PLACE_PARAM.test(blob) || names.filter((n) => (props[n]?.type || "string") === "string").length === 1) {
      const place = placeQuery(userText);
      if (place.query) {
        args[name] = place.query;
        assumedPlace = assumedPlace || place.assumed;
      }
    }
  }
  return { args, assumedPlace };
}

/**
 * Map the form's sample values onto the remote tool's real argument names.
 * A single text field such as จังหวัด is sent as the tool's city argument.
 */
export function mapSampleArgs(tool, userSchema, sample = {}) {
  const props = schemaOf(tool)?.properties || {};
  const names = Object.keys(props);
  const userProps =
    userSchema?.properties && typeof userSchema.properties === "object" && !Array.isArray(userSchema.properties)
      ? userSchema.properties
      : {};
  const userNames = Object.keys(userProps).slice(0, 20);
  const provided = userNames
    .map((name) => String(sample?.[name] ?? "").trim())
    .filter(Boolean);
  const stringNames = names.filter((name) => String(props[name]?.type || "string") === "string");
  const args = {};
  for (const name of names) {
    const spec = props[name] && typeof props[name] === "object" ? props[name] : {};
    const type = String(spec.type || "string");
    let raw = sample?.[name] != null ? String(sample[name]).trim() : "";
    if (!raw && type === "string" && provided.length === 1) {
      const blob = `${name} ${spec.description || ""} ${userNames.join(" ")}`;
      if (stringNames.length === 1 || PLACE_PARAM.test(blob)) raw = provided[0];
    }
    if (!raw) continue;
    if (type === "integer" || type === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) args[name] = type === "integer" ? Math.trunc(n) : n;
    } else if (type === "boolean") {
      args[name] = /^(1|true|yes|ใช่)$/i.test(raw);
    } else {
      args[name] = raw.slice(0, 200);
    }
  }
  return args;
}

/**
 * First linked server whose when-clause matches, and the tool on that server to call.
 * `servers` items: { id, name, description, when, tools }.
 */
export function chooseCall(servers, userText) {
  for (const server of servers || []) {
    const when = String(server.when || "").trim();
    const condition = when || server.description || "";
    if (!textMatchesWhen(userText, condition)) continue;
    if (when && !textMatchesWhen(userText, when)) continue;
    const tool = pickTool(server.tools, userText, condition);
    if (!tool?.name) continue;
    const built = buildArguments(tool, userText);
    return {
      serverId: server.id,
      serverName: server.name,
      tool: tool.name,
      args: built.args,
      assumedPlace: built.assumedPlace,
    };
  }
  return null;
}

export function toolResultText(result) {
  const content = result?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
  }
  if (typeof result === "string") return result.slice(0, 4000);
  return "";
}
