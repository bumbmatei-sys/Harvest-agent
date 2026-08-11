/**
 * Dodo Payments configuration — API credentials, mode, and the product IDs the
 * catalogue in `catalogue.ts` describes.
 *
 * ⚠️ IMPORTING THIS MODULE VALIDATES THE ENVIRONMENT. Every value below is read
 * through `requireDodoEnv`, which throws when a variable is absent. That is the
 * deliberate design (see `required-env.ts`): the alternative — the `??
 * 'price_…'` fallbacks in `billing.ts` — is how a deployment silently bills
 * against the wrong catalogue. Nothing in this module returns a placeholder.
 *
 * ⚠️ NOTHING IN THE RUNNING APP IMPORTS THIS YET. Dodo billing is dark: no route,
 * component or webhook handler reaches this file, so a deployment without the
 * variables set is unaffected. It is wired up in the provisioning cutover, by
 * which time the variables exist in Vercel.
 *
 * 🔴 SANDBOX ONLY at this stage. `DODO_ENVIRONMENT` must be set explicitly to
 * `test_mode` or `live_mode`; it is NOT inferred from the shape of the API key.
 * Guessing the mode from a credential is precisely the confusion that has
 * already cost this project a week on Stripe.
 */

import type { BillingInterval, PlanRef } from '@/lib/billing-provider';
import type { TenantPlan } from '@/types/tenant.types';
import { PLAN_ORDER } from '@/utils/plan-features';
import { BILLING_INTERVALS } from './catalogue';
import type { DodoProviderConfig } from './provider';
import { requireDodoEnv } from './required-env';

/** Which Dodo environment this deployment talks to. */
export type DodoEnvironment = 'test_mode' | 'live_mode';

/** Base URLs, as published by Dodo's own SDK for each environment. */
const DODO_BASE_URLS: Record<DodoEnvironment, string> = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
};

function readEnvironment(): DodoEnvironment {
  const raw = requireDodoEnv('DODO_ENVIRONMENT', 'set it to "test_mode" or "live_mode"');
  if (raw !== 'test_mode' && raw !== 'live_mode') {
    // Not defaulted to test_mode: a typo would then point live traffic at the
    // sandbox and every subscription would be fake money.
    throw new Error(
      `DODO_ENVIRONMENT must be exactly "test_mode" or "live_mode", got "${raw}". ` +
        `The mode is never inferred from the API key.`,
    );
  }
  return raw;
}

/** The environment variable holding the product id for one plan at one cadence. */
export function dodoProductEnvVar(plan: TenantPlan, interval: BillingInterval): string {
  return `DODO_PRODUCT_${plan.toUpperCase()}_${interval.toUpperCase()}`;
}

/**
 * Plan + cadence → Dodo product id.
 *
 * Built by walking `PLAN_ORDER`, so adding a tier to the plan table without
 * creating its two Dodo products fails at startup instead of at the first
 * checkout attempt by a customer who picked the new tier.
 */
function readProductIds(): Record<TenantPlan, Record<BillingInterval, string>> {
  const map = {} as Record<TenantPlan, Record<BillingInterval, string>>;
  for (const plan of PLAN_ORDER) {
    const byInterval = {} as Record<BillingInterval, string>;
    for (const interval of BILLING_INTERVALS) {
      byInterval[interval] = requireDodoEnv(
        dodoProductEnvVar(plan, interval),
        `the Dodo product id for the ${plan}/${interval} plan`,
      );
    }
    map[plan] = byInterval;
  }
  return map;
}

export const DODO_ENVIRONMENT: DodoEnvironment = readEnvironment();

/** REST base URL for the configured environment. */
export const DODO_API_BASE_URL: string = DODO_BASE_URLS[DODO_ENVIRONMENT];

/** Bearer token for the Dodo REST API. */
export const DODO_API_KEY: string = requireDodoEnv('DODO_API_KEY');

/**
 * Webhook signing secret (`whsec_…`), used to verify inbound events.
 *
 * Also read directly by the webhook route, which cannot import this module at
 * module scope — see the note there.
 */
export const DODO_WEBHOOK_SECRET: string = requireDodoEnv('DODO_WEBHOOK_SECRET');

/** Name of the variable above, so the route and this module agree on one spelling. */
export const DODO_WEBHOOK_SECRET_ENV_VAR = 'DODO_WEBHOOK_SECRET';

export const DODO_PRODUCT_IDS: Record<TenantPlan, Record<BillingInterval, string>> =
  readProductIds();

/** Dodo product id for one plan at one cadence. */
export function dodoProductId(plan: TenantPlan, interval: BillingInterval): string {
  return DODO_PRODUCT_IDS[plan][interval];
}

/**
 * Reverse lookup: Dodo product id → plan + cadence, or `null` when the id is not
 * one of Harvest's. `null` is a real answer — an add-on product or a subscription
 * created by hand legitimately resolves to no plan, and callers must handle that
 * rather than receive a guessed tier.
 */
export function planFromDodoProductId(productId: string): PlanRef | null {
  for (const plan of PLAN_ORDER) {
    for (const interval of BILLING_INTERVALS) {
      if (DODO_PRODUCT_IDS[plan][interval] === productId) return { plan, interval };
    }
  }
  return null;
}

/**
 * Assemble the argument `createDodoBillingProvider` takes.
 *
 * This function is the ONLY bridge between the environment and the provider:
 * `provider.ts` stays env-free so it can be tested against a fake `fetch`, and
 * everything that can fail for want of configuration has already failed by the
 * time this is called (the constants above threw at import).
 */
export function dodoProviderConfig(): DodoProviderConfig {
  return {
    apiBaseUrl: DODO_API_BASE_URL,
    apiKey: DODO_API_KEY,
    productId: dodoProductId,
    resolvePlan: planFromDodoProductId,
  };
}
