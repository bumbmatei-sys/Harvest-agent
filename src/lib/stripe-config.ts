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
  ultra: {
    monthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY ?? 'price_1TjKTc1YKkcSbTf3nLmjx30d',
    yearly: process.env.STRIPE_PRICE_ULTRA_YEARLY ?? 'price_1TjKTd1YKkcSbTf3I0M6RJsh',
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
 * ALSO MIRRORED BY HAND in `PLAN_FEATURES[plan].donationRetention` /
 * `PLAN_DONATION_RETENTION` (src/utils/plan-features.ts), which is the number
 * shown to customers as `100 - fee * 100`. That module cannot import this one —
 * it is pulled into ~20 client components and this module reads server-only
 * `STRIPE_PRICE_*` env vars at load. `plan-features.test.ts` asserts the two
 * agree, so changing a fee here fails CI until the retention value is updated
 * to match.
 */
export const PLATFORM_FEE_MAP: Record<string, number> = {
  plus: 0.015,
  pro: 0.015,
  max: 0.01,
  ultra: 0,
};

// Reverse mapping: price ID → plan name (for webhook)
export function getPlanFromPriceId(priceId: string): string | null {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (prices.monthly === priceId || prices.yearly === priceId) return plan;
  }
  return null;
}
