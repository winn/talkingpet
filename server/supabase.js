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

/**
 * Client that acts as the caller (their access token, anon key). Every table
 * and storage rule is enforced by RLS, so no service key is needed for admin
 * work as long as the caller is an admin.
 */
export function userClient(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!token || !url || !key) return null;
  return createClient(url, key, {
    ...NO_SESSION,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Resolve { client, user } for an admin caller, or null. */
export async function requireAdmin(request) {
  const client = userClient(request);
  if (!client) return null;
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData?.user) return null;
  const { data: isAdmin } = await client.rpc("is_admin");
  if (!isAdmin) return null;
  return { client, user: userData.user };
}
