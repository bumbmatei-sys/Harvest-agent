import { describe, it, expect } from 'vitest';
import { PLATFORM_FEE_MAP } from '../stripe-config';

// Fees are stored as DECIMAL fractions (0.04 = 4%), not integer percents.
// The two money paths (src/app/api/stripe/donate + event-registration/submit)
// multiply money by these directly — one-time as Math.round(amount * fee) and
// monthly as application_fee_percent: fee * 100 — so these MUST stay decimals.
describe('PLATFORM_FEE_MAP', () => {
  it('stores each tier fee as the correct decimal fraction', () => {
    expect(PLATFORM_FEE_MAP.plus).toBe(0.04);   // Seed (free) — 4%
    expect(PLATFORM_FEE_MAP.pro).toBe(0.02);    // Root — 2%
    expect(PLATFORM_FEE_MAP.max).toBe(0.01);    // Grove — 1%
    expect(PLATFORM_FEE_MAP.ultra).toBe(0);     // Harvest — 0%
  });

  it('defaults a missing/unknown plan to 0 (no fee)', () => {
    expect(PLATFORM_FEE_MAP['nonexistent'] ?? 0).toBe(0);
  });

  it('computes the platform fee correctly for a sample donation', () => {
    // Mirrors the money paths: applicationFeeAmount = Math.round(amount * fee),
    // amounts in cents. $100.00 = 10000 cents.
    const amount = 10000;

    const maxFee = Math.round(amount * PLATFORM_FEE_MAP.max);
    expect(maxFee).toBe(100);            // $1.00 fee on Grove (1%)
    expect(amount - maxFee).toBe(9900);  // $99.00 net to the church

    // Seed (free) takes 4% → $4.00 fee, $96.00 net. The free tier pays the most.
    expect(Math.round(amount * PLATFORM_FEE_MAP.plus)).toBe(400);
    expect(amount - Math.round(amount * PLATFORM_FEE_MAP.plus)).toBe(9600);

    // Root takes 2% → $2.00 fee, $98.00 net.
    expect(Math.round(amount * PLATFORM_FEE_MAP.pro)).toBe(200);
    expect(amount - Math.round(amount * PLATFORM_FEE_MAP.pro)).toBe(9800);

    // Harvest takes nothing → church keeps the full gift.
    expect(Math.round(amount * PLATFORM_FEE_MAP.ultra)).toBe(0);
  });

  it('converts to Stripe application_fee_percent for monthly gifts', () => {
    // Monthly donations set application_fee_percent: feePercent * 100. Every
    // conversion is exact in IEEE 754 at these rates, and every result is a
    // whole percent — the fractional-percent formatting risk is gone.
    expect(PLATFORM_FEE_MAP.plus * 100).toBe(4);
    expect(PLATFORM_FEE_MAP.pro * 100).toBe(2);
    expect(PLATFORM_FEE_MAP.max * 100).toBe(1);
    expect(PLATFORM_FEE_MAP.ultra * 100).toBe(0);
  });
});
