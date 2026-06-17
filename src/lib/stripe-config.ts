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
export const AI_ASSISTANT_MONTHLY = process.env.STRIPE_PRICE_AI_MONTHLY ?? 'price_1TjKTd1YKkcSbTf3HSrtrxE9';
export const AI_ASSISTANT_SETUP = process.env.STRIPE_PRICE_AI_SETUP ?? 'price_1TjKTd1YKkcSbTf3tQVxQfC5';

// Reverse mapping: price ID → plan name (for webhook)
export function getPlanFromPriceId(priceId: string): string | null {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (prices.monthly === priceId || prices.yearly === priceId) return plan;
  }
  return null;
}
