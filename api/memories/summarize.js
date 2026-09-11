import { json, jsonError, readJson } from "../../server/http.js";
import {
  normalizeTranscript,
  summarizeMemories,
} from "../../server/memories.js";
import { getProviderKey } from "../../server/settings.js";
import {
  adminClient,
  userClient,
  userFromRequest,
} from "../../server/supabase.js";

export const config = { maxDuration: 60 };

/**
 * POST /api/memories/summarize
 * { petId?, petName?, language?, transcript: [{ role|sender, text }] }
 * → { added: [{ id, key, value, pet_name, created_at }] }
 *
 * Called by the browser when a talk session ends. Reads the caller's existing
 * memories, asks Gemini for new facts, stores them for the caller only.
 *
 * With SUPABASE_SECRET_KEY set, the admin-saved Gemini key is used. Without
 * it, the caller's own session reads and writes their rows (row level
 * security) and the key must come from GEMINI_API_KEY.
 */
export async function POST(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);
  const service = adminClient() ?? userClient(request);
  if (!service)
    return jsonError("not_configured", "Server is not configured.", 500);

  const body = await readJson(request);
  const transcript = normalizeTranscript(body.transcript);
  if (!transcript.some((t) => t.role === "user")) return json({ added: [] });
  const language = body.language === "th" ? "th" : "en";
  const petName = String(body.petName ?? "")
    .trim()
    .slice(0, 60);
  const petId =
    String(body.petId ?? "")
      .trim()
      .slice(0, 80) || null;

  const { data: rows, error: readError } = await service
    .from("user_memories")
    .select("key, value")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (readError) return jsonError("db", readError.message, 500);
  const existing = rows ?? [];

  let apiKey;
  try {
    apiKey = await getProviderKey(service, "gemini");
  } catch (err) {
    const message = err instanceof Error ? err.message : "missing_gemini_key";
    return jsonError(
      message,
      "Memories are not set up yet: no Gemini key.",
      400,
    );
  }

  try {
    const memories = await summarizeMemories({
      apiKey,
      transcript,
      existing,
      petName,
      language,
    });
    if (!memories.length) return json({ added: [] });
    const { data: added, error: writeError } = await service
      .from("user_memories")
      .upsert(
        memories.map(({ key, value }) => ({
          user_id: user.id,
          key,
          value,
          pet_id: petId,
          pet_name: petName || null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,key" },
      )
      .select("id, key, value, pet_name, created_at");
    if (writeError) return jsonError("db", writeError.message, 500);
    return json({ added: added ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not remember.";
    const status = /invalid_key|missing_/.test(message)
      ? 400
      : /unreachable|rate_limited/.test(message)
        ? 502
        : 500;
    return jsonError(message.split(":")[0], message, status);
  }
}
