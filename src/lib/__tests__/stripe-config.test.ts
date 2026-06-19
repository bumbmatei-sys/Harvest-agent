import { describe, it, expect } from 'vitest';
import { PLAN_PRICES, getPlanFromPriceId, AI_CHAT_MONTHLY, AI_ASSISTANT_MONTHLY, AI_ASSISTANT_SETUP } from '../stripe-config';

describe('PLAN_PRICES', () => {
  it('has all 4 plans with monthly and yearly prices', () => {
    const plans = ['plus', 'pro', 'max', 'ultra'];
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
    expect(getPlanFromPriceId(PLAN_PRICES.ultra.monthly)).toBe('ultra');
  });

  it('returns null for unknown price ID', () => {
    expect(getPlanFromPriceId('price_unknown_123')).toBeNull();
    expect(getPlanFromPriceId('')).toBeNull();
  });
});

describe('AI price IDs', () => {
  it('exports AI_CHAT_MONTHLY', () => {
    expect(AI_CHAT_MONTHLY).toBeTruthy();
    expect(AI_CHAT_MONTHLY).toMatch(/^price_/);
  });

  it('exports AI_ASSISTANT_MONTHLY and AI_ASSISTANT_SETUP', () => {
    expect(AI_ASSISTANT_MONTHLY).toBeTruthy();
    expect(AI_ASSISTANT_SETUP).toBeTruthy();
  });
});
