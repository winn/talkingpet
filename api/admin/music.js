import { MUSIC, cleanTags, clampInt, composeMusic, storagePath } from "../../server/audio.js";
import { json, jsonError, readJson } from "../../server/http.js";
import { getProviderKey } from "../../server/settings.js";
import { requireAdmin } from "../../server/supabase.js";

export const config = { maxDuration: 300 };

const COLUMNS = "id, title, prompt, mood, storage_path, duration_ms, model_id, tags, active, created_at";

/** POST /api/admin/music { title, prompt, mood?, durationMs, tags? } → composes and stores a track. */
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const body = await readJson(request);
  const title = String(body.title ?? "").trim().slice(0, 120);
  const prompt = String(body.prompt ?? "").trim().slice(0, 4000);
  const mood = String(body.mood ?? "").trim().slice(0, 40);
  const durationMs = clampInt(body.durationMs, MUSIC.minMs, MUSIC.maxMs, 0);
  if (!title) return jsonError("bad_title", "Give the track a title.", 400);
  if (prompt.length < 5) return jsonError("bad_prompt", "Describe the music in a sentence or two.", 400);
  if (!durationMs) return jsonError("bad_duration", "Length must be between 10 seconds and 5 minutes.", 400);

  try {
    const apiKey = await getProviderKey(auth.client, "elevenlabs");
    const audio = await composeMusic({ apiKey, prompt, durationMs });
    const path = storagePath();
    const { error: uploadError } = await auth.client.storage
      .from(MUSIC.bucket)
      .upload(path, audio, { contentType: "audio/mpeg", upsert: false });
    if (uploadError) throw new Error(`upload_failed: ${uploadError.message}`);
    const { data: row, error } = await auth.client
      .from("bgm_tracks")
      .insert({
        title,
        prompt,
        mood,
        storage_path: path,
        duration_ms: durationMs,
        model_id: MUSIC.model,
        tags: cleanTags(body.tags),
        created_by: auth.user.id,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      await auth.client.storage.from(MUSIC.bucket).remove([path]);
      throw new Error(error.message);
    }
    return json({ track: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not compose the track.";
    const status = /invalid_key|missing_/.test(message) ? 400 : /unreachable/.test(message) ? 502 : 500;
    return jsonError(message.split(":")[0], message, status);
  }
}
