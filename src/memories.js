// Memories: what a pet remembers about its friend between chats.
//
// The hosted widget exposes its conversation through the public store on
// window.ChatWidget (getState().chatHistory) and also persists it in
// localStorage under `botnoi_history_<id>` keys. User turns are usually
// { sender, text, uiText, timestamp }; bot turns often use
// { sender, reply: { type, text }, timestamp } instead of a top-level text.
// When a talk session ends we read the turns newer than the session start,
// send them to the server to be summarised, and store the resulting facts in
// `public.user_memories`, scoped to the account by row level security. Nothing
// here reads the widget's source.
import { getSession, getSupabase } from "./auth.js";
import { extractMemories } from "./memory-rules.js";
import { isInternalPromptText } from "./prompt-filter.js";

export { isInternalPromptText } from "./prompt-filter.js";

const TABLE = "user_memories";
export const HISTORY_KEY_PREFIX = "botnoi_history_";
const USER_SENDERS = new Set(["user", "me", "human", "friend", "child"]);

/**
 * Plain text from a widget history item. Bot replies often live under
 * `reply.text` rather than `text` / `uiText`. Prompt leaks are dropped.
 */
export function historyItemText(item) {
  if (!item || typeof item !== "object") return "";
  const direct =
    item.text ??
    item.uiText ??
    item.message ??
    item.content ??
    item.utterance ??
    item.transcript ??
    item.asrText ??
    item.speech;
  let text = "";
  if (direct != null && String(direct).trim()) text = String(direct).trim();
  else {
    const reply = item.reply;
    if (typeof reply === "string") text = reply.trim();
    else if (reply && typeof reply === "object") {
      const nested =
        reply.text ?? reply.uiText ?? reply.message ?? reply.content;
      if (nested != null) text = String(nested).trim();
    }
  }
  if (!text || isInternalPromptText(text)) return "";
  return text;
}

export async function listMemories() {
  const session = await getSession();
  if (!session?.user) return [];
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("id, key, value, pet_name, created_at")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Add or replace one fact by hand. Resolves the stored row. */
export async function saveMemory({ key, value, petName = null }) {
  const session = await getSession();
  if (!session?.user) throw new Error("Sign in first.");
  const { data, error } = await getSupabase()
    .from(TABLE)
    .upsert(
      {
        user_id: session.user.id,
        key,
        value,
        pet_name: petName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" },
    )
    .select("id, key, value, pet_name, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteMemory(id) {
  if (!id) return false;
  const { error } = await getSupabase().from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

export async function deleteAllMemories() {
  const session = await getSession();
  if (!session?.user) return false;
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq("user_id", session.user.id);
  if (error) throw new Error(error.message);
  return true;
}

/** Every history item the widget has persisted, across all its keys. */
export function readWidgetHistory(storage = globalThis.localStorage) {
  if (!storage) return [];
  const items = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(HISTORY_KEY_PREFIX)) continue;
    try {
      const parsed = JSON.parse(storage.getItem(key) || "[]");
      if (Array.isArray(parsed)) items.push(...parsed);
    } catch {}
  }
  return items;
}

/** The live conversation from the widget's public store, if it offers one. */
export function readWidgetStoreHistory(win = globalThis.window) {
  try {
    const history = win?.ChatWidget?.getState?.()?.chatHistory;
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

/**
 * Turns from `since` onwards as { role: "user" | "pet", text }. The store and
 * localStorage usually hold the same items, so repeats are dropped.
 */
export function transcriptSince(items, since = 0) {
  const turns = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const stamp = Number(item.timestamp ?? item.time ?? 0);
    if (since && stamp && stamp < since) continue;
    const text = historyItemText(item);
    if (!text) continue;
    const who = String(item.sender ?? item.role ?? "").toLowerCase();
    const role = USER_SENDERS.has(who) ? "user" : "pet";
    const key = `${role}|${stamp}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    turns.push({ role, text });
  }
  return turns;
}

/**
 * Send the session to be remembered. Resolves the memories added (possibly
 * none). Never throws: a failed summary should not get in the way of leaving.
 */
export async function rememberSession({
  pet,
  language,
  transcript,
  fetchImpl = fetch,
}) {
  if (!pet || !transcript?.some((t) => t.role === "user")) return [];
  try {
    const session = await getSession();
    if (!session) return [];
    const res = await fetchImpl("/api/memories/summarize", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        petId: pet.id,
        petName: pet.name,
        language,
        transcript,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[PaintMomo] remember failed:", data.error || res.status);
      return [];
    }
    return Array.isArray(data.added) ? data.added : [];
  } catch (err) {
    console.warn("[PaintMomo] remember failed:", err);
    return [];
  }
}

/**
 * On-device fallback when the LLM summary finds nothing or the API fails.
 * Catches clear kid phrases like "ชอบพิซซ่าฮาวายเอี้ยน" without a round-trip.
 */
export async function rememberFromRules({ pet, transcript }) {
  if (!pet || !transcript?.some((t) => t.role === "user")) return [];
  const byKey = new Map();
  let noteIndex = 1;
  for (const turn of transcript) {
    if (turn.role !== "user") continue;
    for (const fact of extractMemories(turn.text, { noteIndex })) {
      byKey.set(fact.key, fact.value);
      if (String(fact.key).startsWith("note_")) noteIndex++;
    }
  }
  if (!byKey.size) return [];
  const added = [];
  for (const [key, value] of byKey) {
    try {
      added.push(await saveMemory({ key, value, petName: pet.name }));
    } catch (err) {
      console.warn("[PaintMomo] local remember failed:", err);
    }
  }
  return added;
}
