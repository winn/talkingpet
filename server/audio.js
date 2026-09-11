/**
 * Music and sound-effect generation with ElevenLabs, plus batch planning with
 * Gemini. Pure helpers take fetch as a parameter so tests can fake it.
 */

import { env } from "./env.js";

/** Overridable so tests can point at a stub instead of spending credits. */
export function elevenLabsBase() {
  return env("ELEVENLABS_API_BASE") || "https://api.elevenlabs.io";
}

export const MUSIC = { bucket: "bgm", model: "music_v2", minMs: 10_000, maxMs: 300_000 };
export const SFX = { bucket: "sfx", model: "eleven_text_to_sound_v2", minMs: 500, maxMs: 30_000 };

export const CUE_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** Pull `[meow]` off the end of a prompt so ElevenLabs does not try to voice it. */
export function splitSfxPrompt(raw) {
  const trimmed = String(raw ?? "").trim();
  const match = trimmed.match(/^(.*?)\s*\[([a-z][a-z0-9_]{0,31})\]\s*$/i);
  if (!match) return { text: trimmed, cue: null };
  return { text: match[1].trim(), cue: match[2].toLowerCase() };
}

export function cueFromTitle(title) {
  const ascii = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (CUE_RE.test(ascii)) return ascii;
  return `sfx_${Math.random().toString(36).slice(2, 10)}`;
}

export function withCueTag(prompt, cue) {
  const { text } = splitSfxPrompt(prompt);
  return `${text} [${cue}]`;
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t ?? "").trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

export function storagePath() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.mp3`;
}

async function elevenLabsError(res) {
  if (res.status === 401 || res.status === 403) return new Error("invalid_key");
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  return new Error(`elevenlabs_failed: ${res.status} ${detail}`);
}

/** Instrumental only: everything here plays under a talking pet. */
export async function composeMusic({ apiKey, prompt, durationMs, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${elevenLabsBase()}/v1/music`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        music_length_ms: durationMs,
        model_id: MUSIC.model,
        force_instrumental: true,
      }),
    });
  } catch {
    throw new Error("elevenlabs_unreachable");
  }
  if (!res.ok) throw await elevenLabsError(res);
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.byteLength === 0) throw new Error("elevenlabs_empty");
  return audio;
}

export async function composeSfx({ apiKey, text, durationMs, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${elevenLabsBase()}/v1/sound-generation`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        duration_seconds: durationMs / 1000,
        model_id: SFX.model,
        output_format: "mp3_44100_128",
      }),
    });
  } catch {
    throw new Error("elevenlabs_unreachable");
  }
  if (!res.ok) throw await elevenLabsError(res);
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.byteLength === 0) throw new Error("elevenlabs_empty");
  return audio;
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

function planInstruction(kind, { count, brief, durationMs, taken, takenCues }) {
  if (kind === "music") {
    return [
      `Plan ${count} short instrumental background music pieces for Paint Momo, a painting studio where children (age 8+) create a cartoon cat or dog and chat with it.`,
      `Every piece plays quietly under a talking pet, so it must be instrumental, gentle on the ears, and loopable.`,
      `Return JSON with "tracks": each has title (short English), prompt (one or two English sentences for a music model: instruments, tempo, mood, "no vocals"), seconds (${durationMs ? Math.round(durationMs / 1000) : "one of 30, 60, 90, 120"}), mood (one word: calm, happy, playful, magical, cozy, adventure, sleepy), tags (up to 8 English keywords).`,
      `Make the pieces clearly different from each other.`,
      brief ? `Extra direction from the admin: ${brief}` : "",
      taken.length ? `Do not reuse these titles: ${taken.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Plan ${count} short sound effects for Paint Momo, a painting studio where children (age 8+) create a cartoon cat or dog and chat with it.`,
    `Good subjects: cat and dog sounds (meow, purr, mew, bark, pant), little paws crawling or scurrying, ambient room and outdoor noise, playful magic chimes, happy reactions. No music, no spoken words.`,
    `Return JSON with "clips": each has title (short English), prompt (one or two English sentences describing the sound clearly, ending with a tag in square brackets such as "A small cat meowing once, cute and clear [meow]"; tags are lowercase letters and underscores and unique in this set), seconds (${durationMs ? Math.round(durationMs / 1000) : "one of 1, 2, 3, 5, 8"}), tags (up to 8 English keywords).`,
    `Make the clips clearly different from each other.`,
    brief ? `Extra direction from the admin: ${brief}` : "",
    taken.length ? `Do not reuse these titles: ${taken.join(", ")}` : "",
    takenCues.length ? `Do not use these tags, they exist already: ${takenCues.map((c) => `[${c}]`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const PLAN_SCHEMAS = {
  music: {
    type: "object",
    properties: {
      tracks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            prompt: { type: "string" },
            seconds: { type: "integer" },
            mood: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "prompt", "seconds", "mood", "tags"],
        },
      },
    },
    required: ["tracks"],
  },
  sfx: {
    type: "object",
    properties: {
      clips: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            prompt: { type: "string" },
            seconds: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "prompt", "seconds", "tags"],
        },
      },
    },
    required: ["clips"],
  },
};

/** Ask Gemini for a batch to generate. Returns normalized plans. */
export async function planWithGemini({ apiKey, kind, count, brief = "", durationMs, taken = [], takenCues = [], fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(GEMINI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: planInstruction(kind, { count, brief, durationMs, taken, takenCues }) }] }],
        generationConfig: {
          temperature: kind === "music" ? 1.2 : 1.1,
          responseMimeType: "application/json",
          responseSchema: PLAN_SCHEMAS[kind],
        },
      }),
    });
  } catch {
    throw new Error("gemini_unreachable");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error("invalid_key");
  if (res.status === 429) throw new Error("rate_limited");
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`gemini_failed: ${res.status} ${detail}`);
  }
  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("gemini_empty");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("gemini_bad_shape");
  }
  return normalizePlan(kind, parsed, { count, durationMs, takenCues });
}

export function normalizePlan(kind, parsed, { count, durationMs, takenCues = [] }) {
  if (kind === "music") {
    const tracks = Array.isArray(parsed?.tracks) ? parsed.tracks : [];
    return tracks.slice(0, count).flatMap((t) => {
      const title = String(t?.title ?? "").trim().slice(0, 120);
      const prompt = String(t?.prompt ?? "").trim().slice(0, 4000);
      if (!title || prompt.length < 10) return [];
      return [
        {
          title,
          prompt,
          mood: String(t?.mood ?? "").trim().slice(0, 40),
          durationMs: durationMs ?? clampInt(Number(t?.seconds) * 1000, MUSIC.minMs, MUSIC.maxMs, 60_000),
          tags: cleanTags(t?.tags).slice(0, 10),
        },
      ];
    });
  }
  const used = new Set(takenCues);
  const clips = Array.isArray(parsed?.clips) ? parsed.clips : [];
  return clips.slice(0, count).flatMap((c) => {
    const title = String(c?.title ?? "").trim().slice(0, 120);
    const rawPrompt = String(c?.prompt ?? "").trim().slice(0, 2000);
    if (!title || rawPrompt.length < 5) return [];
    const split = splitSfxPrompt(rawPrompt);
    let cue = split.cue ?? cueFromTitle(title);
    if (used.has(cue)) cue = `${cue}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
    if (!CUE_RE.test(cue)) return [];
    used.add(cue);
    const seconds = Number.isFinite(Number(c?.seconds)) ? Number(c.seconds) : 2;
    return [
      {
        title,
        prompt: withCueTag(split.text || rawPrompt, cue),
        cue,
        durationMs: durationMs ?? clampInt(Math.round(seconds * 1000), SFX.minMs, SFX.maxMs, 2000),
        tags: cleanTags(c?.tags).slice(0, 8),
      },
    ];
  });
}
