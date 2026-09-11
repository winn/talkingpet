import Stripe from "stripe";
import { stripeSecretKey, stripeWebhookSecret } from "../../server/env.js";
import { json, jsonError } from "../../server/http.js";
import { creditPurchase, purchaseFromSession } from "../../server/points.js";
import { adminClient } from "../../server/supabase.js";

/**
 * POST /api/stripe/webhook — Stripe calls this after a Checkout payment.
 * checkout.session.completed / async_payment_succeeded → add the pack's points.
 */
export async function POST(request) {
  const secretKey = stripeSecretKey();
  const webhookSecret = stripeWebhookSecret();
  if (!secretKey || !webhookSecret) {
    return jsonError("stripe_off", "Stripe is not configured.", 503);
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return jsonError("no_signature", "Missing signature.", 400);

  const body = await request.text();
  const stripe = new Stripe(secretKey);
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "?";
    return jsonError("bad_signature", `Signature verification failed: ${reason}`, 400);
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const purchase = purchaseFromSession(event.data.object);
    if (purchase) {
      const admin = adminClient();
      if (!admin) return jsonError("no_service_key", "SUPABASE_SECRET_KEY is not set.", 503);
      try {
        await creditPurchase(admin, purchase);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "credit failed";
        return jsonError("credit_fail", reason, 500);
      }
    }
  }

  return json({ received: true, handled: event.type });
}
