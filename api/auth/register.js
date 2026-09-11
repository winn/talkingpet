import { jsonError, json, readJson } from "../../server/http.js";
import { adminClient } from "../../server/supabase.js";

/**
 * POST /api/auth/register { email, password }
 * Creates the account pre-confirmed with the service key, so there is no
 * email round trip. Without the key the app falls back to Supabase sign-up.
 */
export async function POST(request) {
  const { email, password } = await readJson(request);
  const emailOk = typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passwordOk = typeof password === "string" && password.length >= 8;
  if (!emailOk) return jsonError("valid_email", "Enter a valid email address.", 400);
  if (!passwordOk) return jsonError("password_len", "Password must be at least 8 characters.", 400);

  const admin = adminClient();
  if (!admin) {
    return jsonError("register_unavailable", "Instant sign-up is not configured.", 503);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
  });
  if (error) {
    if (/already|exists/i.test(error.message)) {
      return jsonError("email_taken", "An account with this email already exists. Try signing in.", 400);
    }
    return jsonError("create_fail", error.message, 400);
  }
  return json({ user: { id: data.user?.id, email: data.user?.email } });
}
