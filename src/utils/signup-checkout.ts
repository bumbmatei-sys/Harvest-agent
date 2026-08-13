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
 * THE-130: one quiet line shown beside both "Continue to payment" actions.
 *
 * The processor's hosted checkout offers wallet buttons (Google Pay etc.) whose
 * pop-up some browsers block — a failure that happens on a page Harvest does
 * not own and cannot annotate. The screen immediately before the handoff is the
 * only surface we control, so it is where a church learns that entering a card
 * is the dependable route. Shared for the same reason as
 * `SIGNUP_CHECKOUT_ENDPOINT` above: `ChurchOnboarding` and `OnboardingGate` are
 * both signup, and the two copies must not drift.
 */
export const WALLET_FALLBACK_LINE =
  "If a wallet option such as Google Pay doesn't load on the payment page, you can pay by card instead.";

/**
 * Billing cadence for a signup, in the app's own vocabulary.
 *
 * Structurally identical to `BillingPeriod` in `src/lib/dodo/provider.ts`, and
 * deliberately NOT imported from there: client components may not import the
 * Dodo module (`dodo-billing-flag.test.ts` pins that boundary), and the period
 * is processor-neutral anyway — the Stripe signup route reads the same two
 * words. A test pins the two types mutually assignable so they cannot drift.
 */
export type SignupBillingPeriod = 'monthly' | 'yearly';

/**
 * Validate an untrusted billing period — `?billing=` from a URL, or the
 * `signupBilling` marker read back off the user doc — failing CLOSED to
 * 'monthly'.
 *
 * 🔴 An unrecognised value must never travel onward: the Dodo catalogue has no
 * fallback by design, so a bad period reaching a product lookup is a hole this
 * validator exists to close. 'monthly' is the safe floor because a signup
 * carrying no period is exactly the signup the app sold before annual existed.
 */
export function readSignupBillingPeriod(raw: unknown): SignupBillingPeriod {
  return raw === 'monthly' || raw === 'yearly' ? raw : 'monthly';
}

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
