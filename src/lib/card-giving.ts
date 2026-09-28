import { STRIPE_CONNECT_ENABLED } from '@/lib/stripe-connect-feature';

/**
 * Whether a card form may be drawn.
 *
 * The same expression as `hasStripeGiving` in MainApp.tsx:255:
 * `STRIPE_CONNECT_ENABLED && (isMainSite || stripeConnectStatus === 'active')`.
 * Only 'active' counts as a connected account. The public campaign page has
 * no main-site short-circuit and passes `isMainSite: false`, which leaves
 * the switch and the tenant's own status as the whole of the gate.
 */
export function isCardGivingOn(input: {
  isMainSite: boolean;
  stripeConnectStatus?: string | null;
}): boolean {
  return STRIPE_CONNECT_ENABLED && (input.isMainSite || input.stripeConnectStatus === 'active');
}
