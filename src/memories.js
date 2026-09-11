// Memories: what a pet remembers about its friend between chats.
//
// The hosted widget exposes its conversation through the public store on
// window.ChatWidget (getState().chatHistory) and also persists it in
// localStorage under `botnoi_history_<id>` keys, both as
// { sender, text, uiText, timestamp } items. When a talk session ends we read
// the turns newer than the session start, send them to the server to be
// summarised, and store the resulting facts in `public.user_memories`, scoped
// to the account by row level security. Nothing here reads the widget's source.
import { getSession, getSupabase } from "./auth.js";

const TABLE = "user_memories";
export const HISTORY_KEY_PREFIX = "botnoi_history_";
const USER_SENDERS = new Set(["user", "me", "human", "friend", "child"]);

export async function listMemories() {
  const session = await getSession();
  if (!session?.user) return [];
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select("id, content, pet_name, created_at")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
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
    const text = String(item.text ?? item.uiText ?? item.message ?? "").trim();
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
