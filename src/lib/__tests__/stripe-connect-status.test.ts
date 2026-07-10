import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { deriveConnectStatus } from '../stripe-connect-status';

// Minimal Account shape — only the fields the helper reads.
function account(partial: Partial<Stripe.Account>): Stripe.Account {
  return partial as Stripe.Account;
}

describe('deriveConnectStatus', () => {
  it('returns active when charges AND payouts are enabled', () => {
    expect(deriveConnectStatus(account({ charges_enabled: true, payouts_enabled: true }))).toBe('active');
  });

  it('returns restricted when currently_due is non-empty and not payout-ready', () => {
    expect(
      deriveConnectStatus(account({
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { currently_due: ['external_account'] } as Stripe.Account.Requirements,
      })),
    ).toBe('restricted');
  });

  it('returns pending when neither payout-ready nor requirements are due', () => {
    expect(
      deriveConnectStatus(account({
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { currently_due: [] } as Stripe.Account.Requirements,
      })),
    ).toBe('pending');
  });

  it('active takes precedence even if requirements are still listed', () => {
    // Payout-ready wins: charges+payouts enabled → active regardless of currently_due.
    expect(
      deriveConnectStatus(account({
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: ['some_future_requirement'] } as Stripe.Account.Requirements,
      })),
    ).toBe('active');
  });

  it('returns pending when only one of charges/payouts is enabled', () => {
    expect(deriveConnectStatus(account({ charges_enabled: true, payouts_enabled: false }))).toBe('pending');
    expect(deriveConnectStatus(account({ charges_enabled: false, payouts_enabled: true }))).toBe('pending');
  });
});
