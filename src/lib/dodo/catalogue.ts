import type { TenantPlan } from '@/types/tenant.types';
import { ANNUAL_BILLED_MONTHS, PLAN_PRICING } from '@/utils/plan-features';
import type { BillingPeriod } from './provider';

/**
 * The Dodo Payments subscription catalogue — the `(plan, period) → product` map.
 *
 * ⚠️ DODO PUTS THE PRICE ON THE PRODUCT. There is no separate price object, so
 * ANNUAL IS A DIFFERENT PRODUCT, not a second price on the same one. This map has
 * SIX entries and no price-ID concept. Do NOT model it on Stripe's product/price
 * split (`billing.ts`'s `{ monthly, yearly }` under one plan key): that split is
 * the single biggest structural difference between the two processors, and
 * carrying it over is how you end up looking for a price that does not exist.
 *
 * ─── Why the IDs are constants and not env vars ──────────────────────────────
 *
 * `billing.ts` reads its Stripe price IDs from env with `?? 'price_test_...'`
 * fallbacks. That is the exact defect #207 existed to fix — a missing env var
 * silently bills the wrong catalogue instead of failing — so it is NOT copied
 * here. The SECRETS (API key, webhook secret) are required env reads that throw
 * at module load; see `config.ts`. The product IDs are not secrets, and they are
 * written down here because a catalogue that can be repointed by editing a Vercel
 * setting is a catalogue that can be repointed without review. Swapping to the
 * live catalogue is a code change in a pull request, which is what it should be.
 *
 * There is therefore no fallback of any kind in this module: no `??`, no env
 * read, no default. A wrong product ID is a wrong product ID in the diff.
 *
 * ─── Test mode only ──────────────────────────────────────────────────────────
 *
 * These are Dodo TEST-MODE products, created 2026-08-11. The live catalogue does
 * not exist yet. `config.ts` refuses to start in live mode for that reason.
 */

/** One Dodo product: an id, and the amount Dodo will actually charge for it. */
export interface DodoCatalogueEntry {
  /** Dodo product id. Dodo's own price lives on this product. */
  readonly productId: string;
  /** Price in whole USD, as published by the app. */
  readonly priceUsd: number;
  /**
   * Price in the currency's smallest unit — what Dodo stores and charges.
   * Derived from `priceUsd`; never typed out.
   */
  readonly priceMinorUnits: number;
  /**
   * The `billing_period` value carried in the product's Dodo metadata.
   *
   * Dodo's catalogue says `annual` where the app says `yearly`. The two
   * vocabularies are reconciled HERE, in the one module that knows both, rather
   * than leaking `annual` into app code or `yearly` into the product metadata.
   */
  readonly dodoBillingPeriod: 'monthly' | 'annual';
  /** Trial length configured on the product, in days. */
  readonly trialDays: number;
}

/**
 * Trial length on every product in the catalogue.
 *
 * 14 days, card up front. Dodo supports a 30-day card-up-front trial, so 14 is
 * comfortably inside what the processor allows. The app still advertises 7 days
 * in several places — moving app, marketing site and Terms to 14 together is
 * REP-4 PR 4 and is deliberately NOT part of this change.
 */
export const DODO_TRIAL_DAYS = 14;

/**
 * Annual price of a plan in whole USD.
 *
 * DERIVED, never typed. `ANNUAL_BILLED_MONTHS` (9) is the one constant every
 * annual figure in this app comes from — prices, the monthly-equivalent line,
 * the "months free" badge. An annual price written as a literal here would be a
 * second source of truth that drifts silently, and a drifted figure paired with
 * a real product id is a checkout that succeeds at the wrong price.
 *
 * `dodo-catalogue.test.ts` scans this file's source for bare annual literals, so
 * retyping `441` in place of this call fails the suite rather than shipping.
 */
export function annualPriceUsd(plan: TenantPlan): number {
  return PLAN_PRICING[plan].monthlyUsd * ANNUAL_BILLED_MONTHS;
}

/** Monthly price of a plan in whole USD — the published figure, unmodified. */
export function monthlyPriceUsd(plan: TenantPlan): number {
  return PLAN_PRICING[plan].monthlyUsd;
}

/** Whole USD → the currency's smallest unit. USD has 100 cents; nothing rounds. */
function toMinorUnits(usd: number): number {
  return usd * 100;
}

function monthlyEntry(plan: TenantPlan, productId: string): DodoCatalogueEntry {
  const priceUsd = monthlyPriceUsd(plan);
  return {
    productId,
    priceUsd,
    priceMinorUnits: toMinorUnits(priceUsd),
    dodoBillingPeriod: 'monthly',
    trialDays: DODO_TRIAL_DAYS,
  };
}

function annualEntry(plan: TenantPlan, productId: string): DodoCatalogueEntry {
  const priceUsd = annualPriceUsd(plan);
  return {
    productId,
    priceUsd,
    priceMinorUnits: toMinorUnits(priceUsd),
    dodoBillingPeriod: 'annual',
    trialDays: DODO_TRIAL_DAYS,
  };
}

/**
 * The six products, in Dodo TEST MODE.
 *
 * Created 2026-08-11 with a 14-day trial on every product and `plan_key` /
 * `billing_period` in metadata. `plan_key` carries the app's internal plan id
 * (plus / pro / max), not the display name, so the reverse lookup below and the
 * product metadata agree on one vocabulary.
 *
 *   Individual (plus)   $49/mo    $441/yr
 *   Small Team (pro)    $99/mo    $891/yr
 *   Ministry   (max)   $199/mo   $1,791/yr
 *
 * Every annual figure above is `monthly × ANNUAL_BILLED_MONTHS`, computed by
 * `annualEntry`. None of them appears as a literal in this file.
 *
 * NO ADD-ON PRODUCTS. Dodo supports them natively — products carry an `addons`
 * array and `subscriptions.create` accepts `addons: [{ addon_id, quantity }]` —
 * and all six products above currently have an empty `addons` array. Add-ons are
 * REP-5.
 */
export const DODO_TEST_CATALOGUE: Readonly<Record<TenantPlan, Readonly<Record<BillingPeriod, DodoCatalogueEntry>>>> =
  Object.freeze({
    plus: Object.freeze({
      monthly: monthlyEntry('plus', 'pdt_0NlAMMZk44L0tL8lcLX6M'),
      yearly: annualEntry('plus', 'pdt_0NlAMMeWwZDSlfNdti8FD'),
    }),
    pro: Object.freeze({
      monthly: monthlyEntry('pro', 'pdt_0NlAMMhi90q5Ovk6QBzcf'),
      yearly: annualEntry('pro', 'pdt_0NlAMMlsVKeYG8ukapmzE'),
    }),
    max: Object.freeze({
      monthly: monthlyEntry('max', 'pdt_0NlAMMp4QndR3qPzlD8sG'),
      yearly: annualEntry('max', 'pdt_0NlAMMsQBzMvRVNCY7zws'),
    }),
  });

/** The catalogue entry for a plan on a billing period. */
export function catalogueEntry(plan: TenantPlan, period: BillingPeriod): DodoCatalogueEntry {
  return DODO_TEST_CATALOGUE[plan][period];
}

/** The Dodo product id to put in a checkout cart for `(plan, period)`. */
export function productIdFor(plan: TenantPlan, period: BillingPeriod): string {
  return catalogueEntry(plan, period).productId;
}

/**
 * Reverse lookup: Dodo product id → the plan and period it sells.
 *
 * The direct counterpart of `billing.ts`'s `getPlanFromPriceId`, and the reason
 * the subscription webhook can name a plan at all: a Dodo subscription payload
 * carries `product_id` and nothing that says "Ministry, annual". Returns null for
 * anything not in the catalogue — an add-on product, a live-mode id, or a product
 * created by hand in the dashboard — so an unknown id can never be silently
 * treated as the cheapest plan.
 */
export function resolvePlanFromProductId(
  productId: string,
): { plan: TenantPlan; period: BillingPeriod } | null {
  for (const [plan, periods] of Object.entries(DODO_TEST_CATALOGUE) as [
    TenantPlan,
    Record<BillingPeriod, DodoCatalogueEntry>,
  ][]) {
    for (const [period, entry] of Object.entries(periods) as [BillingPeriod, DodoCatalogueEntry][]) {
      if (entry.productId === productId) return { plan, period };
    }
  }
  return null;
}

/** Every product id in the catalogue. Six of them. */
export function allCatalogueProductIds(): string[] {
  return Object.values(DODO_TEST_CATALOGUE).flatMap((periods) =>
    Object.values(periods).map((entry) => entry.productId),
  );
}
