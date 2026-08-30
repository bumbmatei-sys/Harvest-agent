/**
 * Stripe SUBSCRIPTION configuration — price IDs read from env vars.
 * Set these in Vercel for test or live mode.
 * Falls back to test price IDs if env vars are not set.
 *
 * ⚠️ SCHEDULED FOR REPLACEMENT. Harvest's subscription billing is moving to
 * Dodo Payments. Everything in this module — the plan price IDs and the reverse
 * price→plan lookup the subscription webhook uses — is Stripe-specific plumbing
 * that Dodo replaces wholesale. (The AI Assistant price IDs were listed here
 * too; they went with the Telegram assistant in THE-253 — see below.)
 * Do not invest in hardening it (typed env readers, required-env validation,
 * fallback removal); that work is thrown away at the cutover. Fix bugs, add
 * nothing.
 *
 * This module must stay free of donation and event-ticket concerns. Those are
 * Stripe Connect and are NOT moving: they live in `stripe-connect.ts`.
 */

// Plan price IDs (monthly + yearly)
export const PLAN_PRICES: Record<string, { monthly: string; yearly: string }> = {
  plus: {
    monthly: process.env.STRIPE_PRICE_PLUS_MONTHLY ?? 'price_1TjKTb1YKkcSbTf3kxXDuq5X',
    yearly: process.env.STRIPE_PRICE_PLUS_YEARLY ?? 'price_1TjKTb1YKkcSbTf3qzuvjmLU',
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? 'price_1TjKTc1YKkcSbTf3cZEjJoOf',
    yearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? 'price_1TjKTc1YKkcSbTf3rWZzmIYk',
  },
  max: {
    monthly: process.env.STRIPE_PRICE_MAX_MONTHLY ?? 'price_1TjKTc1YKkcSbTf3DHsyFJSF',
    yearly: process.env.STRIPE_PRICE_MAX_YEARLY ?? 'price_1TjKTc1YKkcSbTf3O5KzCkNr',
  },
};

// `AI_ASSISTANT_MONTHLY` / `AI_ASSISTANT_SETUP` — the retired Telegram
// assistant's $200/mo and setup Stripe prices — were REMOVED with it (THE-253).
// Nothing creates a Stripe AI Assistant subscription any more. The AI chat is a
// $20/mo DODO add-on; its ids live in lib/dodo/catalogue.ts, mapped to meanings
// rather than prices, and no figure for it belongs in this file.

// Reverse mapping: price ID → plan name (for webhook)
export function getPlanFromPriceId(priceId: string): string | null {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (prices.monthly === priceId || prices.yearly === priceId) return plan;
  }
  return null;
}
