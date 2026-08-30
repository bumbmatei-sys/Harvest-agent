import { describe, it, expect } from 'vitest';
import { PLAN_PRICES, getPlanFromPriceId } from '../billing';

describe('PLAN_PRICES', () => {
  it('has no ultra entry — the tier was deleted', () => {
    expect(PLAN_PRICES.ultra).toBeUndefined();
    expect(Object.keys(PLAN_PRICES)).toEqual(['plus', 'pro', 'max']);
  });

  it('has all 3 plans with monthly and yearly prices', () => {
    const plans = ['plus', 'pro', 'max'];
    for (const plan of plans) {
      expect(PLAN_PRICES[plan]).toBeDefined();
      expect(PLAN_PRICES[plan].monthly).toBeTruthy();
      expect(PLAN_PRICES[plan].yearly).toBeTruthy();
      expect(PLAN_PRICES[plan].monthly).toMatch(/^price_/);
      expect(PLAN_PRICES[plan].yearly).toMatch(/^price_/);
    }
  });

  it('all price IDs are unique', () => {
    const allPrices = Object.values(PLAN_PRICES).flatMap(p => [p.monthly, p.yearly]);
    const unique = new Set(allPrices);
    expect(unique.size).toBe(allPrices.length);
  });
});

describe('getPlanFromPriceId', () => {
  it('returns correct plan for known price IDs', () => {
    expect(getPlanFromPriceId(PLAN_PRICES.plus.monthly)).toBe('plus');
    expect(getPlanFromPriceId(PLAN_PRICES.pro.yearly)).toBe('pro');
    expect(getPlanFromPriceId(PLAN_PRICES.max.monthly)).toBe('max');
  });

  it('returns null for unknown price ID', () => {
    expect(getPlanFromPriceId('price_unknown_123')).toBeNull();
    expect(getPlanFromPriceId('')).toBeNull();
  });
});

/* WAS 'AI price IDs — exports AI_ASSISTANT_SETUP'. Both that constant and
   AI_ASSISTANT_MONTHLY ($200/mo) were the retired Telegram assistant's Stripe
   prices and were deleted with it (THE-253). Nothing creates a Stripe
   AI Assistant subscription any more; the AI chat is a $20/mo Dodo add-on whose
   ids live in lib/dodo/catalogue.ts. Their absence is asserted in
   the-224-ai-assistant-no-seat.test.ts, where the rest of the deletion is
   pinned, rather than by an import that would not compile here. */
