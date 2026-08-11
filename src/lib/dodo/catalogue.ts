/**
 * What Harvest sells, expressed as Dodo products.
 *
 * PURE AND ENV-FREE. This module derives the shape of every product from the
 * plan constants the rest of the app already uses; the processor-side IDs those
 * products get once created live in `config.ts`. Keeping the two apart means the
 * price table can be tested without a single environment variable set, and the
 * required-env validation in `config.ts` has nothing to do with pricing.
 *
 * ⚠️ NO ANNUAL FIGURE IS WRITTEN DOWN HERE. Annual is `monthly ×
 * ANNUAL_BILLED_MONTHS` — pay for 9 months, get 12, a deliberate 25% discount.
 * `plan-features.ts` owns that constant and the whole app derives from it. A
 * literal `441` in this file would be a second place the discount lives, and the
 * next change to the constant would silently leave Dodo charging the old price.
 * Derive; never retype.
 *
 * ⚠️ ONE PRICE PER DODO PRODUCT. Dodo has no separate price object the way
 * Stripe does — a product carries exactly one price. Harvest's "three plans,
 * two cadences" is therefore SIX Dodo products, not three products with two
 * prices each. That is the single largest modelling difference from the Stripe
 * catalogue this replaces.
 */

import type { BillingInterval, PlanRef } from '@/lib/billing-provider';
import type { TenantPlan } from '@/types/tenant.types';
import {
  ANNUAL_BILLED_MONTHS,
  PLAN_DISPLAY_NAMES,
  PLAN_ORDER,
  PLAN_PRICING,
} from '@/utils/plan-features';

/** The two cadences, in the order they are offered. */
export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly'] as const;

/**
 * Free-trial length, in days, for a new-ministry signup on Dodo.
 *
 * ⚠️ 14, WHERE THE STRIPE PATH RUNS 7. This is the number configured on the Dodo
 * products; it is deliberately NOT read by any customer-facing copy. The app and
 * the marketing site both still say 7, and they move to 14 together with the
 * cutover (PR 4) so the published number never runs ahead of what a signup
 * actually does. Nothing outside this module and its tests may read this value
 * until then.
 *
 * Card up front: Dodo collects payment details at checkout and charges when the
 * trial ends, matching the current Stripe behaviour.
 */
export const DODO_TRIAL_PERIOD_DAYS = 14;

/** Currency for every plan product. Dodo bills subscriptions in this currency. */
export const DODO_PLAN_CURRENCY = 'USD' as const;

/**
 * One Dodo product's full definition — everything needed to create it and
 * everything needed to check that what exists in Dodo matches what the app
 * believes it sells.
 */
export interface DodoProductSpec extends PlanRef {
  /** Product name as it appears in Dodo and on the invoice line. */
  name: string;
  /** Whole-dollar price, derived. Never written as a literal for `yearly`. */
  amountUsd: number;
  /** Price in the currency's minor units — Dodo charges in cents. */
  priceMinorUnits: number;
  currency: typeof DODO_PLAN_CURRENCY;
  /** How often the customer is charged. */
  paymentFrequency: { count: number; interval: 'Month' | 'Year' };
  /** How long one purchased term entitles the customer for. */
  subscriptionPeriod: { count: number; interval: 'Month' | 'Year' };
  trialPeriodDays: number;
}

/**
 * Whole-dollar price of a plan at a cadence.
 *
 * Monthly is the published tier price. Yearly is `monthly × ANNUAL_BILLED_MONTHS`
 * — computed here, deliberately not read from `PLAN_PRICING[plan].yearlyUsd`,
 * so that this module has exactly one arithmetic definition of the annual price
 * rather than a copy of a number that happens to agree today.
 */
export function planAmountUsd(plan: TenantPlan, interval: BillingInterval): number {
  const monthly = PLAN_PRICING[plan].monthlyUsd;
  return interval === 'yearly' ? monthly * ANNUAL_BILLED_MONTHS : monthly;
}

function buildSpec(plan: TenantPlan, interval: BillingInterval): DodoProductSpec {
  const amountUsd = planAmountUsd(plan, interval);
  const isYearly = interval === 'yearly';
  return {
    plan,
    interval,
    name: `Harvest ${PLAN_DISPLAY_NAMES[plan]} — ${isYearly ? 'Annual' : 'Monthly'}`,
    amountUsd,
    priceMinorUnits: amountUsd * 100,
    currency: DODO_PLAN_CURRENCY,
    paymentFrequency: { count: 1, interval: isYearly ? 'Year' : 'Month' },
    subscriptionPeriod: { count: 1, interval: isYearly ? 'Year' : 'Month' },
    trialPeriodDays: DODO_TRIAL_PERIOD_DAYS,
  };
}

/**
 * Every product Harvest needs in Dodo, derived from `PLAN_ORDER` so a tier added
 * to the plan table cannot be silently left without a product to sell.
 *
 * BASE PLANS ONLY. Seats, campuses and the AI add-on are separate recurring line
 * items Dodo attaches to the same parent subscription; they are deliberately not
 * created until the base flow works end to end (REP-5).
 */
export const DODO_PRODUCT_SPECS: readonly DodoProductSpec[] = PLAN_ORDER.flatMap((plan) =>
  BILLING_INTERVALS.map((interval) => buildSpec(plan, interval)),
);

/** The spec for one plan at one cadence. */
export function dodoProductSpec(plan: TenantPlan, interval: BillingInterval): DodoProductSpec {
  const spec = DODO_PRODUCT_SPECS.find((s) => s.plan === plan && s.interval === interval);
  if (!spec) {
    // Unreachable while PLAN_ORDER drives the list — and if it ever is reached,
    // an exception beats returning a plan the buyer did not choose.
    throw new Error(`No Dodo product spec for plan "${plan}" at interval "${interval}"`);
  }
  return spec;
}
