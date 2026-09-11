import { createClient } from "@supabase/supabase-js";

/**
 * Accounts and points. One shared Supabase client keeps the session in
 * localStorage; pet-db.js reuses it so pets are scoped to the signed-in user.
 */

export const STARTING_POINTS = 10;
export const TALK_COST = 1;

let client = null;

function readEnv(name) {
  const env = import.meta.env || {};
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function getSupabase() {
  if (client) return client;
  const url = readEnv("VITE_SUPABASE_URL");
  const key = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export async function getSession() {
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  return session ?? null;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export function onAuthChange(callback) {
  const {
    data: { subscription },
  } = getSupabase().auth.onAuthStateChange((event, session) => callback(event, session));
  return () => subscription.unsubscribe();
}

async function readJson(res) {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function signInWithPassword(email, password) {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyAuthError(error.message));
}

/**
 * Create an account. Prefers the server route (instant, no confirmation mail);
 * falls back to Supabase sign-up when the server key is not set up.
 * Resolves to { signedIn: boolean }.
 */
export async function registerWithPassword(email, password) {
  let useFallback = false;
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await readJson(res);
    if (res.ok) {
      await signInWithPassword(email, password);
      return { signedIn: true };
    }
    if (res.status === 503 || res.status === 404 || res.status === 405) useFallback = true;
    else throw new Error(data.error || "Could not create the account.");
  } catch (err) {
    if (!useFallback && err instanceof TypeError) useFallback = true; // network / no server
    else if (!useFallback) throw err;
  }
  const { data, error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw new Error(friendlyAuthError(error.message));
  return { signedIn: !!data.session };
}

export async function signInWithGoogle() {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw new Error(friendlyAuthError(error.message));
}

export async function signOut() {
  await getSupabase().auth.signOut();
}

function friendlyAuthError(message) {
  if (/invalid login credentials/i.test(message)) return "That email or password is not right.";
  if (/unsupported provider|provider is not enabled/i.test(message)) {
    return "Google sign-in is not turned on yet. Use email instead.";
  }
  if (/already registered|already exists/i.test(message)) {
    return "An account with this email already exists. Try signing in.";
  }
  return message;
}

/** { points, isAdmin, email } for the signed-in user, or null. */
export async function fetchProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("points, is_admin, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    email: user.email ?? data?.email ?? "",
    points: data?.points ?? 0,
    isAdmin: !!data?.is_admin,
  };
}

/** Spend points. Resolves { ok, points }. */
export async function spendPoints(amount = TALK_COST, reason = "talk") {
  const { data, error } = await getSupabase().rpc("spend_points", {
    p_amount: amount,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return { ok: !!data?.ok, points: Number(data?.points ?? 0) };
}

export async function listPacks() {
  const { data, error } = await getSupabase()
    .from("point_packs")
    .select("id, label, points, price_cents, currency, badge, sort, active")
    .order("sort", { ascending: true })
    .order("price_cents", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchBillingStatus() {
  try {
    const res = await fetch("/api/billing-status");
    if (!res.ok) return { configured: false };
    return await readJson(res);
  } catch {
    return { configured: false };
  }
}

/** Ask the server for a Stripe Checkout URL and go there. */
export async function startCheckout(packId) {
  const session = await getSession();
  if (!session) throw new Error("Sign in to buy points.");
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ packId }),
  });
  const data = await readJson(res);
  if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout.");
  return data.url;
}

export function money(cents, currency = "usd") {
  const symbols = { usd: "$", thb: "฿", eur: "€", gbp: "£" };
  const sym = symbols[String(currency).toLowerCase()] ?? `${String(currency).toUpperCase()} `;
  const amount = cents / 100;
  return `${sym}${amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---- Admin -----------------------------------------------------------------

export async function adminListUsers() {
  const { data, error } = await getSupabase().rpc("admin_list_users");
  if (error) throw new Error(friendlyAdminError(error.message));
  return data ?? [];
}

export async function adminGrantPoints(userId, delta, note = "") {
  const { data, error } = await getSupabase().rpc("admin_grant_points", {
    p_user_id: userId,
    p_delta: delta,
    p_note: note,
  });
  if (error) throw new Error(friendlyAdminError(error.message));
  return Number(data ?? 0);
}

export async function adminSetAdmin(userId, isAdmin) {
  const { error } = await getSupabase().rpc("admin_set_admin", {
    p_user_id: userId,
    p_is_admin: isAdmin,
  });
  if (error) throw new Error(friendlyAdminError(error.message));
}

export async function adminSavePack(pack) {
  const row = {
    id: pack.id,
    label: pack.label,
    points: pack.points,
    price_cents: pack.price_cents,
    currency: pack.currency || "usd",
    badge: pack.badge || null,
    sort: pack.sort ?? 99,
    active: pack.active !== false,
  };
  const { error } = await getSupabase().from("point_packs").upsert(row, { onConflict: "id" });
  if (error) throw new Error(friendlyAdminError(error.message));
}

export async function adminDeletePack(id) {
  const { error } = await getSupabase().from("point_packs").delete().eq("id", id);
  if (error) throw new Error(friendlyAdminError(error.message));
}

function friendlyAdminError(message) {
  if (/admins_only/.test(message)) return "Admins only.";
  if (/cannot_demote_self/.test(message)) return "You cannot remove your own admin access.";
  if (/unknown_user/.test(message)) return "That user no longer exists.";
  if (/bad_amount/.test(message)) return "Enter a whole number of points (not zero).";
  return message;
}

// ---- Coupons ---------------------------------------------------------------

const COUPON_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short shareable code, e.g. MOMO-K7Q2XW9P. */
export function generateCouponCode() {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `MOMO-${Array.from(bytes, (b) => COUPON_ALPHABET[b % COUPON_ALPHABET.length]).join("")}`;
}

/** Same canonical form the database uses: letters, digits, hyphens, upper case. */
export function normalizeCouponCode(code) {
  return String(code ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "")
    .toUpperCase();
}

export const COUPON_ERRORS = {
  invalid: "That coupon code is not valid.",
  inactive: "This coupon is no longer active.",
  expired: "This coupon has expired.",
  exhausted: "This coupon has already been fully redeemed.",
  already_redeemed: "You have already redeemed this coupon.",
};

/** Redeem a code for the signed-in user. Resolves { points, balance }; throws a friendly message. */
export async function redeemCoupon(code) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) throw new Error(COUPON_ERRORS.invalid);
  const { data, error } = await getSupabase().rpc("redeem_point_coupon", { p_code: normalized });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(COUPON_ERRORS[data?.error] ?? COUPON_ERRORS.invalid);
  return { points: Number(data.points ?? 0), balance: Number(data.balance ?? 0) };
}

const COUPON_COLUMNS =
  "id, code, points, max_redemptions, redemption_count, expires_at, batch_id, note, active, created_at";

export async function adminListCoupons() {
  const { data, error } = await getSupabase()
    .from("point_coupons")
    .select(COUPON_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(friendlyAdminError(error.message));
  return data ?? [];
}

/**
 * Create one custom code or a batch of generated ones.
 * { points, quantity, code?, maxRedemptions (null = unlimited), expiresAt?, note? }
 */
export async function adminCreateCoupons({ points, quantity = 1, code, maxRedemptions = 1, expiresAt = null, note = "" }) {
  const user = await getUser();
  const batchId = crypto.randomUUID();
  const custom = code ? normalizeCouponCode(code) : "";
  const rows = [];
  const seen = new Set();
  while (rows.length < quantity) {
    const next = custom || generateCouponCode();
    if (seen.has(next)) continue;
    seen.add(next);
    rows.push({
      code: next,
      points,
      max_redemptions: maxRedemptions,
      expires_at: expiresAt,
      batch_id: batchId,
      note: note || null,
      created_by: user?.id ?? null,
      active: true,
    });
  }
  const { data, error } = await getSupabase().from("point_coupons").insert(rows).select(COUPON_COLUMNS);
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) throw new Error("That code is already in use.");
    throw new Error(friendlyAdminError(error.message));
  }
  return { batchId, coupons: data ?? [] };
}

export async function adminUpdateCoupon(id, patch) {
  const { data, error } = await getSupabase()
    .from("point_coupons")
    .update(patch)
    .eq("id", id)
    .select(COUPON_COLUMNS)
    .single();
  if (error) throw new Error(friendlyAdminError(error.message));
  return data;
}
