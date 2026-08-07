/**
 * Stripe configuration — reads price IDs from env vars.
 * Set these in Vercel for test or live mode.
 * Falls back to test price IDs if env vars are not set.
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

// AI Assistant price IDs
// Active $200/mo recurring price for the AI Assistant.
// If env var is not set, falls back to the known active price ID.
export const AI_ASSISTANT_MONTHLY = process.env.STRIPE_PRICE_AI_MONTHLY ?? 'price_1TmgRP1YKkcSbTf3wjxEsdr';
export const AI_ASSISTANT_SETUP = process.env.STRIPE_PRICE_AI_SETUP ?? 'price_1TjKTd1YKkcSbTf3tQVxQfC5';

/**
 * Platform application-fee rate per plan, applied to money that flows through a
 * tenant's connected account via a destination charge (donations AND paid event
 * tickets). Single source of truth so the two money paths can never charge a
 * different platform fee for the same plan. A missing plan defaults to 0.
 *
 * ZERO ON EVERY TIER. Harvest takes no cut of a donation or a paid ticket on
 * any plan — the plans sell features and capacity, not a share of giving. A
 * destination charge with an application fee of 0 sends the whole amount to the
 * connected account.
 *
 * This used to be mirrored by hand into `PLAN_FEATURES[plan].donationRetention`
 * / `PLAN_DONATION_RETENTION` as `100 - fee * 100`, so customers could be shown
 * what they keep. Both are gone: the mirror is what once let the app advertise
 * "keeps 100%" while charging 2.5%, and at a flat 0% the retention number is a
 * constant 100 that says nothing. Customer-facing surfaces now render the FEE
 * from this map. Keep this the only place a rate is written down.
 */
export const PLATFORM_FEE_MAP: Record<string, number> = {
  plus: 0,
  pro: 0,
  max: 0,
};

// Reverse mapping: price ID → plan name (for webhook)
export function getPlanFromPriceId(priceId: string): string | null {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (prices.monthly === priceId || prices.yearly === priceId) return plan;
  }
  return null;
}
