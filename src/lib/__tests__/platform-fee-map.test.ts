import { describe, it, expect } from 'vitest';
import { PLATFORM_FEE_MAP } from '../stripe-config';

// Fees are stored as DECIMAL fractions (0.015 = 1.5%), not integer percents.
// The two money paths (src/app/api/stripe/donate + event-registration/submit)
// multiply money by these directly — one-time as Math.round(amount * fee) and
// monthly as application_fee_percent: fee * 100 — so these MUST stay decimals.
//
// Every tier is now 0: Harvest takes no cut of a donation or a paid ticket on
// any plan. These assertions are what stops the app advertising "0% fee" while
// a rate quietly creeps back into the map — the exact failure that shipped once
// before, when the matrix said "keeps 100%" against a real 2.5% charge.
describe('PLATFORM_FEE_MAP', () => {
  it('is zero on every tier', () => {
    expect(PLATFORM_FEE_MAP.plus).toBe(0);  // Individual — 0%
    expect(PLATFORM_FEE_MAP.pro).toBe(0);   // Small Team — 0%
    expect(PLATFORM_FEE_MAP.max).toBe(0);   // Ministry   — 0%
  });

  it('has exactly three tiers and no ultra key', () => {
    expect(Object.keys(PLATFORM_FEE_MAP)).toEqual(['plus', 'pro', 'max']);
  });

  it('carries no non-zero rate anywhere in the map', () => {
    expect(Object.values(PLATFORM_FEE_MAP).every((fee) => fee === 0)).toBe(true);
  });

  it('defaults a missing/unknown plan to 0 (no fee)', () => {
    expect(PLATFORM_FEE_MAP['nonexistent'] ?? 0).toBe(0);
  });

  it('deducts nothing from a sample donation on any tier', () => {
    // Mirrors the money paths: applicationFeeAmount = Math.round(amount * fee),
    // amounts in cents. $100.00 = 10000 cents.
    const amount = 10000;
    for (const plan of ['plus', 'pro', 'max'] as const) {
      const fee = Math.round(amount * PLATFORM_FEE_MAP[plan]);
      expect(fee, `${plan} deducted a fee`).toBe(0);
      expect(amount - fee).toBe(10000); // the church keeps the whole gift
    }
  });

  it('converts to a 0 application_fee_percent for monthly gifts', () => {
    // Monthly donations set application_fee_percent: feePercent * 100.
    expect(PLATFORM_FEE_MAP.plus * 100).toBe(0);
    expect(PLATFORM_FEE_MAP.pro * 100).toBe(0);
    expect(PLATFORM_FEE_MAP.max * 100).toBe(0);
  });
});
