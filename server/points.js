/**
 * Pure helpers shared by the checkout and webhook functions. They take the
 * Supabase client as a parameter so tests can pass a fake.
 */

export const MAX_PACK_POINTS = 100000;

/** Read the purchase a Checkout Session represents, or null if it is not ours / not paid. */
export function purchaseFromSession(session) {
  if (!session || typeof session !== "object") return null;
  if (session.payment_status && session.payment_status !== "paid") return null;
  const meta = session.metadata || {};
  const userId = session.client_reference_id || meta.user_id;
  const packId = meta.pack_id;
  const points = Number.parseInt(meta.points, 10);
  if (!userId || !packId || !Number.isInteger(points) || points <= 0 || points > MAX_PACK_POINTS) {
    return null;
  }
  return {
    userId,
    packId,
    points,
    ref: `stripe:${session.id}`,
    amountCents: Number(session.amount_total ?? 0),
    currency: String(session.currency || "usd"),
    customerId: typeof session.customer === "string" ? session.customer : null,
  };
}

/** Add purchased points once per Stripe session (the ledger `ref` is unique). */
export async function creditPurchase(admin, purchase) {
  const note = `${purchase.packId} · ${(purchase.amountCents / 100).toFixed(2)} ${purchase.currency.toUpperCase()}`;
  const { data, error } = await admin.rpc("apply_points", {
    p_user_id: purchase.userId,
    p_delta: purchase.points,
    p_reason: "purchase",
    p_ref: purchase.ref,
    p_note: note,
    p_actor: null,
  });
  if (error) throw new Error(error.message || "apply_points failed");
  if (purchase.customerId) {
    await admin
      .from("profiles")
      .update({ stripe_customer_id: purchase.customerId })
      .eq("user_id", purchase.userId);
  }
  return data;
}

/** Look up an active pack. Works with the anon client because active packs are public. */
export async function findActivePack(client, packId) {
  if (!packId || typeof packId !== "string") return null;
  const { data, error } = await client
    .from("point_packs")
    .select("id, label, points, price_cents, currency, active")
    .eq("id", packId)
    .maybeSingle();
  if (error || !data || data.active === false) return null;
  return data;
}
