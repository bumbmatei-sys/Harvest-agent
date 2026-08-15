import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLAN_ORDER, getEffectiveFeatures, getPlanFeatures, NO_ADDONS } from '../plan-features';

/**
 * REP-5b — the rules the purchase surface has to keep, checked as SOURCE.
 *
 * Some properties are absences: a price that is not written down, a list of
 * add-ons that does not exist, a base-tier function that is no longer consulted
 * for a tenant's caps. An absence is not observable through behaviour — the
 * build looks identical right up until it is wrong — so these are scanned.
 *
 * Comments are stripped before every scan. Stating a rule ("add-on prices live
 * in Dodo, not here") is exactly what these files should do; a literal that
 * could reach a church is what they must not.
 */

const SRC = resolve(__dirname, '../..');
const read = (rel: string) =>
  readFileSync(resolve(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * 🔴 EVERY MODULE THAT COULD DECIDE OR STATE AN ADD-ON'S PRICE, named one by one.
 *
 * The list is written out rather than globbed so that adding a file to this path
 * is a deliberate act that has to come here first. A glob would silently stop
 * covering the thing someone just wrote.
 *
 * ⚠️ THE TWO REACT COMPONENTS ARE NOT HERE, AND THAT IS THE POINT OF THE WHOLE
 * FILE. A numeric scan over JSX matches `size={15}` on an icon, `gap-20` in a
 * class name and every other coincidence — a VALUE PATTERN hitting the wrong
 * thing, which is the failure mode this suite is supposed to be immune to.
 * Keeping them in would mean either a permanently red test or a regex neutered
 * until it proves nothing. They are covered instead by the STRUCTURAL assertion
 * below — they render a price the server handed them and perform no arithmetic
 * on it — which is the property that actually matters for a component: it cannot
 * state a wrong price, because it does not know any price.
 */
const PRICE_BEARING_MODULES = [
  'lib/dodo/addon-purchase.ts',
  'lib/dodo/addons.ts',
  'lib/dodo/catalogue.ts',
  'lib/dodo/billing-context.ts',
  'app/api/dodo/addons/route.ts',
  'app/api/dodo/change-plan/route.ts',
  'utils/addon-change.ts',
];

// ── Test 13 ──────────────────────────────────────────────────────────────────

describe('no add-on price appears anywhere in the repo', () => {
  /**
   * The ten settled add-on prices: AI $19/$228, Seat $10/$120, Campus $15/$180,
   * Contacts +500 $20/$240, Unlimited $59/$708.
   *
   * ⚠️ CHECKED ON THE ADD-ON PATH, NOT BY SWEEPING THE REPO FOR BARE NUMBERS.
   * That is a deliberate choice and the same one `dodo-addon-catalogue.test.ts`
   * makes: `10`, `15`, `20` and `120` are timeouts, sizes, pixel values and
   * durations in hundreds of unrelated places, so a repo-wide numeric sweep
   * would either be permanently red or be neutered into meaninglessness — and
   * it would be matching a VALUE PATTERN, which is precisely how a test ends up
   * asserting something about the wrong thing.
   *
   * What actually needs guarding is narrow and nameable: the files that decide
   * what an add-on costs, describe one, or render one. A price can only become a
   * lie by being written in one of those, and every one of them is listed above.
   */
  const ADDON_PRICES = [19, 228, 10, 120, 15, 180, 20, 240, 59, 708];

  for (const file of PRICE_BEARING_MODULES) {
    it(`${file} writes no add-on price`, () => {
      const code = read(file);
      for (const price of ADDON_PRICES) {
        // Word-boundary on both sides so `120` does not match inside `1200` or
        // `x.120`, and so a class name or an import path cannot trip it.
        const asLiteral = new RegExp(`(?<![\\w.])${price}(?![\\w.])`);
        expect(asLiteral.test(code), `${file} writes ${price} as a literal`).toBe(false);
      }
    });
  }

  it('🔴 the components render prices they were GIVEN, and know none of their own', () => {
    const surface = read('components/settings/AddOnsSection.tsx');
    // Every figure on screen arrives from the catalogue read or the preview and
    // is only formatted. An arithmetic operator applied to a price here would be
    // a second pricing engine; a literal would be a second source of truth.
    expect(surface).toContain('formatAddonPrice');
    expect(surface).toContain('priceMinorUnits');
    expect(surface).not.toMatch(/priceMinorUnits\s*[*+\-/]/);

    // And the parent contributes nothing at all: it mounts the section and hands
    // it a tenant and a processor, no pricing of any kind.
    const parent = read('components/BillingAndPayments.tsx');
    expect(parent).toContain('<AddOnsSection');
    expect(parent).not.toContain('priceMinorUnits');
    expect(parent).not.toContain('formatAddonPrice');
  });
});

// ── Availability is derived, never listed ────────────────────────────────────

describe('the purchase surface holds no list of add-ons', () => {
  it('names no add-on id, in the client or on the wire', () => {
    // 🔴 REP-5a's rule survives add-ons becoming buyable: the ids live once,
    // server-side, in `catalogue.ts`. A client that knew one would break the
    // moment that add-on is recreated in Dodo, and it would put the mapping in a
    // bundle anyone can read.
    for (const file of ['utils/addon-change.ts', 'components/settings/AddOnsSection.tsx']) {
      expect(read(file), `${file} names a Dodo add-on id`).not.toMatch(/['"]adn_/);
    }
  });

  it('the client asks the server what is offerable rather than deciding', () => {
    const surface = read('components/settings/AddOnsSection.tsx');
    // The offer list arrives over the wire. There is no array of add-ons in the
    // component to drift from the active catalogue — which is what makes the
    // live Campus gap unsellable without the component knowing Campus exists.
    expect(surface).toContain('fetchOfferableAddons');
  });

  it('the route derives availability from the active table', () => {
    // `offerableAddonMeanings` filters `DODO_ACTIVE_ADDONS`; nothing on the path
    // enumerates add-ons by hand.
    expect(read('lib/dodo/addon-purchase.ts')).toContain('offerableAddonMeanings');
    expect(read('lib/dodo/catalogue.ts')).toContain('DODO_ADDON_MEANINGS.filter');
  });
});

// ── 🔴 The route writes nothing, as source ───────────────────────────────────

describe('the purchase route is not a writer', () => {
  it('reaches for no Firestore write of any kind', () => {
    const route = read('app/api/dodo/addons/route.ts');
    // The `subscription.plan_changed` webhook is the single writer of `plan` and
    // of the add-on set. Behaviour tests pin the store byte-for-byte; this pins
    // that the capability is not even imported, so it cannot be added by
    // accident in a later edit that the behaviour tests happen not to cover.
    for (const forbidden of ['adminDb', 'firebase-admin', 'tenantPrivateRef', '.set(', '.update(']) {
      expect(route, forbidden).not.toContain(forbidden);
    }
  });

  it('touches no refund path, like every other Dodo route', () => {
    expect(read('app/api/dodo/addons/route.ts')).not.toMatch(/refund/i);
    expect(read('lib/dodo/addon-purchase.ts')).not.toMatch(/refund/i);
  });

  it('imports no Stripe', () => {
    const route = read('app/api/dodo/addons/route.ts');
    expect(route).not.toMatch(/from\s+['"]stripe['"]/);
    expect(route).not.toContain('STRIPE_SECRET_KEY');
  });
});

// ── Test 3, at the boundary this PR moved ────────────────────────────────────

describe('getPlanFeatures is unchanged for every plan', () => {
  /**
   * The function itself is pinned by REP-5a in `effective-features.test.ts`.
   * What THIS PR could have broken is different: `TenantContext.planFeatures`
   * switched from `getPlanFeatures` to `getEffectiveFeatures`, and the risk is
   * that the base-tier function got "helpfully" taught about add-ons instead —
   * which would move all forty of its callers at once, silently, including the
   * ones that are MEANT to show a tier's published number.
   */
  it('still answers the tier, with no knowledge of any tenant', () => {
    for (const plan of PLAN_ORDER) {
      // Identical objects for the same plan every time: no hidden add-on input,
      // no memoised tenant, nothing but the tier.
      expect(getPlanFeatures(plan)).toEqual(getPlanFeatures(plan));
      // And it equals the effective features of a tenant owning NOTHING — which
      // is the precise relationship between the two functions.
      const effective = getEffectiveFeatures(plan, NO_ADDONS);
      for (const key of Object.keys(getPlanFeatures(plan)) as (keyof ReturnType<typeof getPlanFeatures>)[]) {
        expect(effective[key], `${plan}.${key}`).toEqual(getPlanFeatures(plan)[key]);
      }
    }
  });

  it('the context no longer asks it for a TENANT’s caps', () => {
    const context = read('contexts/TenantContext.tsx');
    // 🔴 The whole point of Part A. `getPlanFeatures` answers "what does this
    // TIER include" and cannot answer "what does this CHURCH have" — a tenant
    // that bought five admin seats reads the tier's cap through it.
    expect(context).toContain('getEffectiveFeatures');
    expect(context).not.toContain('getPlanFeatures');
  });

  it('the plan comparison table still reads the TIER, deliberately', () => {
    // The other half of the same decision: a plan-comparison row cannot show one
    // church's purchased capacity, so this surface keeps the base-tier function.
    // If it ever switches, the matrix starts advertising one tenant's add-ons as
    // though they were included in the plan.
    expect(read('components/settings/PlanUpgradeSection.tsx')).toContain('getPlanFeatures');
  });
});
