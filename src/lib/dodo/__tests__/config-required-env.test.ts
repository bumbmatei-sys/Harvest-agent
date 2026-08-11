/**
 * A missing Dodo variable must throw AT MODULE LOAD — no fallback, no
 * placeholder, no "it worked in test mode".
 *
 * `billing.ts` reads its Stripe price IDs as `process.env.X ?? 'price_<test
 * id>'`, so a deployment missing its live IDs quietly bills against test-mode
 * prices instead of refusing to start. This suite pins the opposite behaviour
 * for every Dodo variable: import the module without one and the import itself
 * rejects, loudly, naming the variable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A complete, valid Dodo environment — the baseline each case removes one from. */
const COMPLETE_ENV: Record<string, string> = {
  DODO_ENVIRONMENT: 'test_mode',
  DODO_API_KEY: 'dodo_test_key',
  DODO_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=',
  DODO_PRODUCT_PLUS_MONTHLY: 'pdt_plus_monthly',
  DODO_PRODUCT_PLUS_YEARLY: 'pdt_plus_yearly',
  DODO_PRODUCT_PRO_MONTHLY: 'pdt_pro_monthly',
  DODO_PRODUCT_PRO_YEARLY: 'pdt_pro_yearly',
  DODO_PRODUCT_MAX_MONTHLY: 'pdt_max_monthly',
  DODO_PRODUCT_MAX_YEARLY: 'pdt_max_yearly',
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries(COMPLETE_ENV)) process.env[key] = value;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('required env', () => {
  it('loads when every variable is present', async () => {
    const config = await import('../config');
    expect(config.DODO_API_BASE_URL).toBe('https://test.dodopayments.com');
    expect(config.dodoProductId('max', 'yearly')).toBe('pdt_max_yearly');
  });

  it.each(Object.keys(COMPLETE_ENV))('throws at import when %s is missing', async (variable) => {
    delete process.env[variable];
    vi.resetModules();
    await expect(import('../config')).rejects.toThrow(variable);
  });

  it.each(Object.keys(COMPLETE_ENV))('throws at import when %s is empty', async (variable) => {
    // An env var set to "" in a dashboard is a mistake, not a deliberate value.
    process.env[variable] = '   ';
    vi.resetModules();
    await expect(import('../config')).rejects.toThrow(variable);
  });

  it('never substitutes a placeholder product id for a missing one', async () => {
    delete process.env.DODO_PRODUCT_PRO_YEARLY;
    vi.resetModules();
    await expect(import('../config')).rejects.toThrow(/no fallback/i);
  });

  it('refuses a DODO_ENVIRONMENT that is neither test_mode nor live_mode', async () => {
    // Not defaulted either way: guessing sends live money to the sandbox, or
    // sandbox traffic to live cards.
    process.env.DODO_ENVIRONMENT = 'sandbox';
    vi.resetModules();
    await expect(import('../config')).rejects.toThrow(/test_mode.*live_mode|live_mode.*test_mode/);
  });

  it('never infers the environment from the API key', async () => {
    process.env.DODO_ENVIRONMENT = 'live_mode';
    process.env.DODO_API_KEY = 'dodo_test_looks_like_a_test_key';
    vi.resetModules();
    const config = await import('../config');
    // The explicit variable wins, because a key prefix is not a mode.
    expect(config.DODO_ENVIRONMENT).toBe('live_mode');
    expect(config.DODO_API_BASE_URL).toBe('https://live.dodopayments.com');
  });
});

describe('the product id map', () => {
  it('resolves a plan from a product id, and null for anything else', async () => {
    const { planFromDodoProductId } = await import('../config');
    expect(planFromDodoProductId('pdt_pro_monthly')).toEqual({ plan: 'pro', interval: 'monthly' });
    expect(planFromDodoProductId('pdt_plus_yearly')).toEqual({ plan: 'plus', interval: 'yearly' });
    // An add-on or hand-made subscription is not a plan — and must not be
    // guessed into one.
    expect(planFromDodoProductId('pdt_some_addon')).toBeNull();
  });

  it('requires a product for every tier in PLAN_ORDER', async () => {
    const { PLAN_ORDER } = await import('@/utils/plan-features');
    const { dodoProductId } = await import('../config');
    for (const plan of PLAN_ORDER) {
      expect(dodoProductId(plan, 'monthly')).toBeTruthy();
      expect(dodoProductId(plan, 'yearly')).toBeTruthy();
    }
  });
});
