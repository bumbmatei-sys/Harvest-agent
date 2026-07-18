/**
 * Stripe configuration — reads price IDs from required env vars.
 * Set these in Vercel for test or live mode.
 *
 * Price IDs are read at module load and MUST be present. A missing or empty
 * STRIPE_PRICE_* var throws immediately, so a misconfigured deploy fails loudly
 * at boot instead of silently falling back to a wrong-mode price and 500ing the
 * first real customer who clicks subscribe.
 */

// Every Stripe price env var this module requires. Keep in sync with .env.example.
const REQUIRED_PRICE_ENV_VARS = [
  'STRIPE_PRICE_PLUS_MONTHLY',
  'STRIPE_PRICE_PLUS_YEARLY',
  'STRIPE_PRICE_PRO_MONTHLY',
  'STRIPE_PRICE_PRO_YEARLY',
  'STRIPE_PRICE_MAX_MONTHLY',
  'STRIPE_PRICE_MAX_YEARLY',
  'STRIPE_PRICE_ULTRA_MONTHLY',
  'STRIPE_PRICE_ULTRA_YEARLY',
  'STRIPE_PRICE_AI_MONTHLY',
] as const;

type RequiredPriceEnvVar = (typeof REQUIRED_PRICE_ENV_VARS)[number];

/**
 * Read all required price env vars, collecting every missing/empty one so the
 * error names them all in a single message (a founder fixing this from a phone
 * gets the full list in one Vercel log line, not one deploy cycle per var).
 * Empty string is treated as missing — Vercel vars set to "" are a real failure
 * mode.
 */
function readRequiredPriceEnv(): Record<RequiredPriceEnvVar, string> {
  const values = {} as Record<RequiredPriceEnvVar, string>;
  const missing: string[] = [];
  for (const name of REQUIRED_PRICE_ENV_VARS) {
    const value = process.env[name];
    if (!value) {
      missing.push(name);
    } else {
      values[name] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required Stripe price env var(s): ${missing.join(', ')}. ` +
        `Set ${missing.length === 1 ? 'it' : 'them'} in the Vercel project ` +
        `environment (Settings → Environment Variables) and redeploy.`
    );
  }
  return values;
}

const PRICE_ENV = readRequiredPriceEnv();

// Plan price IDs (monthly + yearly)
export const PLAN_PRICES: Record<string, { monthly: string; yearly: string }> = {
  plus: {
    monthly: PRICE_ENV.STRIPE_PRICE_PLUS_MONTHLY,
    yearly: PRICE_ENV.STRIPE_PRICE_PLUS_YEARLY,
  },
  pro: {
    monthly: PRICE_ENV.STRIPE_PRICE_PRO_MONTHLY,
    yearly: PRICE_ENV.STRIPE_PRICE_PRO_YEARLY,
  },
  max: {
    monthly: PRICE_ENV.STRIPE_PRICE_MAX_MONTHLY,
    yearly: PRICE_ENV.STRIPE_PRICE_MAX_YEARLY,
  },
  ultra: {
    monthly: PRICE_ENV.STRIPE_PRICE_ULTRA_MONTHLY,
    yearly: PRICE_ENV.STRIPE_PRICE_ULTRA_YEARLY,
  },
};

// AI Assistant price ID — active $200/mo recurring price for the AI Assistant.
export const AI_ASSISTANT_MONTHLY = PRICE_ENV.STRIPE_PRICE_AI_MONTHLY;

/**
 * Platform application-fee rate per plan, applied to money that flows through a
 * tenant's connected account via a destination charge (donations AND paid event
 * tickets). Single source of truth so the two money paths can never charge a
 * different platform fee for the same plan. A missing plan defaults to 0.
 */
export const PLATFORM_FEE_MAP: Record<string, number> = {
  plus: 0.15,
  pro: 0.10,
  max: 0.05,
  ultra: 0,
};

// Reverse mapping: price ID → plan name (for webhook)
export function getPlanFromPriceId(priceId: string): string | null {
  for (const [plan, prices] of Object.entries(PLAN_PRICES)) {
    if (prices.monthly === priceId || prices.yearly === priceId) return plan;
  }
  return null;
}
