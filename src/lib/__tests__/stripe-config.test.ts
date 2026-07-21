import { describe, it, expect, afterEach, vi } from 'vitest';
import { PLAN_PRICES, getPlanFromPriceId, AI_ASSISTANT_MONTHLY } from '../stripe-config';

// The 9 required price env vars, and the values the global test setup supplies.
const REQUIRED_VARS = [
  'STRIPE_PRICE_PLUS_MONTHLY',
  'STRIPE_PRICE_PLUS_YEARLY',
  'STRIPE_PRICE_PRO_MONTHLY',
  'STRIPE_PRICE_PRO_YEARLY',
  'STRIPE_PRICE_MAX_MONTHLY',
  'STRIPE_PRICE_MAX_YEARLY',
  'STRIPE_PRICE_ULTRA_MONTHLY',
  'STRIPE_PRICE_ULTRA_YEARLY',
  'STRIPE_PRICE_AI_MONTHLY',
] as const;

/**
 * Load a fresh copy of stripe-config with a controlled env: every required var
 * set to a fake price id, minus the ones named in `omit` (deleted) or `empty`
 * (set to ''). Restores env afterwards via afterEach.
 */
async function loadWith({ omit = [], empty = [] }: { omit?: string[]; empty?: string[] } = {}) {
  vi.resetModules();
  for (const name of REQUIRED_VARS) {
    if (omit.includes(name)) {
      delete process.env[name];
    } else if (empty.includes(name)) {
      process.env[name] = '';
    } else {
      process.env[name] = `price_test_${name.toLowerCase()}`;
    }
  }
  return import('../stripe-config');
}

const savedEnv = { ...process.env };
afterEach(() => {
  // Restore env vars mutated by loadWith so the shared setup values are intact.
  for (const name of REQUIRED_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  vi.resetModules();
});

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

  it('maps each plan × billing combo to its env var value', async () => {
    const mod = await loadWith();
    const combos: Array<[string, 'monthly' | 'yearly', string]> = [
      ['plus', 'monthly', 'STRIPE_PRICE_PLUS_MONTHLY'],
      ['plus', 'yearly', 'STRIPE_PRICE_PLUS_YEARLY'],
      ['pro', 'monthly', 'STRIPE_PRICE_PRO_MONTHLY'],
      ['pro', 'yearly', 'STRIPE_PRICE_PRO_YEARLY'],
      ['max', 'monthly', 'STRIPE_PRICE_MAX_MONTHLY'],
      ['max', 'yearly', 'STRIPE_PRICE_MAX_YEARLY'],
      ['ultra', 'monthly', 'STRIPE_PRICE_ULTRA_MONTHLY'],
      ['ultra', 'yearly', 'STRIPE_PRICE_ULTRA_YEARLY'],
    ];
    for (const [plan, billing, envName] of combos) {
      expect(mod.PLAN_PRICES[plan][billing]).toBe(process.env[envName]);
    }
    expect(mod.AI_ASSISTANT_MONTHLY).toBe(process.env.STRIPE_PRICE_AI_MONTHLY);
  });
});

describe('required env var validation', () => {
  it('loads cleanly when all 9 vars are present', async () => {
    await expect(loadWith()).resolves.toBeTruthy();
  });

  it('throws and names the one missing var', async () => {
    await expect(loadWith({ omit: ['STRIPE_PRICE_AI_MONTHLY'] })).rejects.toThrow(
      /STRIPE_PRICE_AI_MONTHLY/
    );
  });

  it('throws and names every missing var in one message', async () => {
    const missing = ['STRIPE_PRICE_PLUS_MONTHLY', 'STRIPE_PRICE_MAX_YEARLY', 'STRIPE_PRICE_AI_MONTHLY'];
    try {
      await loadWith({ omit: missing });
      throw new Error('expected module load to throw');
    } catch (err) {
      const message = (err as Error).message;
      for (const name of missing) expect(message).toContain(name);
      // Vars that ARE present must not be listed as missing.
      expect(message).not.toContain('STRIPE_PRICE_PRO_MONTHLY');
    }
  });

  it('treats an empty string the same as missing', async () => {
    await expect(loadWith({ empty: ['STRIPE_PRICE_ULTRA_YEARLY'] })).rejects.toThrow(
      /STRIPE_PRICE_ULTRA_YEARLY/
    );
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

describe('AI price ID', () => {
  it('exports AI_ASSISTANT_MONTHLY from STRIPE_PRICE_AI_MONTHLY', () => {
    expect(AI_ASSISTANT_MONTHLY).toBeTruthy();
    expect(AI_ASSISTANT_MONTHLY).toBe(process.env.STRIPE_PRICE_AI_MONTHLY);
  });
});
