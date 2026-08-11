/**
 * Dodo Payments credentials and mode.
 *
 * ⚠️ THIS MODULE THROWS AT IMPORT TIME IF A REQUIRED VARIABLE IS MISSING. That is
 * deliberate and it is the whole argument of #207, which was closed as dead work
 * only because hardening the STRIPE_* vars was throwaway effort ahead of this
 * migration. These are the variables that replace them, so the argument applies
 * here and is implemented here.
 *
 * There are NO `??` fallbacks to test values anywhere in this module. A fallback
 * is what turns "the secret is missing" — loud, at boot, in one place — into
 * "payments quietly went to the sandbox", which is discovered by a church whose
 * money never arrives. A missing variable must break the deploy, not the revenue.
 *
 * ─── Consequence, stated plainly ─────────────────────────────────────────────
 *
 * Because the webhook route imports this module, `next build` imports it too.
 * The sandbox variables below MUST be set in Vercel before this branch is
 * deployed or the build fails. That is the fail-fast behaviour working as
 * designed; it is not a surprise to debug later.
 *
 * 🔴 SANDBOX ONLY IN THIS PR. Do not put live keys in Vercel. Live mode is
 * refused outright below — the live catalogue does not exist, and reaching for a
 * live key is a stop condition, not a next step.
 */

/** Dodo's two API hosts. Test mode is the only one this build accepts. */
export const DODO_TEST_MODE = 'test_mode';
export const DODO_LIVE_MODE = 'live_mode';

export type DodoEnvironment = typeof DODO_TEST_MODE | typeof DODO_LIVE_MODE;

/**
 * Read a required environment variable or throw.
 *
 * Blank and whitespace-only count as missing: an env var set to an empty string
 * in a dashboard is a variable someone meant to fill in, and treating it as
 * present is the same silent-wrong-value failure as a fallback.
 */
export function requiredEnv(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `[dodo] Missing required environment variable ${name}. ` +
        'Dodo billing configuration has no fallback values by design — set it in ' +
        'the environment (sandbox credentials only) rather than defaulting to a ' +
        'test value that would bill the wrong catalogue silently.',
    );
  }
  return raw;
}

function requiredEnvironment(): DodoEnvironment {
  const raw = requiredEnv('DODO_PAYMENTS_ENVIRONMENT').trim();

  if (raw === DODO_LIVE_MODE) {
    throw new Error(
      `[dodo] DODO_PAYMENTS_ENVIRONMENT is "${DODO_LIVE_MODE}", which this build refuses. ` +
        'The Dodo catalogue in src/lib/dodo/catalogue.ts holds TEST-MODE product ids ' +
        'only; the live products have not been created. Running live against test ' +
        'product ids would fail every checkout, and pointing this build at live ' +
        'credentials is out of scope for REP-4 part 1.',
    );
  }

  if (raw !== DODO_TEST_MODE) {
    throw new Error(
      `[dodo] DODO_PAYMENTS_ENVIRONMENT must be "${DODO_TEST_MODE}" (received "${raw}").`,
    );
  }

  return DODO_TEST_MODE;
}

export interface DodoConfig {
  /** Server-side API key. Never reaches the browser. */
  readonly apiKey: string;
  /** Standard Webhooks signing secret, `whsec_`-prefixed base64. */
  readonly webhookSecret: string;
  readonly environment: DodoEnvironment;
}

/**
 * Resolved configuration.
 *
 * Evaluated at module load, so an incomplete environment fails immediately and
 * visibly instead of at the first checkout a real church attempts.
 */
export const dodoConfig: DodoConfig = Object.freeze({
  apiKey: requiredEnv('DODO_PAYMENTS_API_KEY'),
  webhookSecret: requiredEnv('DODO_PAYMENTS_WEBHOOK_KEY'),
  environment: requiredEnvironment(),
});
