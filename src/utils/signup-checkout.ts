import { DODO_BILLING_ENABLED } from './plan-features';

/**
 * Where new-ministry signup posts to start a checkout.
 *
 * 🔴 THE CUTOVER, IN ONE PLACE. `ChurchOnboarding` (first attempt) and
 * `OnboardingGate` (the "Complete your payment" restart after an abandoned
 * checkout) are BOTH signup, and both have to move together or the rollback is
 * partial: a user who closed the payment tab would be sent to the other
 * processor from the one that issued their first session, and could end up
 * paying twice or paying into a path that no longer provisions.
 *
 * Existing-tenant plan changes (`PlanUpgradeSection`, `AdminUpgradePage`) do NOT
 * use this — they modify a live Stripe subscription and stay on Stripe until
 * REP-4 PR 6 retires that path.
 *
 * Flipping `DODO_BILLING_ENABLED` back to false returns both call sites to
 * Stripe with no other edit, and `/api/dodo/checkout` refuses independently, so
 * a stale browser tab holding the old bundle cannot keep the Dodo path open.
 */
export const SIGNUP_CHECKOUT_ENDPOINT = DODO_BILLING_ENABLED
  ? '/api/dodo/checkout'
  : '/api/stripe/checkout';

/**
 * The query flag the processor appends when it sends a payer back to the app.
 *
 * `OnboardingGate` reads BOTH spellings rather than only the current one: a
 * customer who was mid-checkout when the flag was flipped returns carrying the
 * OTHER processor's marker, and the gate must still recognise them as
 * "definitely paid". Getting this wrong shows a paying customer the "Complete
 * your payment" button — i.e. invites a double charge.
 */
export const CHECKOUT_RETURN_FLAGS = ['stripe', 'dodo'] as const;

/** True when the current URL says the user has just come back from paying. */
export function isReturningFromCheckout(search: string): boolean {
  const params = new URLSearchParams(search);
  return CHECKOUT_RETURN_FLAGS.some((flag) => params.get(flag) === 'success');
}
