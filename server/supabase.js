import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseSecretKey, supabaseUrl } from "./env.js";

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service client that bypasses RLS. Returns null when the secret key is not set. */
export function adminClient() {
  const url = supabaseUrl();
  const key = supabaseSecretKey();
  if (!url || !key) return null;
  return createClient(url, key, NO_SESSION);
}

/** Public client with the anon key. Sees only what RLS allows anonymous users. */
export function anonClient() {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return null;
  return createClient(url, key, NO_SESSION);
}

/** Resolve the signed-in user from a `Authorization: Bearer <access token>` header. */
export async function userFromRequest(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const client = anonClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
