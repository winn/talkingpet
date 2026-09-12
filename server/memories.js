// Turns a talk session's transcript into key/value facts the pet should
// remember about its friend. Gemini does the reading; this module owns the
// prompt, the response shape, and the merge with what is already known.
import { GEMINI_URL } from "./audio.js";
import { normalizeKey, normalizeValue } from "../src/memory-keys.js";
import { isInternalPromptText } from "../src/prompt-filter.js";

export const MEMORY_LIMITS = {
  maxPerSession: 8,
  maxTotal: 60,
  maxTurns: 80,
  maxTurnChars: 400,
};

const USER_ROLES = new Set(["user", "me", "human", "friend", "child"]);

/** Accepts the widget's history items or {role, text} pairs; returns clean turns. */
export function normalizeTranscript(raw) {
  if (!Array.isArray(raw)) return [];
  const turns = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const who = String(item.role ?? item.sender ?? "").toLowerCase();
    const reply =
      item.reply && typeof item.reply === "object"
        ? item.reply.text ?? item.reply.uiText ?? item.reply.message
        : item.reply;
    const text = String(item.text ?? item.uiText ?? item.message ?? reply ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MEMORY_LIMITS.maxTurnChars);
    if (!text || isInternalPromptText(text)) continue;
    turns.push({ role: USER_ROLES.has(who) ? "user" : "pet", text });
  }
  return turns.slice(-MEMORY_LIMITS.maxTurns);
}

/** Clean {key, value} or null. */
export function normalizeMemory(item) {
  const key = normalizeKey(item?.key);
  const value = normalizeValue(item?.value);
  return key && value ? { key, value } : null;
}

/**
 * Facts to write: keys that are new, or whose value changed. Repeats within
 * the proposal collapse to the last one. New keys respect the account cap.
 */
export function mergeMemories(existing = [], proposed = []) {
  const known = new Map();
  for (const item of existing) {
    const clean = normalizeMemory(item);
    if (clean) known.set(clean.key, clean.value.toLowerCase());
  }
  const room = Math.max(0, MEMORY_LIMITS.maxTotal - known.size);
  const changes = new Map();
  let added = 0;
  for (const candidate of Array.isArray(proposed) ? proposed : []) {
    const clean = normalizeMemory(candidate);
    if (!clean) continue;
    if (known.get(clean.key) === clean.value.toLowerCase()) continue;
    const isNew = !known.has(clean.key) && !changes.has(clean.key);
    if (isNew && added >= room) continue;
    if (!changes.has(clean.key) && changes.size >= MEMORY_LIMITS.maxPerSession)
      continue;
    if (isNew) added++;
    changes.set(clean.key, clean.value);
  }
  return [...changes].map(([key, value]) => ({ key, value }));
}

export function memoryInstruction({ petName, language, existing, transcript }) {
  const thai = language === "th";
  const name = petName || (thai ? "เพื่อนสัตว์เลี้ยง" : "the pet");
  const known = existing.length
    ? existing.map((m) => `- ${m.key}: ${m.value}`).join("\n")
    : thai
      ? "(ยังไม่มี)"
      : "(none yet)";
  const lines = transcript
    .map((t) => `${t.role === "user" ? "Friend" : name}: ${t.text}`)
    .join("\n");
  return [
    `You help ${name}, a virtual pet, remember its friend (a child aged 8 or older) between chats.`,
    "Read the transcript and extract lasting personal facts the friend shared about themselves, as key/value pairs.",
    "Keys are short English snake_case labels, reusing these when they fit: name, nickname, birthday, age, favorite_food, favorite_color, favorite_subject, favorite_animal, favorite_game, favorite_song, favorite_place, favorite_sport, hobby, pet, family, school, friend, dream, dislike. Invent a similar key only for something else the friend clearly asked the pet to remember.",
    `Values are short (under 100 characters) in ${thai ? "Thai" : "English"}, for example ${thai ? 'name: "จอห์น", birthday: "19 มีนาคม", favorite_food: "ไอศกรีมชาเขียว", favorite_sport: "ฟุตบอล"' : 'name: "John", birthday: "19 March", favorite_food: "green tea ice cream", favorite_sport: "football"'}.`,
    "Rules: only facts the friend stated about themselves; ignore small talk, questions, and the pet's own words. Never invent details. Repeat a known key only when its value changed. Sports the friend likes or plays (football, swimming, basketball, etc.) use favorite_sport — not hobby or favorite_game.",
    `Return at most ${MEMORY_LIMITS.maxPerSession} pairs. Return an empty list when there is nothing new worth remembering.`,
    "",
    "Known facts:",
    known,
    "",
    "Transcript:",
    lines,
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"],
      },
    },
  },
  required: ["memories"],
};

/** Resolves the {key, value} facts to write (may be empty). Throws on provider errors. */
export async function summarizeMemories({
  apiKey,
  transcript,
  existing = [],
  petName = "",
  language = "en",
  fetchImpl = fetch,
}) {
  const turns = normalizeTranscript(transcript);
  if (!turns.some((t) => t.role === "user")) return [];
  let res;
  try {
    res = await fetchImpl(GEMINI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: memoryInstruction({
                  petName,
                  language,
                  existing: existing.map(normalizeMemory).filter(Boolean),
                  transcript: turns,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch {
    throw new Error("gemini_unreachable");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403)
    throw new Error("invalid_key");
  if (res.status === 429) throw new Error("rate_limited");
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`gemini_failed: ${res.status} ${detail}`);
  }
  const body = await res.json();
  const text =
    body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  if (!text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("gemini_bad_shape");
  }
  return mergeMemories(existing, parsed?.memories);
}
