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
 *   - active:     charges AND payouts are enabled → payout-ready
 *   - restricted: Stripe currently requires more info (`currently_due` non-empty)
 *   - pending:    neither of the above → onboarding not finished
 */
export function deriveConnectStatus(account: Stripe.Account): ConnectStatus {
  if (account.charges_enabled && account.payouts_enabled) return 'active';
  if (account.requirements?.currently_due?.length) return 'restricted';
  return 'pending';
}
