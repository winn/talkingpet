import { CUE_RE, SFX, cleanTags, clampInt, composeSfx, cueFromTitle, splitSfxPrompt, storagePath, withCueTag } from "../../server/audio.js";
import { json, jsonError, readJson } from "../../server/http.js";
import { getProviderKey } from "../../server/settings.js";
import { requireAdmin } from "../../server/supabase.js";

export const config = { maxDuration: 120 };

const COLUMNS = "id, title, prompt, cue, storage_path, duration_ms, model_id, tags, active, created_at";

/** POST /api/admin/sfx { title, prompt, durationMs, cue?, tags? } → generates and stores a clip. */
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const body = await readJson(request);
  const title = String(body.title ?? "").trim().slice(0, 120);
  const rawPrompt = String(body.prompt ?? "").trim().slice(0, 2000);
  const durationMs = clampInt(body.durationMs, SFX.minMs, SFX.maxMs, 0);
  if (!title) return jsonError("bad_title", "Give the sound a title.", 400);
  if (rawPrompt.length < 5) return jsonError("bad_prompt", "Describe the sound in a sentence.", 400);
  if (!durationMs) return jsonError("bad_duration", "Length must be between 0.5 and 30 seconds.", 400);

  const split = splitSfxPrompt(rawPrompt);
  const cue = String(body.cue ?? split.cue ?? cueFromTitle(title)).trim().toLowerCase();
  if (!CUE_RE.test(cue)) return jsonError("bad_sfx_cue", "Tags are lowercase letters, digits and underscores, like [meow].", 400);
  const storedPrompt = withCueTag(split.text || rawPrompt, cue);
  const text = splitSfxPrompt(storedPrompt).text;
  if (text.length < 3) return jsonError("bad_prompt", "Describe the sound in a sentence.", 400);

  try {
    const apiKey = await getProviderKey(auth.client, "elevenlabs");
    const audio = await composeSfx({ apiKey, text, durationMs });
    const path = storagePath();
    const { error: uploadError } = await auth.client.storage
      .from(SFX.bucket)
      .upload(path, audio, { contentType: "audio/mpeg", upsert: false });
    if (uploadError) throw new Error(`upload_failed: ${uploadError.message}`);
    const { data: row, error } = await auth.client
      .from("sfx_clips")
      .insert({
        title,
        prompt: storedPrompt,
        cue,
        storage_path: path,
        duration_ms: durationMs,
        model_id: SFX.model,
        tags: cleanTags(body.tags),
        created_by: auth.user.id,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      await auth.client.storage.from(SFX.bucket).remove([path]);
      if (error.code === "23505") throw new Error("sfx_cue_taken");
      throw new Error(error.message);
    }
    return json({ clip: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not make the sound.";
    const status = /invalid_key|missing_|sfx_cue_taken/.test(message) ? 400 : /unreachable/.test(message) ? 502 : 500;
    return jsonError(message.split(":")[0], message, status);
  }
}
