import { jsonError, json, readJson, requestOrigin } from "../server/http.js";
import { findActivePack } from "../server/points.js";
import { getStripe } from "../server/stripe.js";
import { adminClient, anonClient, userFromRequest } from "../server/supabase.js";

/**
 * POST /api/checkout { packId }  (Authorization: Bearer <supabase access token>)
 * Starts a one-time Stripe Checkout for a point pack. Points are added by the
 * webhook once Stripe reports the payment.
 */
export async function POST(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("not_signed_in", "Sign in to buy points.", 401);

  const stripe = getStripe();
  if (!stripe) {
    return jsonError("payments_off", "Payments are not set up yet. Please try again later.", 503);
  }

  const { packId } = await readJson(request);
  const reader = adminClient() ?? anonClient();
  const pack = await findActivePack(reader, packId);
  if (!pack) return jsonError("unknown_pack", "That point pack is not available.", 400);

  let customerId;
  const admin = adminClient();
  if (admin) {
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    customerId = profile?.stripe_customer_id || undefined;
  }

  const origin = requestOrigin(request);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      allow_promotion_codes: true,
      customer: customerId,
      customer_creation: customerId ? undefined : "always",
      customer_email: customerId ? undefined : user.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pack.currency,
            unit_amount: pack.price_cents,
            product_data: {
              name: `Paint Momo — ${pack.label}`,
              description: `${pack.points.toLocaleString("en-US")} points`,
            },
          },
        },
      ],
      client_reference_id: user.id,
      metadata: { user_id: user.id, pack_id: pack.id, points: String(pack.points) },
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    if (!session.url) return jsonError("checkout_fail", "Could not start checkout.", 500);
    return json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start checkout.";
    return jsonError("checkout_fail", message, 502);
  }
}
