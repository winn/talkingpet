import { env } from "./env.js";

/** Providers whose key an admin can set from /admin without a redeploy. */
export const PROVIDERS = {
  elevenlabs: {
    setting: "elevenlabs_api_key",
    envVar: "ELEVENLABS_API_KEY",
    verifyUrl: () => `${env("ELEVENLABS_API_BASE") || "https://api.elevenlabs.io"}/v1/user`,
    verifyHeaders: (key) => ({ "xi-api-key": key }),
  },
  gemini: {
    setting: "gemini_api_key",
    envVar: "GEMINI_API_KEY",
    verifyUrl: () => "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    verifyHeaders: (key) => ({ "x-goog-api-key": key }),
  },
  botnoi: {
    setting: "botnoi_voice_token",
    envVar: "BOTNOI_VOICE_TOKEN",
    verifyUrl: () =>
      `${(env("BOTNOI_VOICE_API_BASE") || "https://api-voicebot-stg.botnoigroup.com").replace(/\/$/, "")}/platform-config/tools`,
    verifyHeaders: (key) => ({ authorization: `Bearer ${key}`, accept: "application/json" }),
  },
  botnoi_call: {
    setting: "botnoi_connector_key",
    envVar: "BOTNOI_CONNECTOR_KEY",
  },
};

export function isProvider(name) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, name);
}

async function readStoredKey(client, provider) {
  const { data, error } = await client
    .from("app_settings")
    .select("value, updated_at, updated_by")
    .eq("key", PROVIDERS[provider].setting)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value?.trim() ?? "";
  return value ? { value, updatedAt: data.updated_at, updatedBy: data.updated_by } : null;
}

/** Where the key in use comes from, plus the last 4 characters. Never the key. */
export async function describeProviderKey(client, provider) {
  const stored = await readStoredKey(client, provider);
  const envKey = env(PROVIDERS[provider].envVar);
  const active = stored?.value ?? envKey;
  return {
    provider,
    source: stored ? "database" : envKey ? "environment" : "none",
    last4: active ? active.slice(-4) : null,
    updatedAt: stored?.updatedAt ?? null,
    envFallbackAvailable: Boolean(envKey),
  };
}

/** Stored key wins over the deploy-time env var. */
export async function getProviderKey(client, provider) {
  const stored = await readStoredKey(client, provider);
  const key = stored?.value ?? env(PROVIDERS[provider].envVar);
  if (!key) throw new Error(`missing_${provider}_key`);
  return key;
}

export async function saveProviderKey(client, provider, value, userId) {
  const { error } = await client.from("app_settings").upsert({
    key: PROVIDERS[provider].setting,
    value,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  });
  if (error) throw new Error(error.message);
}

export async function clearProviderKey(client, provider) {
  const { error } = await client
    .from("app_settings")
    .delete()
    .eq("key", PROVIDERS[provider].setting);
  if (error) throw new Error(error.message);
}

/** A restricted ElevenLabs key answers 401 with missing_permissions; that is still a working key. */
async function restrictedButValid(res) {
  try {
    const body = await res.json();
    return body?.detail?.status === "missing_permissions";
  } catch {
    return false;
  }
}

/**
 * The call key is not a bearer token. Probe preview_call the way Talking Jelly does:
 * a close that does not mention api_key means the connector accepted it.
 */
function verifyBotnoiConnector(key) {
  if (typeof WebSocket !== "function") throw new Error("verify_unreachable");
  const url = `wss://voicebot-stg.botnoigroup.com/v1/preview_call?api_key=${encodeURIComponent(key)}&agent_id=${encodeURIComponent("agt_probe")}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (err) reject(err);
      else resolve();
    };
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      reject(new Error("verify_unreachable"));
      return;
    }
    const timer = setTimeout(() => finish(new Error("invalid_key")), 8000);
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string" && event.data.includes('"opened"')) finish();
    });
    ws.addEventListener("close", (event) => {
      const reason = String(event.reason || "");
      finish(/api_key/i.test(reason) ? new Error("invalid_key") : undefined);
    });
    ws.addEventListener("error", () => {
      /* close follows */
    });
  });
}

/** Ask the provider for the cheapest thing it offers, so a typo surfaces now. */
export async function verifyKey(provider, key, fetchImpl = fetch) {
  if (provider === "botnoi_call") return verifyBotnoiConnector(key);
  const spec = PROVIDERS[provider];
  let res;
  try {
    res = await fetchImpl(spec.verifyUrl(), { headers: spec.verifyHeaders(key) });
  } catch {
    throw new Error("verify_unreachable");
  }
  if (res.ok) return;
  if (provider === "elevenlabs" && (await restrictedButValid(res))) return;
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error("invalid_key");
  throw new Error("verify_unreachable");
}
