// 🔴 PRICED tiers only. This suite is about prices and rendered plan CARDS,
// and the Forever Free tier has neither a price nor a card (it has no Dodo
// product to check out with). PLAN_ORDER now includes it; PRICED_PLAN_ORDER is
// the list this file has always meant. See plan-features.ts.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `config.ts` throws at module load on a missing variable — by design, so a
// missing env cannot silently bill the wrong catalogue. Hoisted so it runs
// before the imports below, the same pattern the other Dodo suites use.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('testsecret').toString('base64');
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

import {
  DODO_LIVE_ADDONS,
  DODO_LIVE_CATALOGUE,
  addonIdFor,
  addonPeriodFor,
  offerableAddonMeanings,
  DODO_TERM_FREQUENCY,
} from '../catalogue';
import { BILLING_TERMS, PRICED_PLAN_ORDER, PLAN_PRICING, planPriceUsd } from '@/utils/plan-features';

/* ═══════════════════════════════════════════════════════════════════════════
   THE-195, the parts that live between the catalogue and the add-on table.

   🔴 THE QUARTERLY TERM WAS WITHDRAWN ON 2026-10-23, and this file keeps its
   name on purpose: other guards name it by path (THE-344's sweeps, the ownership
   register), and it is now the suite that says the term is GONE rather than that
   it works. The three quarterly Dodo products were archived; none had a live
   subscription. What survives here is what was always about the catalogue and the
   add-on table: ids disjoint, prices published in both units, the cycle each term
   bills on, the add-on columns, and the price-literal sweep.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── TEST 2 ──────────────────────────────────────────────────────────────── */
describe('the quarterly term is gone from the catalogue; the other two stay distinct', () => {
  /** The three live products archived on 2026-10-23. None may come back. */
  const ARCHIVED_QUARTERLY = {
    plus: 'pdt_0NloCamoWgvgYDih2UETS',
    pro: 'pdt_0NloCaqg1QPMAlkfDnlOe',
    max: 'pdt_0NloCatUWEkEUq1usWJ0n',
  } as const;

  it.each(PRICED_PLAN_ORDER)('%s has a monthly and a yearly product and no quarterly one', (plan) => {
    expect(Object.keys(DODO_LIVE_CATALOGUE[plan])).toEqual(['monthly', 'yearly']);
    expect(Object.values(DODO_LIVE_CATALOGUE[plan]).map((e) => e.productId)).not.toContain(ARCHIVED_QUARTERLY[plan]);
  });

  it('gives each tier its OWN product on each term — no id is shared', () => {
    // A shared id is a church on one tier billed at another's price, and it
    // would satisfy every per-tier assertion taken one at a time.
    for (const term of BILLING_TERMS) {
      const ids = PRICED_PLAN_ORDER.map((p) => DODO_LIVE_CATALOGUE[p][term].productId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('never collides a monthly id with a yearly one', () => {
    const monthly = PRICED_PLAN_ORDER.map((p) => DODO_LIVE_CATALOGUE[p].monthly.productId);
    const yearly = PRICED_PLAN_ORDER.map((p) => DODO_LIVE_CATALOGUE[p].yearly.productId);
    for (const id of monthly) expect(yearly).not.toContain(id);
  });

  it('publishes the price this app charges, in both units', () => {
    // ✅ These are what the CATALOGUE publishes, which is what a checkout cart is
    // built from; the live side is pinned per product id in
    // dodo-catalogue.test.ts, which owns it.
    const CENTS = {
      plus: { monthly: 2000, yearly: 19000 },
      pro: { monthly: 4000, yearly: 38000 },
      max: { monthly: 8000, yearly: 75200 },
    } as const;
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(DODO_LIVE_CATALOGUE[plan][term].priceMinorUnits).toBe(CENTS[plan][term]);
        expect(DODO_LIVE_CATALOGUE[plan][term].priceUsd).toBe(CENTS[plan][term] / 100);
        expect(planPriceUsd(plan, term)).toBe(CENTS[plan][term] / 100);
      }
    }
  });

  it('bills a month as 1 x Month and a year as 1 x Year, and has no 3 x Month cycle', () => {
    expect(DODO_TERM_FREQUENCY.monthly).toEqual({ count: 1, interval: 'Month' });
    expect(DODO_TERM_FREQUENCY.yearly).toEqual({ count: 1, interval: 'Year' });
    expect(Object.keys(DODO_TERM_FREQUENCY)).toEqual(['monthly', 'yearly']);
  });

  it("carries the app's own word into the product metadata, not Dodo's", () => {
    // Dodo says `annual` where the app says `yearly`. The reconciliation lives in
    // catalogue.ts and nowhere else.
    expect(DODO_LIVE_CATALOGUE.max.yearly.dodoBillingPeriod).toBe('annual');
    expect(DODO_LIVE_CATALOGUE.max.monthly.dodoBillingPeriod).toBe('monthly');
  });
});

/* ─── TEST 9 ──────────────────────────────────────────────────────────────── */
describe('every add-on price is unchanged and add-ons are still not discounted annually', () => {
  it('🔴 a monthly plan buys add-ons from the MONTHLY column and a yearly plan from the YEARLY one', () => {
    // Dodo charges an add-on on its PRODUCT's cycle, so the add-on column is the
    // plan's own term. There is no third add-on column and none was invented.
    expect(addonPeriodFor('monthly')).toBe('monthly');
    expect(addonPeriodFor('yearly')).toBe('yearly');
    for (const meaning of ['aiAssistant', 'adminSeat', 'unlimitedContacts'] as const) {
      expect(addonIdFor(meaning, 'monthly')).not.toBe(addonIdFor(meaning, 'yearly'));
    }
  });

  it('floors a legacy stored term to the monthly column rather than throwing', () => {
    // A tenant document written while the quarterly term existed may still say
    // `quarterly`. That value is no longer a `BillingPeriod`, but a stored string
    // can be anything, so the one reconciliation function must answer for it:
    // such a church is quoted the MONTHLY add-on price, which is what its
    // quarterly product actually charged, and is never refused a card.
    expect(addonPeriodFor('quarterly' as never)).toBe('monthly');
  });

  it('offers a monthly church the three add-ons the table maps', () => {
    expect(offerableAddonMeanings('monthly')).toEqual(['aiAssistant', 'adminSeat', 'unlimitedContacts']);
    expect(offerableAddonMeanings('yearly')).toEqual(offerableAddonMeanings('monthly'));
  });

  it('grew no third column in the add-on table', () => {
    // The add-on table is keyed on TWO periods and must stay that way: a third
    // column would be six ids Dodo does not have.
    for (const ids of Object.values(DODO_LIVE_ADDONS)) {
      expect(Object.keys(ids).sort()).toEqual(['monthly', 'yearly']);
    }
  });

  it('pins the live monthly add-on ids the monthly products actually attach', () => {
    // Transcribed from the live products' `addons` arrays. THE-370
    // detached Campus and Contacts +500 from every plan product, so the three
    // below are the whole attachment now. Asserted against DODO_LIVE_ADDONS
    // rather than through
    // `addonIdFor`, which resolves the ACTIVE table — and this suite runs under
    // test_mode.
    const LIVE_MONTHLY = {
      aiAssistant: 'adn_0NlKtuImtSn7PcdvjnSni',
      adminSeat: 'adn_0NlKtw7AayNYI6YYwphQ5',
      unlimitedContacts: 'adn_0NlKtwKAhJgz0jeaqDX2c',
    } as const;
    for (const [meaning, id] of Object.entries(LIVE_MONTHLY)) {
      expect(DODO_LIVE_ADDONS[meaning as keyof typeof LIVE_MONTHLY].monthly).toBe(id);
    }
  });

  it('stores no add-on price in this repo at all — Dodo is asked every time', () => {
    // The one add-on figure this repo holds is the RETIRED AI Assistant price,
    // which is dormant by design. Everything the add-on surface renders is
    // fetched from Dodo per request, so a repricing there needs no code change
    // and cannot go stale here.
    const src = readFileSync(resolve(__dirname, '../catalogue.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const price of [19, 228, 10, 120, 15, 180, 20, 240, 59, 708]) {
      expect(
        new RegExp(`(?<![\\w.])${price}(?![\\w.])`).test(src),
        `catalogue.ts writes the add-on price ${price} as a literal`,
      ).toBe(false);
    }
  });
});

/* ─── TEST 10 ─────────────────────────────────────────────────────────────── */
describe('no price literal appears outside the single source', () => {
  const SRC = resolve(__dirname, '../../..');

  /**
   * `PLAN_PRICING` in utils/plan-features.ts is the ONE place a plan price is
   * written. Its own test file states the six numbers independently, which is
   * what makes that file a checked claim rather than a loose copy.
   */
  const PRICE_BEARING = ['utils/plan-features.ts'];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  const modules = walk(SRC).filter((f) => !PRICE_BEARING.some((a) => f.endsWith(a)));
  const CURRENT = [...new Set(PRICED_PLAN_ORDER.flatMap((p) => BILLING_TERMS.map((t) => String(planPriceUsd(p, t)))))];
  /**
   * Prices THE-195 retired. None may survive in executable source.
   *
   * ⚠️ THIS LIST IS WHERE THE-222 IS MOST DANGEROUS, because the reprice moved
   * the whole table DOWN A TIER and four figures changed meaning rather than
   * retiring:
   *
   *   $49    was Individual monthly (pre-THE-195), banned outright until now.
   *          It is Individual QUARTERLY as of THE-222, so it has LEFT this list
   *          — banning it would ban the live catalogue.
   *   $99    was Individual quarterly, is now Small Team quarterly.
   *   $199   was Small Team quarterly, is now Ministry quarterly.
   *   $329   was Individual yearly, is now Small Team yearly.
   *   $659   was Small Team yearly, is now Ministry yearly.
   *
   * None of those five may be banned: every one is a price some tier charges
   * today, and only the TIER it belongs to changed. They are distinguished by
   * CONTEXT, not by string match — the `CURRENT` sweep above pins where each is
   * allowed to appear, and the cross-repo contract pins what each means.
   *
   * 🔴 WHAT DID RETIRE. `39`, `79`, `159`, `399` and `1329` — the whole of the
   * old monthly column plus the two top-tier figures nothing inherited — are no
   * longer a price on any tier or any term, so they join the pre-THE-195
   * figures and are banned outright. A mutation that put `$39/mo` back into the AdminTenants labels is
   * the case this catches, and it is the same mutation `$49/mo` used to be.
   */
  const RETIRED = [
    '441', '891', '1791', '37', '74', '149', '39', '79', '159', '399', '1329',
    // The quarterly term's three prices, retired with it on 2026-10-23. Each is
    // a price on no tier and no term now.
    '54', '108', '216',
  ];

  it('finds the modules to scan at all', () => {
    expect(modules.length).toBeGreaterThan(50);
  });

  /**
   * Comments are stripped before scanning, the same rule `dodo-catalogue.test.ts`
   * already applies to this repo's source.
   *
   * A comment that says "the $39–$159 tier" is DOCUMENTATION — it explains why a
   * guard exists and renders nothing. Only executable source can bill a church
   * the wrong amount, and a rule that failed on prose would be turned off rather
   * than obeyed. Comments carrying stale figures are still worth fixing; they
   * are not what this test is for.
   */
  const codeOf = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  it.each(CURRENT)('no module outside plan-features.ts restates $%s', (digits) => {
    for (const file of modules) {
      expect(codeOf(file), `${file} writes $${digits} as a literal — plan prices derive from PLAN_PRICING`)
        .not.toMatch(new RegExp(`\\$${digits}(?![0-9])`));
    }
  });

  it.each(RETIRED)('no module still carries the retired price $%s', (digits) => {
    for (const file of modules) {
      expect(codeOf(file), `${file} still carries the pre-THE-195 price $${digits}`)
        .not.toMatch(new RegExp(`\\$${digits}(?![0-9])`));
    }
  });

  it('leaves PLAN_PRICING as the only table, with the six numbers in it', () => {
    expect(Object.keys(PLAN_PRICING).sort()).toEqual([...PRICED_PLAN_ORDER].sort());
    for (const plan of PRICED_PLAN_ORDER) {
      expect(Object.keys(PLAN_PRICING[plan]).sort()).toEqual([...BILLING_TERMS].sort());
    }
  });
});
