import Stripe from "stripe";
import { stripeSecretKey } from "./env.js";

export function getStripe() {
  const key = stripeSecretKey();
  return key ? new Stripe(key) : null;
}

export function paymentsConfigured() {
  return stripeSecretKey().length > 0;
}
