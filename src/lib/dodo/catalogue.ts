import type { TenantPlan } from '@/types/tenant.types';
import { ANNUAL_BILLED_MONTHS, PLAN_PRICING } from '@/utils/plan-features';
import { DODO_LIVE_MODE, DODO_TEST_MODE, dodoConfig, type DodoEnvironment } from './config';
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
 * ─── Two catalogues, one active ──────────────────────────────────────────────
 *
 * The TEST-MODE products were created 2026-08-11; the LIVE products 2026-08-13,
 * verified field-by-field against the authenticated live API. Which catalogue is
 * active follows `dodoConfig.environment` — a REQUIRED variable that `config.ts`
 * validates to exactly `test_mode` or `live_mode` and never defaults — so the
 * rule above still holds here: this module reads no environment variable and
 * contains no fallback; it consumes the one already-validated value.
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

/** The full `(plan, period) → product` map — the shape both catalogues share. */
export type DodoCatalogue = Readonly<Record<TenantPlan, Readonly<Record<BillingPeriod, DodoCatalogueEntry>>>>;

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
export const DODO_TEST_CATALOGUE: DodoCatalogue = Object.freeze({
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

/**
 * The six products, in Dodo LIVE MODE.
 *
 * Created 2026-08-13 and verified field-by-field against the authenticated live
 * API: same names, prices, 14-day trial, `tax_category`, and `plan_key` /
 * `billing_period` metadata as the test products above, id for id.
 *
 * 🔴 These ids are what a real card is charged against. They are pinned
 * character-for-character in `dodo-catalogue.test.ts`; a wrong id here is a
 * checkout that SUCCEEDS at the wrong price, not one that fails.
 */
export const DODO_LIVE_CATALOGUE: DodoCatalogue = Object.freeze({
  plus: Object.freeze({
    monthly: monthlyEntry('plus', 'pdt_0NlJZKKU2AQSSH7E4ziKA'),
    yearly: annualEntry('plus', 'pdt_0NlJZMLLKZ5SVGEoSGDdk'),
  }),
  pro: Object.freeze({
    monthly: monthlyEntry('pro', 'pdt_0NlJZMOMhmZWiG6UVDl8I'),
    yearly: annualEntry('pro', 'pdt_0NlJZMRWL8tuAZseUIRTP'),
  }),
  max: Object.freeze({
    monthly: monthlyEntry('max', 'pdt_0NlJZMUUiT36FGMoiFXgl'),
    yearly: annualEntry('max', 'pdt_0NlJZMXTnpRBAwTfBVpPs'),
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

/** The active catalogue's entry for a plan on a billing period. */
export function catalogueEntry(plan: TenantPlan, period: BillingPeriod): DodoCatalogueEntry {
  return DODO_ACTIVE_CATALOGUE[plan][period];
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
): { plan: TenantPlan; period: BillingPeriod } | null {
  for (const [plan, periods] of Object.entries(DODO_ACTIVE_CATALOGUE) as [
    TenantPlan,
    Record<BillingPeriod, DodoCatalogueEntry>,
  ][]) {
    for (const [period, entry] of Object.entries(periods) as [BillingPeriod, DodoCatalogueEntry][]) {
      if (entry.productId === productId) return { plan, period };
    }
  }
  return null;
}

/** Every product id in the active catalogue. Six of them. */
export function allCatalogueProductIds(): string[] {
  return Object.values(DODO_ACTIVE_CATALOGUE).flatMap((periods) =>
    Object.values(periods).map((entry) => entry.productId),
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

/** The two ids one meaning is sold under. `null` names a deliberate gap. */
export type DodoAddonIds = Readonly<Record<BillingPeriod, string | null>>;

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
 * The ten add-ons, in Dodo LIVE MODE — with EIGHT of them mapped.
 *
 * 🔴 CAMPUS IS UNMAPPED IN LIVE, ON PURPOSE, AND IT IS A REAL GAP.
 *
 * Both live Campus add-ons exist in Dodo — created, priced and attached — but
 * their ids were not recorded at creation and are not guessable. Guessing one
 * would be worse than the gap: a wrong `adn_` that happened to resolve would
 * grant a campus nobody bought, and one that did not would fail in exactly the
 * same silence.
 *
 * What a church buying a live Campus gets today, stated plainly: Dodo charges
 * them $15/mo, the add-on rides the subscription, the id reaches
 * `resolveAddonMeaning` below, resolves to null, and the webhook REPORTS it as
 * an unrecognised add-on (money-path Sentry, `dodo-addon-unrecognised`) instead
 * of dropping it. Their `maxChurches` does NOT move. Someone finds out — which
 * is the entire reason this table names the gap rather than omitting it.
 *
 * `dodo-addon-catalogue.test.ts` PINS this gap as intentional. Filling the two
 * ids means deleting that test on purpose, which is the point: the follow-up
 * cannot quietly forget the second half.
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
  // 🔴 THE GAP. Named, not omitted. See the block above for what a live Campus
  // purchase does today and what filling this in requires.
  campus: Object.freeze({
    monthly: DODO_ADDON_UNMAPPED,
    yearly: DODO_ADDON_UNMAPPED,
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
  return DODO_ACTIVE_ADDONS[meaning][period];
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
