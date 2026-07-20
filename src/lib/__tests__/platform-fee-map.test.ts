import { describe, it, expect } from 'vitest';
import { PLATFORM_FEE_MAP } from '../stripe-config';

// Fees are stored as DECIMAL fractions (0.05 = 5%), not integer percents.
// The two money paths (src/app/api/stripe/donate + event-registration/submit)
// multiply money by these directly — one-time as Math.round(amount * fee) and
// monthly as application_fee_percent: fee * 100 — so these MUST stay decimals.
describe('PLATFORM_FEE_MAP', () => {
  it('stores each tier fee as the correct decimal fraction', () => {
    expect(PLATFORM_FEE_MAP.plus).toBe(0.05);   // Individual — 5%
    expect(PLATFORM_FEE_MAP.pro).toBe(0.05);    // Small Team — 5%
    expect(PLATFORM_FEE_MAP.max).toBe(0.025);   // Community — 2.5%
    expect(PLATFORM_FEE_MAP.ultra).toBe(0);     // Ministry — 0%
  });

  it('defaults a missing/unknown plan to 0 (no fee)', () => {
    expect(PLATFORM_FEE_MAP['nonexistent'] ?? 0).toBe(0);
  });

  it('computes the platform fee correctly for a sample donation', () => {
    // Mirrors the money paths: applicationFeeAmount = Math.round(amount * fee),
    // amounts in cents. $100.00 = 10000 cents.
    const amount = 10000;

    const maxFee = Math.round(amount * PLATFORM_FEE_MAP.max);
    expect(maxFee).toBe(250);            // $2.50 fee on Community (2.5%)
    expect(amount - maxFee).toBe(9750);  // $97.50 net to the church

    // Individual/Small Team both take 5% → $5.00 fee, $95.00 net.
    expect(Math.round(amount * PLATFORM_FEE_MAP.plus)).toBe(500);
    expect(Math.round(amount * PLATFORM_FEE_MAP.pro)).toBe(500);

    // Ministry takes nothing → church keeps the full gift.
    expect(Math.round(amount * PLATFORM_FEE_MAP.ultra)).toBe(0);
  });

  it('converts to Stripe application_fee_percent for monthly gifts', () => {
    // Monthly donations set application_fee_percent: feePercent * 100.
    expect(PLATFORM_FEE_MAP.max * 100).toBe(2.5);
    expect(PLATFORM_FEE_MAP.plus * 100).toBe(5);
  });
});
