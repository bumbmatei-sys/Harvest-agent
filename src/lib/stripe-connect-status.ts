import type Stripe from 'stripe';

export type ConnectStatus = 'pending' | 'active' | 'restricted';

/**
 * Derive a tenant's Stripe Connect status from a Stripe Account object.
 *
 * Shared by BOTH the Connect onboarding callback
 * (src/app/api/stripe/connect/callback) and the account.updated webhook
 * (src/app/api/stripe/connect/webhook) so the two code paths can never disagree
 * about what "active"/"restricted" mean. Keep this the single source of truth —
 * do not inline a copy in either route.
 *
 * ⚠️ ACCOUNT-TYPE AGNOSTIC, and verified so when churches moved to STANDARD
 * accounts (THE-145 PR 2). `charges_enabled`, `payouts_enabled` and
 * `requirements.currently_due` are plain Account fields that Stripe populates
 * for Standard, Express and Custom alike — Stripe's own Standard guide tells
 * platforms to read `charges_enabled` to decide whether onboarding finished.
 * Nothing here reads `account.type`, and nothing here should start: the tenant's
 * `stripeConnectStatus` gates the donate page, and a derivation that classified
 * one account type differently from another would silently close a church's
 * giving page.
 *
 *   - active:     charges AND payouts are enabled → payout-ready
 *   - restricted: Stripe currently requires more info (`currently_due` non-empty)
 *   - pending:    neither of the above → onboarding not finished
 */
export function deriveConnectStatus(account: Stripe.Account): ConnectStatus {
  if (account.charges_enabled && account.payouts_enabled) return 'active';
  if (account.requirements?.currently_due?.length) return 'restricted';
  return 'pending';
}
