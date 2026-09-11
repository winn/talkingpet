const test = require("node:test");
const assert = require("node:assert/strict");

test("purchaseFromSession reads a paid checkout session", async () => {
  const { purchaseFromSession } = await import("../server/points.js");
  const purchase = purchaseFromSession({
    id: "cs_test_123",
    payment_status: "paid",
    client_reference_id: "user-1",
    amount_total: 999,
    currency: "usd",
    customer: "cus_9",
    metadata: { user_id: "user-1", pack_id: "pack_medium", points: "120" },
  });
  assert.deepEqual(purchase, {
    userId: "user-1",
    packId: "pack_medium",
    points: 120,
    ref: "stripe:cs_test_123",
    amountCents: 999,
    currency: "usd",
    customerId: "cus_9",
  });
});

test("purchaseFromSession rejects unpaid, foreign, or malformed sessions", async () => {
  const { purchaseFromSession } = await import("../server/points.js");
  const base = {
    id: "cs_1",
    payment_status: "paid",
    client_reference_id: "user-1",
    metadata: { pack_id: "p", points: "10" },
  };
  assert.equal(purchaseFromSession({ ...base, payment_status: "unpaid" }), null);
  assert.equal(purchaseFromSession({ ...base, metadata: { points: "10" } }), null);
  assert.equal(purchaseFromSession({ ...base, metadata: { pack_id: "p", points: "0" } }), null);
  assert.equal(purchaseFromSession({ ...base, metadata: { pack_id: "p", points: "lots" } }), null);
  assert.equal(purchaseFromSession({ ...base, metadata: { pack_id: "p", points: "999999" } }), null);
  assert.equal(purchaseFromSession(null), null);
});

test("creditPurchase applies points once per session and stores the Stripe customer", async () => {
  const { creditPurchase } = await import("../server/points.js");
  const calls = [];
  const fakeAdmin = {
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      return { data: 130, error: null };
    },
    from: (table) => ({
      update: (values) => ({
        eq: async (col, val) => {
          calls.push(["update", table, values, col, val]);
          return { error: null };
        },
      }),
    }),
  };
  const balance = await creditPurchase(fakeAdmin, {
    userId: "user-1",
    packId: "pack_medium",
    points: 120,
    ref: "stripe:cs_1",
    amountCents: 999,
    currency: "usd",
    customerId: "cus_9",
  });
  assert.equal(balance, 130);
  assert.deepEqual(calls[0], [
    "rpc",
    "apply_points",
    {
      p_user_id: "user-1",
      p_delta: 120,
      p_reason: "purchase",
      p_ref: "stripe:cs_1",
      p_note: "pack_medium · 9.99 USD",
      p_actor: null,
    },
  ]);
  assert.deepEqual(calls[1], ["update", "profiles", { stripe_customer_id: "cus_9" }, "user_id", "user-1"]);
});

test("creditPurchase surfaces database errors", async () => {
  const { creditPurchase } = await import("../server/points.js");
  const fakeAdmin = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
  await assert.rejects(
    creditPurchase(fakeAdmin, { userId: "u", packId: "p", points: 1, ref: "r", amountCents: 100, currency: "usd" }),
    /boom/,
  );
});

test("money formats minor units", async () => {
  const { money } = await import("../src/auth.js");
  assert.equal(money(499), "$4.99");
  assert.equal(money(1000), "$10");
  assert.equal(money(35000, "thb"), "฿350");
});

test("auth module rejects clearly when Supabase is not configured", async () => {
  const auth = await import("../src/auth.js");
  assert.throws(() => auth.getSupabase(), /Supabase is not configured/);
  assert.equal(auth.TALK_COST, 1);
});

test("coupon codes are generated and normalized consistently", async () => {
  const { generateCouponCode, normalizeCouponCode } = await import("../src/auth.js");
  const code = generateCouponCode();
  assert.match(code, /^MOMO-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(normalizeCouponCode(code), code);
  assert.equal(normalizeCouponCode(" momo-abc 123 "), "MOMO-ABC123");
  assert.equal(normalizeCouponCode("ทดสอบ"), "");
  assert.equal(normalizeCouponCode("AัB́C"), "ABC");
  assert.notEqual(generateCouponCode(), generateCouponCode());
});
