import { isReturningFromCheckout } from './signup-checkout';

/**
 * THE-138 — the confirmation belongs on the origin that took the payment.
 *
 * 🔴 THE ORDERING THIS FIXES. `/api/dodo/checkout` deliberately returns the
 * payer to the SAME origin they signed up on (`checkout/route.ts:104-108`) so
 * their Firebase session survives the round trip — and it does. What happens
 * next is the problem: once the webhook has written `onboardingCompleted: true`
 * and `role: 'admin'`, App.tsx's auth callback hard-redirects apex →
 * `<tenant>.theharvest.app`. Those are DIFFERENT ORIGINS and Firebase persists
 * auth in origin-scoped storage, so the church is asked to sign in again, does
 * first-run setup over there, and only then reaches "Your payment went
 * through." — in its same-origin variant, on the far side of the boundary.
 *
 * The only moment the session still exists is BEFORE the hop. That is where the
 * confirmation has to render, so this module is the hold on it:
 *
 *   App.tsx  — would redirect → asks `shouldConfirmPaymentBeforeHandoff()` →
 *              `beginPaymentConfirmation(tenantId)` instead of navigating
 *   the gate — sees the pending hold and paints `WorkspaceHandoff` on THIS
 *              origin, in its (now honest) cross-origin variant
 *   the payer — reads it, clicks through, `completePaymentConfirmation()`
 *
 * ⚠️ The redirect is NOT removed and must not be: `FUNNEL_PATHS` and
 * `resolvePostAuthFunnelRoute` depend on it, and a church whose confirmation is
 * already acknowledged still needs to reach its own subdomain. This gates it for
 * one arrival and then gets out of the way.
 *
 * ⚠️ This does NOT try to carry the session across origins. Doing that needs a
 * custom-token handoff and is its own decision; the second sign-in stays, and
 * the point of the screen is that the church is told about it beforehand.
 */

/**
 * The tenant id of a subdomain hop currently being held back, i.e. "the payer is
 * owed a confirmation before they leave this origin".
 *
 * sessionStorage rather than component state ON PURPOSE: a refresh mid-screen
 * must show the confirmation again rather than race App.tsx's callback into
 * performing the hop the church has not yet been told about. Per-origin and
 * per-tab, which matches the boundary this whole module is about.
 */
export const PAYMENT_CONFIRMATION_PENDING_KEY = 'harvest_payment_confirmation';

/**
 * Set once the payer has actually acknowledged the confirmation (they clicked
 * through to their workspace). From then on the hop is theirs to make and the
 * redirect resumes exactly as it did before — the gate is one-shot, not a
 * permanent diversion.
 */
export const PAYMENT_CONFIRMATION_SEEN_KEY = 'harvest_payment_confirmation_seen';

/**
 * How App.tsx tells the gate it has held a hop.
 *
 * The decision is made inside an async auth callback, long after the gate has
 * mounted, and the two components share no state — a DOM event on `window` is
 * the smallest thing that carries "hold, and here is the tenant" without
 * threading a new store or context through the tree. The gate re-reads
 * sessionStorage on mount too, so a refresh needs no event at all.
 */
export const PAYMENT_CONFIRMATION_EVENT = 'harvest:payment-confirmation';

/**
 * Is this arrival a return from the payment processor?
 *
 * Delegates to `isReturningFromCheckout` rather than re-reading the query, so
 * `?dodo=success` and `?stripe=success` are recognised here EXACTLY as the gate
 * recognises them (`checkout/route.ts:106` states that equivalence, and a
 * customer mid-checkout when the processor flag flipped comes back carrying the
 * other spelling). A second opinion about what "just paid" means is how a payer
 * ends up held on one code path and redirected on the other.
 */
export function isPaidArrival(search: string): boolean {
  return isReturningFromCheckout(search);
}

/** Has the payer already been shown, and acknowledged, the confirmation? */
export function hasSeenPaymentConfirmation(): boolean {
  try {
    return sessionStorage.getItem(PAYMENT_CONFIRMATION_SEEN_KEY) === 'true';
  } catch {
    // Storage unavailable → treat it as "not seen". Failing this way shows the
    // screen once more; failing the other way teleports a church that has just
    // been charged into an unexplained login prompt.
    return false;
  }
}

/**
 * Should the apex → subdomain hop wait for the payment confirmation?
 *
 * Three conditions, all necessary:
 *  - the URL says they are back from checkout right now;
 *  - the tenant they would be sent to is still in first-run (`setupCompleted:
 *    false`, written by the provisioning webhook and flipped to true by
 *    `/api/tenants/finish-setup`), so this is genuinely a just-provisioned
 *    church and not an established one arriving with a stale success URL;
 *  - they have not already acknowledged the confirmation in this tab.
 *
 * Everyone else — including every arrival that did not just pay — falls through
 * to the redirect untouched.
 */
export function shouldConfirmPaymentBeforeHandoff(args: {
  search: string;
  tenantSetupCompleted: unknown;
}): boolean {
  return (
    isPaidArrival(args.search) &&
    args.tenantSetupCompleted === false &&
    !hasSeenPaymentConfirmation()
  );
}

/**
 * Hold the hop and tell the gate to paint the confirmation for `tenantId`.
 *
 * ⚠️ Writes no tenant state of any kind. The webhook is the single writer of
 * `plan` and `onboardingCompleted`; this is a per-tab note about what the
 * BROWSER should show next, and nothing else.
 */
export function beginPaymentConfirmation(tenantId: string): void {
  try { sessionStorage.setItem(PAYMENT_CONFIRMATION_PENDING_KEY, tenantId); } catch { /* screen still renders via the event */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PAYMENT_CONFIRMATION_EVENT, { detail: tenantId }));
  }
}

/**
 * The tenant id whose confirmation is owed on this arrival, or null.
 *
 * Scoped to the paid arrival itself: a pending note left over from an earlier
 * screen in the same tab must not paint "Payment received" over an ordinary
 * page the church later navigates to.
 */
export function readPendingPaymentConfirmation(search: string): string | null {
  if (!isPaidArrival(search)) return null;
  if (hasSeenPaymentConfirmation()) return null;
  try {
    return sessionStorage.getItem(PAYMENT_CONFIRMATION_PENDING_KEY);
  } catch {
    return null;
  }
}

/**
 * The payer read it and is on their way. Release the hold — from here the
 * subdomain redirect behaves exactly as it always did.
 */
export function completePaymentConfirmation(): void {
  try {
    sessionStorage.setItem(PAYMENT_CONFIRMATION_SEEN_KEY, 'true');
    sessionStorage.removeItem(PAYMENT_CONFIRMATION_PENDING_KEY);
  } catch { /* the navigation still happens; the hold simply expires with the tab */ }
}
