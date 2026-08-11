/**
 * Giving does not move. `stripe-connect.ts` is untouched by the Dodo work, and a
 * donation still computes a 0% platform fee on every tier.
 *
 * The two money paths are deliberately split: subscriptions are Harvest's own
 * revenue and are migrating to a merchant of record; donations and paid tickets
 * are destination charges into each church's OWN Stripe account, where Harvest
 * is only the platform taking an application fee of nothing. That relationship
 * is a per-tenant onboarding into one specific processor — it is not swappable,
 * and no Dodo PR may reach into it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORM_FEE_MAP } from '@/lib/stripe-connect';
import { PLAN_ORDER } from '@/utils/plan-features';

const STRIPE_CONNECT = path.resolve(__dirname, '../../stripe-connect.ts');

/** What the donation and ticket paths do with the rate: cents in, fee cents out. */
function applicationFeeCents(plan: string, amountCents: number): number {
  return Math.round(amountCents * (PLATFORM_FEE_MAP[plan] ?? 0));
}

describe('a donation still keeps 100%', () => {
  it.each(PLAN_ORDER)('charges a 0%% platform fee on %s', (plan) => {
    expect(PLATFORM_FEE_MAP[plan]).toBe(0);
  });

  it('takes nothing out of a $100 gift on any tier', () => {
    for (const plan of PLAN_ORDER) {
      expect(applicationFeeCents(plan, 10_000)).toBe(0);
    }
  });

  it('takes nothing out of a gift on an unknown plan either', () => {
    expect(applicationFeeCents('some-future-tier', 10_000)).toBe(0);
  });
});

describe('stripe-connect.ts is untouched by the Dodo migration', () => {
  const source = readFileSync(STRIPE_CONNECT, 'utf8');

  it('names no other processor', () => {
    expect(source).not.toMatch(/dodo/i);
  });

  it('still exports the single fee map, and only that', () => {
    expect(source).toMatch(/export const PLATFORM_FEE_MAP/);
    // One export: the rate. Nothing here grew a provider interface — donations
    // are not swappable and a second abstraction layer over them is not wanted.
    expect(source.match(/^export /gm)).toHaveLength(1);
  });

  it('does not import the billing seam', () => {
    expect(source).not.toMatch(/billing-provider|lib\/dodo/);
  });
});
