/** Read an env var, stripping quotes that `vercel env pull` sometimes leaves behind. */
export function env(name, fallback = "") {
  const raw = process.env[name] ?? fallback;
  return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

export function supabaseUrl() {
  return env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
}

/** Publishable (anon) key: enough to verify a user's access token. */
export function supabaseAnonKey() {
  return env("SUPABASE_ANON_KEY") || env("VITE_SUPABASE_PUBLISHABLE_KEY");
}

/** Secret / service-role key: bypasses RLS. Server only. */
export function supabaseSecretKey() {
  return env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
}

export function stripeSecretKey() {
  return env("STRIPE_SECRET_KEY");
}

export function stripeWebhookSecret() {
  return env("STRIPE_WEBHOOK_SECRET");
}
