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
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── TEST 2 ──────────────────────────────────────────────────────────────── */
describe('the three quarterly product ids resolve', () => {
  /** Read back from the authenticated LIVE Dodo API on 2026-08-20. */
  const QUARTERLY = {
    plus: 'pdt_0NloCamoWgvgYDih2UETS',
    pro: 'pdt_0NloCaqg1QPMAlkfDnlOe',
    max: 'pdt_0NloCatUWEkEUq1usWJ0n',
  } as const;

  it.each(PRICED_PLAN_ORDER)('%s resolves to its verified quarterly product', (plan) => {
    expect(DODO_LIVE_CATALOGUE[plan].quarterly.productId).toBe(QUARTERLY[plan]);
  });

  it('gives each tier its OWN quarterly product — no id is shared', () => {
    // A shared id is a church on one tier billed at another's price, and it
    // would satisfy every per-tier assertion above taken one at a time.
    const ids = PRICED_PLAN_ORDER.map((p) => DODO_LIVE_CATALOGUE[p].quarterly.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never collides with a monthly or annual id', () => {
    const others = PRICED_PLAN_ORDER.flatMap((p) => [
      DODO_LIVE_CATALOGUE[p].monthly.productId,
      DODO_LIVE_CATALOGUE[p].yearly.productId,
    ]);
    for (const plan of PRICED_PLAN_ORDER) {
      expect(others).not.toContain(DODO_LIVE_CATALOGUE[plan].quarterly.productId);
    }
  });

  it('publishes the quarterly price this app charges, in both units', () => {
    // ✅ AND ON MINISTRY IT IS THE SAME NUMBER AGAIN. THE-343 repriced
    // Ministry's quarter to $162 (16200) in this repo ahead of Dodo, so for a
    // window these figures were the app's side only; THE-344 repriced the live
    // product and read it back at 16200, so the catalogue and live Dodo agree
    // on all three quarters. These figures are still what the CATALOGUE
    // publishes, which is what a checkout cart is built from; the live side is
    // pinned per product id in dodo-catalogue.test.ts, which owns it.
    const CENTS = { plus: 5400, pro: 10800, max: 16200 } as const;
    for (const plan of PRICED_PLAN_ORDER) {
      expect(DODO_LIVE_CATALOGUE[plan].quarterly.priceMinorUnits).toBe(CENTS[plan]);
      expect(DODO_LIVE_CATALOGUE[plan].quarterly.priceUsd).toBe(CENTS[plan] / 100);
      expect(planPriceUsd(plan, 'quarterly')).toBe(CENTS[plan] / 100);
    }
  });

  it('bills quarterly as 3 × Month, which is how Dodo expresses a quarter', () => {
    expect(DODO_TERM_FREQUENCY.quarterly).toEqual({ count: 3, interval: 'Month' });
    expect(DODO_TERM_FREQUENCY.monthly).toEqual({ count: 1, interval: 'Month' });
    expect(DODO_TERM_FREQUENCY.yearly).toEqual({ count: 1, interval: 'Year' });
  });

  it("carries the app's own word into the product metadata, not Dodo's", () => {
    // Dodo says `annual` where the app says `yearly`; quarterly is the same word
    // on both sides. The reconciliation lives in catalogue.ts and nowhere else.
    expect(DODO_LIVE_CATALOGUE.max.quarterly.dodoBillingPeriod).toBe('quarterly');
    expect(DODO_LIVE_CATALOGUE.max.yearly.dodoBillingPeriod).toBe('annual');
    expect(DODO_LIVE_CATALOGUE.max.monthly.dodoBillingPeriod).toBe('monthly');
  });
});

/* ─── TEST 9 ──────────────────────────────────────────────────────────────── */
describe('every add-on price is unchanged and add-ons are still not discounted annually', () => {
  it('🔴 a quarterly plan buys add-ons from the MONTHLY column', () => {
    // Dodo charges an add-on on its PRODUCT's cycle, and a quarterly product
    // cycles in months — verified against the live API, where all three
    // quarterly products carry the monthly add-on ids. So a quarterly church
    // pays the MONTHLY add-on price, every month, exactly as a monthly church
    // does. There is no quarterly add-on and none was invented.
    expect(addonPeriodFor('quarterly')).toBe('monthly');
    expect(addonPeriodFor('monthly')).toBe('monthly');
    expect(addonPeriodFor('yearly')).toBe('yearly');
    for (const meaning of ['aiAssistant', 'adminSeat', 'campus', 'contactPack', 'unlimitedContacts'] as const) {
      expect(addonIdFor(meaning, 'quarterly')).toBe(addonIdFor(meaning, 'monthly'));
      expect(addonIdFor(meaning, 'quarterly')).not.toBe(addonIdFor(meaning, 'yearly'));
    }
  });

  it('offers a quarterly church exactly what a monthly one is offered', () => {
    expect(offerableAddonMeanings('quarterly')).toEqual(offerableAddonMeanings('monthly'));
  });

  it('grew no third column in the add-on table', () => {
    // The add-on table is keyed on TWO periods and must stay that way: a third
    // column would be six ids Dodo does not have.
    for (const ids of Object.values(DODO_LIVE_ADDONS)) {
      expect(Object.keys(ids).sort()).toEqual(['monthly', 'yearly']);
    }
  });

  it('pins the live monthly add-on ids the quarterly products actually attach', () => {
    // Transcribed from the live quarterly products' `addons` arrays, read back
    // on 2026-08-20. Asserted against DODO_LIVE_ADDONS rather than through
    // `addonIdFor`, which resolves the ACTIVE table — and this suite runs under
    // test_mode.
    const LIVE_MONTHLY = {
      aiAssistant: 'adn_0NlKtuImtSn7PcdvjnSni',
      adminSeat: 'adn_0NlKtw7AayNYI6YYwphQ5',
      campus: 'adn_0NlKwDcuqIWoVK7Qay13L',
      contactPack: 'adn_0NlKtwD3VfBLgx2LTw69O',
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
   * written. Its own test file states the nine numbers independently, which is
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
  const RETIRED = ['441', '891', '1791', '37', '74', '149', '39', '79', '159', '399', '1329'];

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

  it('leaves PLAN_PRICING as the only table, with the nine numbers in it', () => {
    expect(Object.keys(PLAN_PRICING).sort()).toEqual([...PRICED_PLAN_ORDER].sort());
    for (const plan of PRICED_PLAN_ORDER) {
      expect(Object.keys(PLAN_PRICING[plan]).sort()).toEqual([...BILLING_TERMS].sort());
    }
  });
});
