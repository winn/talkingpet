// Turns a talk session's transcript into a few short facts the pet should
// remember about its friend. Gemini does the reading; this module owns the
// prompt, the response shape, and the merge with what is already known.
import { GEMINI_URL } from "./audio.js";

export const MEMORY_LIMITS = {
  maxPerSession: 8,
  maxTotal: 60,
  maxChars: 200,
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
    const text = String(item.text ?? item.uiText ?? item.message ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MEMORY_LIMITS.maxTurnChars);
    if (!text) continue;
    turns.push({ role: USER_ROLES.has(who) ? "user" : "pet", text });
  }
  return turns.slice(-MEMORY_LIMITS.maxTurns);
}

export function normalizeMemory(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_LIMITS.maxChars);
}

const fingerprint = (text) =>
  normalizeMemory(text)
    .toLowerCase()
    .replace(/[.!?。]+$/g, "")
    .trim();

/** New facts only: no blanks, no repeats of each other or of what is known. */
export function mergeMemories(existing = [], proposed = []) {
  const known = new Set(existing.map(fingerprint).filter(Boolean));
  const room = Math.max(0, MEMORY_LIMITS.maxTotal - existing.length);
  const limit = Math.min(MEMORY_LIMITS.maxPerSession, room);
  const fresh = [];
  for (const candidate of Array.isArray(proposed) ? proposed : []) {
    if (fresh.length >= limit) break;
    const content = normalizeMemory(candidate);
    const key = fingerprint(content);
    if (!key || known.has(key)) continue;
    known.add(key);
    fresh.push(content);
  }
  return fresh;
}

export function memoryInstruction({ petName, language, existing, transcript }) {
  const thai = language === "th";
  const name = petName || (thai ? "เพื่อนสัตว์เลี้ยง" : "the pet");
  const known = existing.length
    ? existing.map((m) => `- ${m}`).join("\n")
    : thai
      ? "(ยังไม่มี)"
      : "(none yet)";
  const lines = transcript
    .map((t) => `${t.role === "user" ? "Friend" : name}: ${t.text}`)
    .join("\n");
  return [
    `You help ${name}, a virtual pet, remember its friend (a child aged 8 or older) between chats.`,
    "Read the transcript and extract lasting personal facts the friend shared about themselves: their name, birthday, age, favourite foods, colours, games, animals, family, pets, hobbies, or anything they explicitly asked the pet to remember.",
    "Rules: only facts the friend stated about themselves; ignore small talk, questions, the pet's own words, and anything already in the known facts. Never invent details.",
    `Write each fact as one short sentence in ${thai ? "Thai" : "English"} from the pet's point of view, under 120 characters, for example: ${thai ? '"เพื่อนของฉันชื่อจอห์น"' : '"My friend\'s name is John."'}`,
    `Return at most ${MEMORY_LIMITS.maxPerSession} facts. Return an empty list when there is nothing new worth remembering.`,
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
  properties: { memories: { type: "array", items: { type: "string" } } },
  required: ["memories"],
};

/** Resolves the new facts to store (may be empty). Throws on provider errors. */
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
                  existing,
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
