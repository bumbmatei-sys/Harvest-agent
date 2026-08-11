/**
 * The Dodo catalogue's prices.
 *
 * Two things are pinned here, and they are different claims:
 *   1. the published figures — 49/441, 99/891, 199/1791 USD; and
 *   2. that the ANNUAL figures are DERIVED from `ANNUAL_BILLED_MONTHS`, not
 *      typed out.
 *
 * (1) alone would pass against six literals, which is the defect: the 25%
 * annual discount would then live in two files and the next change to it would
 * leave Dodo charging the old price. (2) is enforced by re-importing the
 * catalogue with the constant mocked to a different value — a hard-coded 441
 * cannot follow it and the suite fails.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANNUAL_BILLED_MONTHS, PLAN_ORDER, PLAN_PRICING } from '@/utils/plan-features';
import {
  DODO_PRODUCT_SPECS,
  DODO_TRIAL_PERIOD_DAYS,
  dodoProductSpec,
  planAmountUsd,
} from '../catalogue';

afterEach(() => {
  vi.doUnmock('@/utils/plan-features');
  vi.resetModules();
});

describe('published prices', () => {
  it.each([
    ['plus', 49, 441],
    ['pro', 99, 891],
    ['max', 199, 1791],
  ] as const)('%s resolves to $%d monthly and $%d annually', (plan, monthly, yearly) => {
    expect(planAmountUsd(plan, 'monthly')).toBe(monthly);
    expect(planAmountUsd(plan, 'yearly')).toBe(yearly);
  });

  it('charges in cents, the minor unit Dodo expects', () => {
    expect(dodoProductSpec('max', 'monthly').priceMinorUnits).toBe(19_900);
    expect(dodoProductSpec('max', 'yearly').priceMinorUnits).toBe(179_100);
  });

  it('bills every plan in USD on a 1-month or 1-year cycle', () => {
    for (const spec of DODO_PRODUCT_SPECS) {
      expect(spec.currency).toBe('USD');
      expect(spec.paymentFrequency).toEqual({
        count: 1,
        interval: spec.interval === 'yearly' ? 'Year' : 'Month',
      });
      expect(spec.subscriptionPeriod).toEqual(spec.paymentFrequency);
    }
  });
});

describe('annual is derived from ANNUAL_BILLED_MONTHS, never retyped', () => {
  it('equals monthly × ANNUAL_BILLED_MONTHS on every tier', () => {
    for (const plan of PLAN_ORDER) {
      expect(planAmountUsd(plan, 'yearly')).toBe(
        PLAN_PRICING[plan].monthlyUsd * ANNUAL_BILLED_MONTHS,
      );
    }
  });

  it('follows the constant when it changes — a literal annual price cannot', async () => {
    vi.resetModules();
    vi.doMock('@/utils/plan-features', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/utils/plan-features')>()),
      ANNUAL_BILLED_MONTHS: 10,
    }));

    const catalogue = await import('../catalogue');

    // 49 × 10, 99 × 10, 199 × 10 — nothing here is 441/891/1791 any more.
    expect(catalogue.planAmountUsd('plus', 'yearly')).toBe(490);
    expect(catalogue.planAmountUsd('pro', 'yearly')).toBe(990);
    expect(catalogue.planAmountUsd('max', 'yearly')).toBe(1990);
    // Monthly is unaffected by the annual multiplier.
    expect(catalogue.planAmountUsd('max', 'monthly')).toBe(199);
  });
});

describe('the product set', () => {
  it('is every plan in PLAN_ORDER at both cadences — six Dodo products', () => {
    // Dodo products carry exactly one price each; there is no separate price
    // object, so "3 plans × 2 cadences" is 6 products, not 3.
    expect(DODO_PRODUCT_SPECS).toHaveLength(PLAN_ORDER.length * 2);
    for (const plan of PLAN_ORDER) {
      for (const interval of ['monthly', 'yearly'] as const) {
        expect(DODO_PRODUCT_SPECS.filter((s) => s.plan === plan && s.interval === interval)).toHaveLength(1);
      }
    }
  });

  it('labels each product distinctly, so an invoice line names what was bought', () => {
    const names = DODO_PRODUCT_SPECS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(dodoProductSpec('max', 'yearly').name).toBe('Harvest Ministry — Annual');
    expect(dodoProductSpec('plus', 'monthly').name).toBe('Harvest Individual — Monthly');
  });

  it('carries no add-on products yet — seats, campuses and AI come after the base flow', () => {
    for (const spec of DODO_PRODUCT_SPECS) {
      expect(PLAN_ORDER).toContain(spec.plan);
    }
  });
});

describe('trial', () => {
  it('is 14 days on the Dodo products', () => {
    expect(DODO_TRIAL_PERIOD_DAYS).toBe(14);
    for (const spec of DODO_PRODUCT_SPECS) {
      expect(spec.trialPeriodDays).toBe(14);
    }
  });
});
