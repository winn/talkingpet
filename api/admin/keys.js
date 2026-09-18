import { json, jsonError, readJson } from "../../server/http.js";
import {
  clearProviderKey,
  describeProviderKey,
  getProviderKey,
  isProvider,
  saveProviderKey,
  verifyKey,
} from "../../server/settings.js";
import { requireAdmin } from "../../server/supabase.js";

/** GET /api/admin/keys?provider=elevenlabs — status without the key itself. */
export async function GET(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const provider = new URL(request.url).searchParams.get("provider") || "";
  if (!isProvider(provider)) return jsonError("bad_provider", "Unknown provider.", 400);
  try {
    return json(await describeProviderKey(auth.client, provider));
  } catch (err) {
    return jsonError("status_fail", err instanceof Error ? err.message : "Could not read the key.", 500);
  }
}

/**
 * POST /api/admin/keys { provider, action: "save" | "test" | "remove", key? }
 * Keys are verified with the provider before they are stored.
 */
export async function POST(request) {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("admins_only", "Admins only.", 403);
  const { provider, action, key } = await readJson(request);
  if (!isProvider(provider)) return jsonError("bad_provider", "Unknown provider.", 400);
  try {
    if (action === "save") {
      const value = String(key ?? "").trim();
      if (value.length < 10 || value.length > 500) {
        return jsonError("bad_key", "Paste the whole key.", 400);
      }
      await verifyKey(provider, value);
      await saveProviderKey(auth.client, provider, value, auth.user.id);
    } else if (action === "remove") {
      await clearProviderKey(auth.client, provider);
    } else if (action === "test") {
      await verifyKey(provider, await getProviderKey(auth.client, provider));
    } else {
      return jsonError("bad_action", "Unknown action.", 400);
    }
    return json({ ok: true, ...(await describeProviderKey(auth.client, provider)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed.";
    const status = /invalid_key|missing_/.test(message) ? 400 : /unreachable/.test(message) ? 502 : 500;
    return jsonError(message.split(":")[0], message, status);
  }
}
