import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Test 2 — a missing required env var throws AT MODULE LOAD, with no fallback.
 *
 * This is #207's argument, implemented. That issue was closed as dead work only
 * because hardening the STRIPE_* vars would be thrown away at this migration;
 * these are the variables that replace them.
 *
 * The failure mode being prevented is specific and expensive. `billing.ts` reads
 * `process.env.STRIPE_PRICE_PLUS_MONTHLY ?? 'price_1TjKTb...'`. If that variable
 * is ever absent in production, nothing breaks, nothing logs, and every signup
 * silently transacts against a TEST price. The money simply does not arrive. A
 * throw at import is loud, immediate, and happens at deploy time rather than to
 * a customer.
 *
 * Every case below re-imports the module with `vi.resetModules()`, because "at
 * module load" is precisely the claim under test — a lazy check inside a function
 * would pass a value assertion and fail this one.
 */

const REQUIRED = ['DODO_PAYMENTS_API_KEY', 'DODO_PAYMENTS_WEBHOOK_KEY', 'DODO_PAYMENTS_ENVIRONMENT'] as const;

const VALID_ENV: Record<(typeof REQUIRED)[number], string> = {
  DODO_PAYMENTS_API_KEY: 'dodo_test_key',
  DODO_PAYMENTS_WEBHOOK_KEY: 'whsec_dGVzdHNlY3JldA==',
  DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
};

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  for (const key of REQUIRED) {
    saved[key] = process.env[key];
    process.env[key] = VALID_ENV[key];
  }
});

afterEach(() => {
  for (const key of REQUIRED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('a missing required env var throws at module load', () => {
  it.each(REQUIRED)('throws when %s is absent', async (missing) => {
    delete process.env[missing];
    await expect(import('../config')).rejects.toThrow(missing);
  });

  it.each(REQUIRED)('throws when %s is set but blank', async (blank) => {
    // A variable left empty in a dashboard is a variable someone meant to fill
    // in. Treating '' as present is the same silent-wrong-value failure as a
    // fallback, one step further along.
    process.env[blank] = '   ';
    await expect(import('../config')).rejects.toThrow(blank);
  });

  it('loads cleanly when every variable is present', async () => {
    const { dodoConfig } = await import('../config');
    expect(dodoConfig.apiKey).toBe('dodo_test_key');
    expect(dodoConfig.webhookSecret).toBe('whsec_dGVzdHNlY3JldA==');
    expect(dodoConfig.environment).toBe('test_mode');
  });

  it('does not substitute a default for a missing value', async () => {
    delete process.env.DODO_PAYMENTS_API_KEY;
    // The distinction that matters: it must FAIL, not resolve to something.
    await expect(import('../config')).rejects.toThrow(/no fallback/i);
  });
});

describe('the environment is validated to exactly two values', () => {
  it('accepts live_mode now that the live catalogue exists', async () => {
    // Until 2026-08-13 live_mode was refused outright because the live products
    // did not exist. They do now, verified against the live API, and
    // catalogue.ts selects them off this validated value — so live_mode is a
    // permitted, explicit choice rather than a stop condition.
    process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
    const { dodoConfig } = await import('../config');
    expect(dodoConfig.environment).toBe('live_mode');
  });

  it('still throws on any value that is neither test_mode nor live_mode', async () => {
    // Accepting live_mode must not have widened the gate: a typo or a
    // Stripe-flavoured value ("production") is still a broken deploy, never a
    // guess at which catalogue was meant.
    process.env.DODO_PAYMENTS_ENVIRONMENT = 'production';
    await expect(import('../config')).rejects.toThrow(/test_mode/);
    await expect(import('../config')).rejects.toThrow(/live_mode/);
  });
});

describe('the config source contains no fallback of any kind', () => {
  it('has no ?? and no || defaulting on an env read', () => {
    const source = readFileSync(resolve(__dirname, '../config.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    // `??` anywhere in this module would be a default for something that must be
    // required. This is the mechanical form of the rule the prose states.
    expect(source).not.toContain('??');
    expect(source).not.toMatch(/process\.env\[[^\]]+\]\s*\|\|/);
    expect(source).not.toMatch(/process\.env\.\w+\s*\|\|/);
  });
});
