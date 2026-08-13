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
 * The three variables below MUST be set in Vercel before any branch is deployed
 * or the build fails. That is the fail-fast behaviour working as designed; it
 * is not a surprise to debug later.
 *
 * ─── Both modes are permitted; neither is a default ──────────────────────────
 *
 * `DODO_PAYMENTS_ENVIRONMENT` selects Dodo's API host and, through
 * `catalogue.ts`, which of the two product catalogues this build transacts
 * against. `test_mode` and `live_mode` are both accepted — the live catalogue
 * exists as of 2026-08-13 — and any third value throws. The variable is
 * required, so "which catalogue gets billed" is always an explicit, validated
 * choice, never something a missing setting decided silently.
 *
 * 🔴 Pointing Production at live is a HUMAN step after this merges: setting the
 * three variables to live values in Vercel, on the Production environment only.
 * Nothing charges a real card until someone does that deliberately.
 */

/** Dodo's two API hosts — the only values DODO_PAYMENTS_ENVIRONMENT may take. */
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

  if (raw === DODO_TEST_MODE || raw === DODO_LIVE_MODE) return raw;

  throw new Error(
    `[dodo] DODO_PAYMENTS_ENVIRONMENT must be "${DODO_TEST_MODE}" or "${DODO_LIVE_MODE}" ` +
      `(received "${raw}"). There is no default environment: which catalogue gets ` +
      'billed must always be an explicit, validated choice.',
  );
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
