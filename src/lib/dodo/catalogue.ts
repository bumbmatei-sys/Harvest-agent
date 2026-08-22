import type { TenantPlan, PricedPlan } from '@/types/tenant.types';
import { BILLING_TERMS, PLAN_PRICING, TERM_MONTHS, planPriceUsd } from '@/utils/plan-features';
import { DODO_LIVE_MODE, DODO_TEST_MODE, dodoConfig, type DodoEnvironment } from './config';
import type { BillingPeriod } from './provider';

/**
 * The Dodo Payments subscription catalogue — the `(plan, period) → product` map.
 *
 * ⚠️ DODO PUTS THE PRICE ON THE PRODUCT. There is no separate price object, so
 * EACH TERM IS A DIFFERENT PRODUCT, not another price on the same one. This map
 * has NINE entries and no price-ID concept. Do NOT model it on Stripe's product/price
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
 * ─── Two catalogues, one active ──────────────────────────────────────────────
 *
 * The TEST-MODE products were created 2026-08-11; the LIVE products 2026-08-13,
 * verified field-by-field against the authenticated live API. Which catalogue is
 * active follows `dodoConfig.environment` — a REQUIRED variable that `config.ts`
 * validates to exactly `test_mode` or `live_mode` and never defaults — so the
 * rule above still holds here: this module reads no environment variable and
 * contains no fallback; it consumes the one already-validated value.
 */

/**
 * Dodo's own word for a billing period. `annual` is where it differs from the
 * app's `yearly`; `quarterly` is the same word on both sides.
 */
export type DodoBillingPeriod = 'monthly' | 'quarterly' | 'annual';

/** One Dodo product: an id, and the amount Dodo will actually charge for it. */
export interface DodoCatalogueEntry {
  /**
   * Dodo product id — Dodo's own price lives on this product.
   *
   * `DODO_PRODUCT_UNMAPPED` (null) where a term is NOT sellable in this mode.
   * Not "no such product" and not a fallback: it says in words that this build
   * cannot name a product for the term, so `productIdFor` returns null and every
   * purchase path must refuse rather than substitute another term. The same
   * idiom, and the same reasoning, as `DODO_ADDON_UNMAPPED` below.
   */
  readonly productId: string | null;
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
  readonly dodoBillingPeriod: DodoBillingPeriod;
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
 * The price of a plan on a term, in whole USD.
 *
 * READ FROM THE TABLE, never typed here. `PLAN_PRICING` (utils/plan-features)
 * is the one place the nine plan prices exist; a price written as a literal in
 * this file would be a second source of truth that drifts silently, and a
 * drifted figure paired with a real product id is a checkout that SUCCEEDS at
 * the wrong price.
 *
 * This used to derive the annual figure as `monthly × ANNUAL_BILLED_MONTHS`.
 * That constant is gone: the discounts no longer divide into whole months
 * (30% off a year is ×8.4), so the prices are a stored table and this reads it.
 *
 * `dodo-catalogue.test.ts` scans this file's source for bare price literals, so
 * retyping `329` in place of this call fails the suite rather than shipping.
 *
 * 🔴 `PricedPlan`, NOT `TenantPlan`. The Forever Free tier has no Dodo product,
 * no price and no billing period, and this signature is what makes that a
 * compile error rather than a runtime `undefined` reaching a checkout body. A
 * free tenant never transits this file at all — see `DodoCatalogue` below.
 */
export function termPriceUsd(plan: PricedPlan, term: BillingPeriod): number {
  return planPriceUsd(plan, term);
}

/** Whole USD → the currency's smallest unit. USD has 100 cents; nothing rounds. */
function toMinorUnits(usd: number): number {
  return usd * 100;
}

/**
 * The `billing_period` each term carries in the product's Dodo metadata.
 *
 * Dodo's catalogue says `annual` where the app says `yearly`; it has no separate
 * word for quarterly, which it expresses as three monthly cycles, so `quarterly`
 * is the app's word carried through unchanged. The whole reconciliation is these
 * three lines — it does not leak either way.
 */
const DODO_BILLING_PERIOD: Readonly<Record<BillingPeriod, DodoBillingPeriod>> = Object.freeze({
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'annual',
});

/**
 * How Dodo cycles each term: `payment_frequency_count` of `payment_frequency_interval`.
 *
 * Quarterly is `3 × Month` and NOT a "quarter" interval — Dodo has no such
 * interval — which is also why a quarterly product carries the MONTHLY add-on
 * ids: an add-on attached to a product that bills in months is charged in
 * months. See `addonIdFor`.
 */
export const DODO_TERM_FREQUENCY: Readonly<
  Record<BillingPeriod, { readonly count: number; readonly interval: 'Month' | 'Year' }>
> = Object.freeze({
  monthly: Object.freeze({ count: 1, interval: 'Month' as const }),
  quarterly: Object.freeze({ count: 3, interval: 'Month' as const }),
  yearly: Object.freeze({ count: 1, interval: 'Year' as const }),
});

function entry(plan: PricedPlan, term: BillingPeriod, productId: string | null): DodoCatalogueEntry {
  const priceUsd = termPriceUsd(plan, term);
  return {
    productId,
    priceUsd,
    priceMinorUnits: toMinorUnits(priceUsd),
    dodoBillingPeriod: DODO_BILLING_PERIOD[term],
    trialDays: DODO_TRIAL_DAYS,
  };
}

/**
 * 🔴 A term that is NOT sellable in this mode, said in words.
 *
 * The product counterpart of `DODO_ADDON_UNMAPPED`, and it exists for the same
 * reason: an absent key is indistinguishable from a forgotten one, and the
 * difference between "deliberately unmapped" and "someone dropped a line" is
 * the difference between a known gap and a silent defect. Every purchase path
 * must REFUSE a null; none may substitute a different term.
 */
export const DODO_PRODUCT_UNMAPPED = null;

/**
 * The full `(plan, period) → product` map — the shape both catalogues share.
 *
 * 🔴 KEYED ON `PricedPlan`, so the Forever Free tier has NO ROW HERE and cannot
 * be given one by accident. That is the design, not an omission: a free tenant
 * is provisioned with `plan: 'free'` and NO Dodo subscription at all (no card,
 * no trial, no webhook), so there is no product to map it to. An `undefined`
 * entry reaching `productIdFor` would become a checkout that fails at the
 * processor with nothing in the diff explaining why — the same failure mode
 * `DODO_PRODUCT_UNMAPPED` exists to prevent for test-mode quarterly.
 *
 * ⚠️ If free is ever to appear in Dodo for REPORTING purposes, that is a $0
 * product with no trial and no card, and it changes the free signup path
 * (THE-203) — not just this type.
 */
export type DodoCatalogue = Readonly<Record<PricedPlan, Readonly<Record<BillingPeriod, DodoCatalogueEntry>>>>;

/**
 * The products, in Dodo TEST MODE. Six of the nine.
 *
 * Created 2026-08-11 with a 14-day trial on every product and `plan_key` /
 * `billing_period` in metadata. `plan_key` carries the app's internal plan id
 * (plus / pro / max), not the display name, so the reverse lookup below and the
 * product metadata agree on one vocabulary.
 *
 * ⚠️ NOTE ON THE PRICES. These six test products were created against the OLD
 * price list ($49 / $99 / $199 monthly, 9-of-12 annual). The entries below take
 * their `priceUsd` from the CURRENT table like every other entry, so under test
 * mode the app's published figure and Dodo's stored figure disagree by design
 * until the test catalogue is recreated. That is a test-mode-only artifact —
 * `dodoConfig.environment` is `live_mode` for anything a real card touches —
 * and it is recorded here rather than papered over with a second price table.
 *
 * 🔴 QUARTERLY IS DELIBERATELY UNMAPPED HERE. The three quarterly products were
 * created in LIVE mode only (2026-08-20); no test-mode quarterly product exists,
 * so there is no id to write down and one must NOT be invented — a made-up
 * product id is a checkout that fails at the processor with nothing in the diff
 * to explain it. `DODO_PRODUCT_UNMAPPED` says so in words, `productIdFor`
 * returns null, and `offerableTerms` drops quarterly from what test mode sells.
 * Creating the three test products and pasting their ids here makes quarterly
 * work in test mode with no other edit anywhere.
 *
 * NO ADD-ON PRODUCTS. Dodo supports them natively — products carry an `addons`
 * array and `subscriptions.create` accepts `addons: [{ addon_id, quantity }]` —
 * and all six products above currently have an empty `addons` array. Add-ons are
 * REP-5.
 */
export const DODO_TEST_CATALOGUE: DodoCatalogue = Object.freeze({
  plus: Object.freeze({
    monthly: entry('plus', 'monthly', 'pdt_0NlAMMZk44L0tL8lcLX6M'),
    quarterly: entry('plus', 'quarterly', DODO_PRODUCT_UNMAPPED),
    yearly: entry('plus', 'yearly', 'pdt_0NlAMMeWwZDSlfNdti8FD'),
  }),
  pro: Object.freeze({
    monthly: entry('pro', 'monthly', 'pdt_0NlAMMhi90q5Ovk6QBzcf'),
    quarterly: entry('pro', 'quarterly', DODO_PRODUCT_UNMAPPED),
    yearly: entry('pro', 'yearly', 'pdt_0NlAMMlsVKeYG8ukapmzE'),
  }),
  max: Object.freeze({
    monthly: entry('max', 'monthly', 'pdt_0NlAMMp4QndR3qPzlD8sG'),
    quarterly: entry('max', 'quarterly', DODO_PRODUCT_UNMAPPED),
    yearly: entry('max', 'yearly', 'pdt_0NlAMMsQBzMvRVNCY7zws'),
  }),
});

/**
 * The nine products, in Dodo LIVE MODE.
 *
 * Monthly and annual were created 2026-08-13; the three QUARTERLY products were
 * created 2026-08-20 in the same repricing that produced the current table, and
 * all nine were verified field-by-field against the authenticated live API:
 * `USD`, `saas` tax category, a 14-day free trial, and the period-matched add-on
 * set attached to each.
 *
 * Quarterly bills as `payment_frequency_count: 3, payment_frequency_interval:
 * Month` — three monthly cycles, not a "quarter" interval, which Dodo does not
 * have. `DODO_TERM_FREQUENCY` above records that, and it is the reason a
 * quarterly product carries the MONTHLY add-on ids (see `addonIdFor`).
 *
 * ⚠️ ONE VERIFIED DIVERGENCE, recorded rather than hidden: the three quarterly
 * products carry EMPTY Dodo metadata, where the six older products carry
 * `plan_key` and `billing_period`. Nothing in this app reads that metadata —
 * `resolvePlanFromProductId` walks the table below by id, which is why the
 * lookup still works — so this is a housekeeping gap in the Dodo dashboard, not
 * a defect here. It is noted because the paragraph above used to claim all
 * products carry it, and a comment that overstates what was checked is worse
 * than no comment.
 *
 * 🔴 These ids are what a real card is charged against. They are pinned
 * character-for-character in `dodo-catalogue.test.ts`; a wrong id here is a
 * checkout that SUCCEEDS at the wrong price, not one that fails.
 */
export const DODO_LIVE_CATALOGUE: DodoCatalogue = Object.freeze({
  plus: Object.freeze({
    monthly: entry('plus', 'monthly', 'pdt_0NlJZKKU2AQSSH7E4ziKA'),
    quarterly: entry('plus', 'quarterly', 'pdt_0NloCamoWgvgYDih2UETS'),
    yearly: entry('plus', 'yearly', 'pdt_0NlJZMLLKZ5SVGEoSGDdk'),
  }),
  pro: Object.freeze({
    monthly: entry('pro', 'monthly', 'pdt_0NlJZMOMhmZWiG6UVDl8I'),
    quarterly: entry('pro', 'quarterly', 'pdt_0NloCaqg1QPMAlkfDnlOe'),
    yearly: entry('pro', 'yearly', 'pdt_0NlJZMRWL8tuAZseUIRTP'),
  }),
  max: Object.freeze({
    monthly: entry('max', 'monthly', 'pdt_0NlJZMUUiT36FGMoiFXgl'),
    quarterly: entry('max', 'quarterly', 'pdt_0NloCatUWEkEUq1usWJ0n'),
    yearly: entry('max', 'yearly', 'pdt_0NlJZMXTnpRBAwTfBVpPs'),
  }),
});

/**
 * The catalogue this build transacts against.
 *
 * Keyed by the already-validated `dodoConfig.environment` — a total lookup over
 * the two-value union, not a conditional with a default arm. If the variable
 * was missing, blank, or a third value, `config.ts` threw before this line ran.
 */
const CATALOGUES_BY_ENVIRONMENT: Readonly<Record<DodoEnvironment, DodoCatalogue>> = Object.freeze({
  [DODO_TEST_MODE]: DODO_TEST_CATALOGUE,
  [DODO_LIVE_MODE]: DODO_LIVE_CATALOGUE,
});

export const DODO_ACTIVE_CATALOGUE: DodoCatalogue = CATALOGUES_BY_ENVIRONMENT[dodoConfig.environment];

/** The active catalogue's entry for a plan on a billing period. Total. */
export function catalogueEntry(plan: PricedPlan, period: BillingPeriod): DodoCatalogueEntry {
  return DODO_ACTIVE_CATALOGUE[plan][period];
}

/**
 * The Dodo product id to put in a checkout cart for `(plan, period)`, or `null`
 * when this build cannot sell that term in this mode.
 *
 * 🔴 `null` is not "the lookup failed", it is "this build cannot sell that", and
 * a caller must refuse rather than fall back to another term. Falling back is
 * the specific disaster: a church that chose quarterly and was charged yearly
 * has been overcharged fourfold by a line of defensive code.
 */
export function productIdFor(plan: PricedPlan, period: BillingPeriod): string | null {
  return catalogueEntry(plan, period).productId;
}

/**
 * The product id for `(plan, period)`, or a thrown error naming the gap.
 *
 * For the checkout paths, which have no sensible way to continue without one.
 * Throwing beats returning a placeholder for the same reason the module reads no
 * env var: a wrong id succeeds at the wrong price, and a missing id must fail
 * loudly and early instead.
 */
export function requireProductId(plan: PricedPlan, period: BillingPeriod): string {
  const id = productIdFor(plan, period);
  if (id === DODO_PRODUCT_UNMAPPED) {
    throw new Error(
      `Dodo catalogue: no ${period} product for plan "${plan}" in ${dodoConfig.environment}. ` +
      `That term is not sellable in this mode — it must not be offered, and it must never ` +
      `fall back to another term.`,
    );
  }
  return id;
}

/**
 * The terms this build can actually SELL for a plan, in the active mode.
 *
 * 🔴 DERIVED FROM THE TABLE, NEVER LISTED — the same rule as
 * `offerableAddonMeanings`. A hardcoded list is how an unmapped term becomes a
 * sale: the table would say "unmapped" and the term picker would say "buy me".
 */
export function offerableTerms(plan: PricedPlan): BillingPeriod[] {
  return BILLING_TERMS.filter((term) => productIdFor(plan, term) !== DODO_PRODUCT_UNMAPPED);
}

/**
 * Reverse lookup: Dodo product id → the plan and period it sells.
 *
 * The direct counterpart of `billing.ts`'s `getPlanFromPriceId`, and the reason
 * the subscription webhook can name a plan at all: a Dodo subscription payload
 * carries `product_id` and nothing that says "Ministry, annual". Resolves the
 * ACTIVE catalogue only, and returns null for anything else — an add-on product,
 * a product created by hand in the dashboard, or the OTHER MODE's ids — so an
 * unknown id can never be silently treated as the cheapest plan.
 *
 * The other-mode case is deliberate: under live mode a test product id is
 * foreign. Every existing test-mode tenant is a cancelled test artifact, and a
 * live deployment that treated its id as valid would be a bug surface, not a
 * convenience.
 */
export function resolvePlanFromProductId(
  productId: string,
): { plan: PricedPlan; period: BillingPeriod } | null {
  for (const [plan, periods] of Object.entries(DODO_ACTIVE_CATALOGUE) as [
    PricedPlan,
    Record<BillingPeriod, DodoCatalogueEntry>,
  ][]) {
    for (const [period, entry] of Object.entries(periods) as [BillingPeriod, DodoCatalogueEntry][]) {
      // An unmapped term has a null id; `productId` is a non-empty string from a
      // Dodo payload, so the null check is what stops two unmapped terms from
      // "matching" each other. Never resolve a gap into a plan.
      if (entry.productId !== DODO_PRODUCT_UNMAPPED && entry.productId === productId) {
        return { plan, period };
      }
    }
  }
  return null;
}

/** Every product id the active catalogue can name. Nine in live, six in test. */
export function allCatalogueProductIds(): string[] {
  return Object.values(DODO_ACTIVE_CATALOGUE).flatMap((periods) =>
    Object.values(periods)
      .map((entry) => entry.productId)
      .filter((id): id is string => id !== DODO_PRODUCT_UNMAPPED),
  );
}

// ─── The add-on catalogue (REP-5a) ───────────────────────────────────────────
//
// ⚠️ DODO ADD-ONS CARRY NO METADATA FIELD. A Dodo product has `metadata` and
// this build uses it (`plan_key`, `billing_period` above); an ADD-ON does not
// have one at all. So "what does owning this add-on mean" cannot be derived at
// runtime from anything Dodo returns — an `addon_id` and a name is the whole of
// it, and a name is display copy that a dashboard edit can change under us.
//
// The mapping therefore has to be written down, and it is written down HERE,
// beside the products, under the SAME rules as the products: two tables, one
// active, selected by the already-validated `dodoConfig.environment`. No `??`,
// no env read, no default — `dodo-addon-catalogue.test.ts` scans this file's
// source for all three, exactly as `dodo-catalogue.test.ts` already does.
//
// 🔴 THE IDS NEVER LEAVE THIS MODULE. What gets stored on a tenant is the
// MEANING (`contactPacks: 2`), never `adn_0NlKtwD3VfBLgx2LTw69O`. An id on a
// world-readable tenant doc is a client that breaks the moment an add-on is
// recreated in Dodo, and the mapping belongs server-side, once.

/**
 * What owning an add-on MEANS — the five things Harvest sells beyond a tier.
 *
 * These are the words the rest of the app reasons in. `campus` and `adminSeat`
 * are singular because one add-on unit is one campus / one seat and the
 * quantity carries the count; `contactPack` is one block of
 * `CONTACTS_PER_PACK` contacts for the same reason. `unlimitedContacts` is the
 * odd one: a quantity means nothing there, holding it at all is the whole fact.
 */
export const DODO_ADDON_MEANINGS = [
  'aiAssistant',
  'adminSeat',
  'campus',
  'contactPack',
  'unlimitedContacts',
] as const;

export type DodoAddonMeaning = (typeof DODO_ADDON_MEANINGS)[number];

/**
 * 🔴 An add-on that EXISTS IN DODO but whose id was never written down.
 *
 * Not "this add-on does not exist" and not "we do not sell this" — it is sold,
 * priced and attached in Dodo, and this build cannot name it. The marker exists
 * so the table can say that IN WORDS rather than by leaving a key out: an absent
 * key is indistinguishable from a forgotten one, and the difference between
 * "deliberately unmapped" and "someone dropped a line" is the difference between
 * a known gap and a silent defect.
 *
 * A held add-on whose id maps to nothing takes the unrecognised-id path, which
 * REPORTS (see `../dodo/addons`). That is the safety property that makes
 * shipping with a gap defensible: nobody pays for nothing in silence.
 */
export const DODO_ADDON_UNMAPPED = null;

/**
 * The billing periods an ADD-ON is actually sold on. Two, not three.
 *
 * 🔴 THIS IS THE ADD-ON SIDE OF THE THREE-TERM CHANGE, AND IT DELIBERATELY DID
 * NOT GROW. Dodo attaches an add-on to a PRODUCT, and it charges that add-on on
 * the product's own cycle. A quarterly product bills as three MONTHLY cycles
 * (`DODO_TERM_FREQUENCY`), and the live quarterly products were verified to
 * carry exactly the monthly add-on ids — so there is no quarterly add-on to map,
 * and inventing a third column here would be inventing six ids Dodo does not
 * have.
 *
 * A quarterly church therefore pays the MONTHLY add-on price: an admin seat is
 * $10 a month, the same $10 a monthly church pays. `addonIdFor` performs that
 * one-line reconciliation and is the only place it happens.
 */
export type AddonBillingPeriod = Extract<BillingPeriod, 'monthly' | 'yearly'>;

/** The two ids one meaning is sold under. `null` names a deliberate gap. */
export type DodoAddonIds = Readonly<Record<AddonBillingPeriod, string | null>>;

/** meaning → its ids, in one mode. Total over the five meanings, by type. */
export type DodoAddonTable = Readonly<Record<DodoAddonMeaning, DodoAddonIds>>;

/**
 * The ten add-ons, in Dodo TEST MODE. Five meanings × two billing periods.
 *
 * `yearly` is the app's word for what Dodo's dashboard calls "Annual", the same
 * reconciliation the product catalogue above makes — the two vocabularies meet
 * in this module and nowhere else.
 *
 * ⚠️ COMPLETE, DELIBERATELY. Campus is mapped here and NOT in live (below), and
 * that asymmetry is the point: test mode is where Campus has to work end to end,
 * so that filling the live gap is two ids and no logic.
 */
export const DODO_TEST_ADDONS: DodoAddonTable = Object.freeze({
  aiAssistant: Object.freeze({
    monthly: 'adn_0NlNfaOwHWiV8CrPNREiU',
    yearly: 'adn_0NlNfaSduoV543Ey8y9tR',
  }),
  adminSeat: Object.freeze({
    monthly: 'adn_0NlNfaVFaLLWXU8KXw1JI',
    yearly: 'adn_0NlNfaXplUpTTYwm1jJCV',
  }),
  campus: Object.freeze({
    monthly: 'adn_0NlNfafdHZgpetrweMI31',
    yearly: 'adn_0NlNfaiGQpP5IAxXI82Fz',
  }),
  contactPack: Object.freeze({
    monthly: 'adn_0NlNfakv8J9oKpmVGavKm',
    yearly: 'adn_0NlNfanWnF8iZ0A8rESdW',
  }),
  unlimitedContacts: Object.freeze({
    monthly: 'adn_0NlNfaqEXuZZsLYWtKcer',
    yearly: 'adn_0NlNfaspQfXIgGxB6d0Bd',
  }),
});

/**
 * The ten add-ons, in Dodo LIVE MODE — all ten mapped.
 *
 * The two live Campus ids were read from the authenticated live Dodo API and
 * verified against all six live products (every one carries the correct
 * period-matched add-on set), closing the gap `dodo-addon-catalogue.test.ts`
 * used to pin deliberately. Attachment needed no change in Dodo; this table
 * was the only place the gap lived.
 */
export const DODO_LIVE_ADDONS: DodoAddonTable = Object.freeze({
  aiAssistant: Object.freeze({
    monthly: 'adn_0NlKtuImtSn7PcdvjnSni',
    yearly: 'adn_0NlKtw3IOHfv1GGCevNol',
  }),
  adminSeat: Object.freeze({
    monthly: 'adn_0NlKtw7AayNYI6YYwphQ5',
    yearly: 'adn_0NlKtw9lWLs0VRN9hWciX',
  }),
  campus: Object.freeze({
    monthly: 'adn_0NlKwDcuqIWoVK7Qay13L',
    yearly: 'adn_0NlKwDgKMpuqzR5VmlCBD',
  }),
  contactPack: Object.freeze({
    monthly: 'adn_0NlKtwD3VfBLgx2LTw69O',
    yearly: 'adn_0NlKtwGbLRk2nPC07uC6o',
  }),
  unlimitedContacts: Object.freeze({
    monthly: 'adn_0NlKtwKAhJgz0jeaqDX2c',
    yearly: 'adn_0NlKtwMjMlsjzZ8z2Wt7P',
  }),
});

/**
 * The add-on table this build maps against.
 *
 * Keyed by `dodoConfig.environment` exactly as `CATALOGUES_BY_ENVIRONMENT` is —
 * a total lookup over the two-value union, not a conditional with a default arm.
 */
const ADDONS_BY_ENVIRONMENT: Readonly<Record<DodoEnvironment, DodoAddonTable>> = Object.freeze({
  [DODO_TEST_MODE]: DODO_TEST_ADDONS,
  [DODO_LIVE_MODE]: DODO_LIVE_ADDONS,
});

export const DODO_ACTIVE_ADDONS: DodoAddonTable = ADDONS_BY_ENVIRONMENT[dodoConfig.environment];

/**
 * Reverse lookup: Dodo add-on id → what owning it MEANS.
 *
 * The add-on counterpart of `resolvePlanFromProductId`, and it refuses the same
 * way: the ACTIVE table only, `null` for everything else — an unmapped live
 * Campus, the other mode's ids, a hand-made dashboard add-on, a typo. Callers
 * must REPORT a null rather than skip it; a silently ignored add-on is a church
 * paying for nothing.
 *
 * Both periods resolve to the SAME meaning: a monthly campus and an annual
 * campus are both one campus. Period is a billing fact, not an entitlement one.
 */
export function resolveAddonMeaning(addonId: string): DodoAddonMeaning | null {
  if (addonId === '') return null;
  for (const [meaning, ids] of Object.entries(DODO_ACTIVE_ADDONS) as [
    DodoAddonMeaning,
    DodoAddonIds,
  ][]) {
    for (const id of Object.values(ids)) {
      if (id !== DODO_ADDON_UNMAPPED && id === addonId) return meaning;
    }
  }
  return null;
}

/**
 * Forward lookup: a MEANING on a billing period → the Dodo add-on id that sells
 * it, or `null` when the active table does not map it.
 *
 * 🔴 THE ONE ANSWER TO "CAN THIS BE SOLD" (REP-5b). A purchase surface asks this
 * and nothing else — never a list written out beside it. `null` here is not "the
 * lookup failed", it is "this build cannot sell that in this environment", and
 * every caller must refuse rather than substitute anything.
 *
 * The live Campus gap is exactly this case: `DODO_LIVE_ADDONS.campus` is
 * `DODO_ADDON_UNMAPPED` on both periods, so under live mode this returns `null`
 * for Campus and the add-on is not offerable. Charging a church $15 a month for
 * an id this build cannot recognise on the way back in is the failure that gap
 * exists to prevent; refusing to SELL it is the other half of the same
 * guarantee. Filling the two ids in the table above makes Campus purchasable
 * with no other edit anywhere.
 *
 * The exact counterpart of `resolveAddonMeaning`, which walks this same table in
 * the other direction — so the set of ids that can be sold and the set that can
 * be understood are, structurally, one set.
 */
export function addonIdFor(meaning: DodoAddonMeaning, period: BillingPeriod): string | null {
  return DODO_ACTIVE_ADDONS[meaning][addonPeriodFor(period)];
}

/**
 * The add-on column a plan term buys from — the whole quarterly reconciliation.
 *
 * Quarterly maps to MONTHLY because Dodo charges an add-on on its product's
 * cycle and a quarterly product cycles in months. This is a mapping, not a
 * fallback: it is what Dodo actually does, verified on the live quarterly
 * products, and it is why `ADD_ON_BILLED_MONTHS` on the marketing site is still
 * 12 and add-ons are still undiscounted on every term.
 */
export function addonPeriodFor(period: BillingPeriod): AddonBillingPeriod {
  return period === 'yearly' ? 'yearly' : 'monthly';
}

/**
 * The add-ons this build can SELL on `period`, in the active mode.
 *
 * 🔴 DERIVED FROM THE TABLE, NEVER LISTED. A hardcoded list is how the live
 * Campus gap would become a live Campus SALE: the table would say "unmapped" and
 * the sales surface would say "buy me", and the church would be charged for
 * something no code path can grant. Every availability question in the purchase
 * path resolves through here.
 *
 * Tier availability is NOT considered and must not be (THE-133): which add-ons a
 * given plan may hold is enforced by Dodo, on the product, precisely so that a
 * Harvest bug cannot sell Unlimited Contacts to a $49 plan. This answers only
 * "does this build know the id", which is a different question with a different
 * failure mode.
 */
export function offerableAddonMeanings(period: BillingPeriod): DodoAddonMeaning[] {
  return DODO_ADDON_MEANINGS.filter(
    (meaning) => addonIdFor(meaning, period) !== DODO_ADDON_UNMAPPED,
  );
}

/** Every add-on id this build can map, in the active mode. Ten, or eight in live. */
export function allMappedAddonIds(): string[] {
  const ids: string[] = [];
  for (const periods of Object.values(DODO_ACTIVE_ADDONS)) {
    for (const id of Object.values(periods)) {
      if (id !== DODO_ADDON_UNMAPPED) ids.push(id);
    }
  }
  return ids;
}
