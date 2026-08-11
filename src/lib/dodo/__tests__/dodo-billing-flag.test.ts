/**
 * `DODO_BILLING_ENABLED` is `false`, and NOTHING in production code reads it.
 *
 * This is the proof that shipping the Dodo module changed nothing a customer can
 * see. The first assertion is the flag's value; the second is the stronger one —
 * that no component, route or library branches on it — because a flag that is
 * `false` but read somewhere is one boolean away from a live payment processor,
 * and this PR's whole claim is that the cutover is still a separate, deliberate
 * change.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DODO_BILLING_ENABLED } from '@/utils/plan-features';

const SRC = path.resolve(__dirname, '../../..');
const FLAG = 'DODO_BILLING_ENABLED';

/** Where the flag is legitimately allowed to appear. */
const DEFINITION = path.join(SRC, 'utils', 'plan-features.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

const isTestFile = (file: string) =>
  file.includes(`${path.sep}__tests__${path.sep}`) || /\.test\.tsx?$/.test(file);

describe('DODO_BILLING_ENABLED', () => {
  it('is false', () => {
    expect(DODO_BILLING_ENABLED).toBe(false);
  });

  it('is read by NO production code path — the cutover is still one deliberate line away', () => {
    const readers = walk(SRC)
      .filter((file) => !isTestFile(file))
      .filter((file) => file !== DEFINITION)
      .filter((file) => readFileSync(file, 'utf8').includes(FLAG))
      .map((file) => path.relative(SRC, file));

    expect(readers).toEqual([]);
  });

  it('is declared alongside the app’s other master switches', () => {
    // Same file, same shape as AI_TELEGRAM_ASSISTANT_ENABLED and
    // AFFILIATE_PROGRAM_ENABLED, so there is one place to look for "what is off".
    const source = readFileSync(DEFINITION, 'utf8');
    expect(source).toMatch(/export const DODO_BILLING_ENABLED = false;/);
    expect(source).toMatch(/export const AI_TELEGRAM_ASSISTANT_ENABLED = false;/);
    expect(source).toMatch(/export const AFFILIATE_PROGRAM_ENABLED = false;/);
  });
});

describe('signup still goes through Stripe', () => {
  it('ChurchOnboarding posts to the Stripe checkout route, unchanged', () => {
    const onboarding = readFileSync(path.join(SRC, 'components', 'ChurchOnboarding.tsx'), 'utf8');
    expect(onboarding).toContain("'/api/stripe/checkout'");
    expect(onboarding).not.toMatch(/dodo/i);
  });

  it('the Stripe subscription webhook is still the only thing that creates a tenant', () => {
    const dodoRoute = readFileSync(
      path.join(SRC, 'app', 'api', 'dodo', 'webhook', 'route.ts'),
      'utf8',
    );
    // Tenant provisioning is the riskiest change in the migration and gets its
    // own PR. Nothing in the Dodo endpoint may create one.
    expect(dodoRoute).not.toMatch(/collection\(['"]tenants['"]\)/);
    expect(dodoRoute).not.toMatch(/setCustomClaims/);
  });
});
