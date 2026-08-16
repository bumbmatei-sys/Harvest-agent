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
 * THE-138 part 2 — how "the confirmation was already given" CROSSES the origin.
 *
 * 🔴 WHY A SECOND MECHANISM EXISTS AT ALL. Everything above lives in
 * sessionStorage, which is per-origin. That is exactly right for HOLDING the
 * hop — the hold is a fact about one origin, decided and consumed there. It
 * cannot work for REMEMBERING the hop was announced, because that fact has to
 * survive crossing the very boundary the storage is scoped to. `SEEN` is
 * written on the apex; `<tenant>.theharvest.app` is a different origin and
 * simply does not have it. So the destination could not tell an announced
 * arrival from an unannounced one, and #298's post-first-run confirmation
 * fired again — the church saw "Your payment went through." twice.
 *
 * The hop itself is a full URL assignment (an `<a href>` out of the
 * confirmation, or `window.location.href` in App.tsx's callback), so a query
 * parameter DOES survive it — unlike the in-app `navigate()` that #310 had to
 * build a sessionStorage lane around.
 *
 * ⚠️ THIS PARAMETER IS USER-WRITABLE AND IS TREATED AS A HINT, NOTHING MORE.
 * Its entire power is to SUPPRESS ONE REASSURANCE SCREEN. It grants no access,
 * carries no identity, names no tenant, is never read as authorisation, and is
 * not consulted by any gate, role check or route. Forging it costs the forger a
 * screen they were welcome to skip and gets them nothing else — every door in
 * this app is still Firebase auth, the gate's own status machine and the
 * Firestore rules. If this value ever needs to be trusted for anything beyond
 * hiding a screen, it is the wrong mechanism and must be replaced, not widened.
 */
export const PAYMENT_CONFIRMATION_HANDOFF_PARAM = 'payment_confirmed';

/**
 * The one value the parameter is honoured for.
 *
 * Compared exactly rather than tested for presence, so a stray
 * `?payment_confirmed=` (an empty value is what a mangled URL usually produces)
 * fails CLOSED — i.e. shows the confirmation — which is the direction this
 * whole module fails in: a duplicate is annoying, a missing confirmation after
 * a charge is what produces a chargeback.
 */
const PAYMENT_CONFIRMATION_HANDOFF_VALUE = '1';

/**
 * The destination URL, carrying the acknowledgement across the origin hop.
 *
 * Called only where the confirmation demonstrably HAS been given: the action on
 * the screen itself (the payer is clicking through it right now) and the
 * resumed hop in App.tsx's callback (`SEEN` is set, which only
 * `completePaymentConfirmation` can do). Never called speculatively — a church
 * that has not seen the screen must arrive without this, or the destination
 * suppresses a confirmation it never gave.
 */
export function withPaymentConfirmationHandoff(destination: string): string {
  const separator = destination.includes('?') ? '&' : '?';
  return `${destination}${separator}${PAYMENT_CONFIRMATION_HANDOFF_PARAM}=${PAYMENT_CONFIRMATION_HANDOFF_VALUE}`;
}

/**
 * Land the hint in the DESTINATION origin's own storage, on arrival.
 *
 * 🔴 WHY IT IS NOT SIMPLY READ OFF THE URL WHERE IT MATTERS. The church arrives
 * at `<tenant>.theharvest.app/admin?…` NOT signed in on that origin, so
 * App.tsx's callback immediately does `navigate('/auth')` — a react-router
 * navigation, which DROPS THE QUERY STRING (the same drop #310's lane exists to
 * survive). By the time first-run setup finishes, minutes and one sign-in
 * later, the parameter is long gone. Capturing it into this origin's
 * sessionStorage the moment the document loads is what makes it outlive that,
 * and a refresh mid-setup with it.
 *
 * It writes the SAME key the apex writes, because it is the same fact —
 * "this browser has been shown, and acknowledged, the payment confirmation".
 * `hasSeenPaymentConfirmation()` then answers correctly on BOTH origins with no
 * second vocabulary.
 *
 * ⚠️ Only on a tenant subdomain, and the caller resolves that with the SHARED
 * host resolver rather than this module parsing a hostname (a fifth inline
 * parse is how the four existing ones drift apart). The hint is an INBOUND
 * signal for a destination: the apex is where this fact is created, never
 * imported. Scoping it that way means a forged parameter on the apex cannot
 * suppress the apex confirmation, and keeps `SEEN` on the apex meaning strictly
 * "the payer clicked through the screen" — which is what App.tsx's resumed hop
 * relies on when it decides whether to carry the hint onward.
 *
 * ⚠️ Writes no tenant state, exactly like everything else here.
 */
export function capturePaymentConfirmationHandoff(args: {
  search: string;
  hostTenantId: string | null;
}): void {
  if (args.hostTenantId === null) return;
  const params = new URLSearchParams(args.search);
  if (params.get(PAYMENT_CONFIRMATION_HANDOFF_PARAM) !== PAYMENT_CONFIRMATION_HANDOFF_VALUE) return;
  try {
    sessionStorage.setItem(PAYMENT_CONFIRMATION_SEEN_KEY, 'true');
  } catch {
    // Storage unavailable → the destination falls back to showing the
    // confirmation once more, which is the safe direction.
  }
}

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
