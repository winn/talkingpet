import { json } from "../server/http.js";
import { paymentsConfigured } from "../server/stripe.js";
import { supabaseSecretKey } from "../server/env.js";

/** GET /api/billing-status — is Stripe wired up? Lets the app show Buy vs. Soon. */
export function GET() {
  return json({
    configured: paymentsConfigured(),
    registration: supabaseSecretKey().length > 0 ? "instant" : "email",
  });
}
