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

/** Ask the provider for the cheapest thing it offers, so a typo surfaces now. */
export async function verifyKey(provider, key, fetchImpl = fetch) {
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
