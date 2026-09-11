import { MUSIC, SFX, clampInt, planWithGemini } from "../../server/audio.js";
import { json, jsonError, readJson } from "../../server/http.js";
import { getProviderKey } from "../../server/settings.js";
import { requireAdmin } from "../../server/supabase.js";

export const config = { maxDuration: 60 };

/** POST /api/admin/plan { kind: "music" | "sfx", count, brief?, durationMs? } → list of things to generate. */
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const body = await readJson(request);
  const kind = body.kind === "music" ? "music" : body.kind === "sfx" ? "sfx" : null;
  if (!kind) return jsonError("bad_kind", "Plan music or sfx.", 400);
  const count = clampInt(body.count, 1, 50, 0);
  if (!count) return jsonError("bad_count", "Plan between 1 and 50 items.", 400);
  const limits = kind === "music" ? MUSIC : SFX;
  const durationMs = body.durationMs ? clampInt(body.durationMs, limits.minMs, limits.maxMs, undefined) : undefined;
  const brief = String(body.brief ?? "").trim().slice(0, 500);

  try {
    const table = kind === "music" ? "bgm_tracks" : "sfx_clips";
    const { data: existing } = await auth.client
      .from(table)
      .select(kind === "music" ? "title" : "title, cue")
      .order("created_at", { ascending: false })
      .limit(300);
    const taken = (existing ?? []).map((r) => r.title);
    const takenCues = kind === "sfx" ? (existing ?? []).map((r) => r.cue) : [];
    const apiKey = await getProviderKey(auth.client, "gemini");
    const plans = await planWithGemini({ apiKey, kind, count, brief, durationMs, taken, takenCues });
    return json({ plans });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not plan.";
    const status = /invalid_key|missing_/.test(message) ? 400 : /unreachable|rate_limited/.test(message) ? 502 : 500;
    return jsonError(message.split(":")[0], message, status);
  }
}
