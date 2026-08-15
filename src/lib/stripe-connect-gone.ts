import type Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { tenantPrivateRef } from '@/lib/tenant-private';

/**
 * THE-148 — telling "this connected account is GONE" apart from "Stripe is
 * having a moment".
 *
 * ─── 🔴 WHY THIS IS ITS OWN MODULE AND NOT AN `if` IN A CATCH ────────────────
 *
 * A church closed its Stripe account. `tenant_private.stripeConnectAccountId`
 * still pointed at it, so `/api/stripe/connect/login-link` retrieved a dead id,
 * the generic catch turned the 404 into a 500 reading "Failed to open your
 * Stripe dashboard", and the church was told to try again — forever. The failure
 * is not transient and no amount of retrying fixes it; recovery took a manual
 * Firestore edit, which no customer can perform.
 *
 * The fix is one distinction, and the whole risk of the fix lives in how that
 * distinction is drawn:
 *
 *   - Draw it too NARROW and the church stays stuck. Merely bad.
 *   - Draw it too WIDE and a network blip, an expired key or a rate limit tells
 *     a church its Stripe account is gone and offers to re-onboard it. 🔴 That
 *     invites a working church to abandon a live account because Stripe was
 *     briefly slow — and re-onboarding mints a NEW account, so the money starts
 *     landing somewhere else.
 *
 * So the distinction is drawn here, once, against Stripe's STRUCTURED fields
 * only, and both callers of a "gone" answer share it. It is deliberately biased
 * toward the narrow side: anything this module does not positively recognise
 * falls through to the caller's generic 500, which says try again.
 *
 * ⚠️ NOT A MESSAGE-STRING MATCH, on purpose. Stripe's prose ("No such
 * account: acct_…") is not part of its API contract, is localised and
 * reworded without notice, and quoting it back would also drag a server-only
 * account id toward a response body. Every signal below is a typed field.
 */

/**
 * The `reason` handed back when the stored account no longer exists or has been
 * rejected. Distinct from `not_connected` (never had one) and
 * `onboarding_incomplete` (has one, unfinished) because the remedy differs: this
 * church HAD a working account and has to be offered a fresh one.
 */
export const CONNECT_ACCOUNT_GONE_REASON = 'account_gone';

/**
 * The Stripe step this module is observed under.
 */
export const CONNECT_ACCOUNT_GONE_STEP = 'stripe-connect-account-gone';

/**
 * ─── SIGNAL 1: the account does not exist ────────────────────────────────────
 *
 * `stripe.accounts.retrieve()` is typed `Promise<Response<Account>>` — it has no
 * deleted-object return, unlike `accounts.del()` which resolves to
 * `DeletedAccount`. A closed account therefore CANNOT come back as an object; it
 * can only throw. What it throws is an `invalid_request_error` carrying one of
 * two codes from Stripe's canonical error-code enum:
 *
 *   - `resource_missing` — the id names no such resource (HTTP 404). This is
 *     what a deleted connected account produces, and `accounts.retrieve` names
 *     exactly one resource, so the code cannot be about some other object in the
 *     request.
 *   - `account_invalid`  — the connected-account id is not one this platform may
 *     act on. Also permanent, and also not something a retry resolves.
 *
 * 🔴 EVERY OTHER FAILURE IS EXCLUDED BY CONSTRUCTION, because it carries a
 * different `type`, not merely a different message:
 *
 *   - a network blip / TLS failure → `StripeConnectionError`, no `type` at all
 *   - a bad or expired platform key → `authentication_error`
 *   - a rate limit                 → `rate_limit_error`
 *   - a Stripe-side outage         → `api_error`
 *   - a permissions refusal        → `invalid_request_error` with a DIFFERENT
 *     code, which this predicate does not accept
 *
 * ⚠️ Duck-typed rather than `instanceof Stripe.errors.*`: an error crossing a
 * module or realm boundary loses its prototype, and a money path must not start
 * treating a permanent failure as transient because of how a bundler resolved a
 * class. The fields are read positively — an object that is not shaped like a
 * Stripe error at all returns false and gets the generic 500.
 */
export function isMissingConnectAccountError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { type, code } = error as { type?: unknown; code?: unknown };
  // Both accepted codes are `invalid_request_error` codes. Requiring the type as
  // well means a look-alike object carrying only a `code` cannot pass.
  if (type !== 'invalid_request_error') return false;
  return code === 'resource_missing' || code === 'account_invalid';
}

/**
 * ─── SIGNAL 2: the account exists and Stripe has rejected it ─────────────────
 *
 * A rejected account still retrieves — there is an Account object, so no error
 * is thrown and signal 1 never fires. Stripe records the rejection on the object
 * itself: charges are off, and `requirements.disabled_reason` ("If the account
 * is disabled, this enum describes why") carries a value in the `rejected.`
 * namespace. The enum's members today are `rejected.fraud`,
 * `rejected.incomplete_verification`, `rejected.listed`, `rejected.other`,
 * `rejected.platform_fraud`, `rejected.platform_other`,
 * `rejected.platform_terms_of_service` and `rejected.terms_of_service`.
 *
 * The prefix is matched rather than the eight members enumerated, because the
 * namespace IS the contract: Stripe adds rejection reasons over time and a
 * hard-coded list would silently start reporting a newly-named rejection as a
 * transient failure. This is not a message match — `disabled_reason` is a typed
 * enum field, and the prefix is part of the enum's own naming.
 *
 * ⚠️ EVERY OTHER `disabled_reason` IS DELIBERATELY EXCLUDED. `under_review` and
 * `platform_paused` are temporary states an account comes back from;
 * `requirements.past_due` and `requirements.pending_verification` are the
 * ordinary RESTRICTED church that still has a real dashboard with real money in
 * it. Sending any of those through re-onboarding would be the wide-draw failure
 * this module exists to avoid.
 *
 * ⚠️ `charges_enabled` is required as well, so the predicate needs the account to
 * be BOTH disabled and disabled *for a rejection*. One field can be stale in a
 * payload; two agreeing is a state.
 */
export function isRejectedConnectAccount(account: Stripe.Account): boolean {
  if (account.charges_enabled) return false;
  const disabledReason = account.requirements?.disabled_reason;
  return typeof disabledReason === 'string' && disabledReason.startsWith('rejected.');
}

/**
 * Forget a connected account that is gone.
 *
 * ─── 🔴 WHICH FIELD IS AUTHORITATIVE, AND WHY IT MATTERS HERE ────────────────
 *
 * `tenant_private.stripeConnectAccountId` is. It is the field `/api/stripe/donate`
 * reads to decide whether a gift can be taken at all, and the account every
 * direct charge is scoped to — a donation is possible exactly when that id names
 * a live account, and impossible otherwise. `tenants.stripeConnectStatus` is a
 * PROJECTION of that account's health onto the world-readable doc, derived by
 * `deriveConnectStatus` and read by the settings screen to pick which button to
 * show. It answers "how healthy is the account", which is only a meaningful
 * question once the id answers "which account".
 *
 * ⚠️ WHICH IS WHY BOTH MOVE IN ONE BATCH. THE-149 is what happens when two
 * fields describe one fact and are written separately: the world-readable doc
 * said `active` while there was no account to receive anything, and the app
 * reported that giving worked. A single batched write means the derived field
 * cannot outlive the fact it derives from, in either direction.
 *
 * ⚠️ THE ID IS DELETED, NOT LEFT IN PLACE. Leaving it would keep the church
 * stuck by a second route: `/api/stripe/connect` short-circuits on an existing
 * id and calls `accountLinks.create` against it, which fails for a dead account
 * exactly as `accounts.retrieve` did — so the church would be offered
 * re-onboarding and then refused it. Clearing the id sends that route down its
 * create-a-new-Standard-account branch, which is the recovery.
 *
 * ⚠️ THE STATUS IS DELETED RATHER THAN DOWNGRADED to 'pending'. `PaymentSection`
 * renders "Complete Onboarding" for 'pending' and "Connect Stripe Account" when
 * the field is absent. There is nothing left to complete, so the honest control
 * is Connect.
 *
 * ⚠️ THE AFFILIATE MIRROR IS NOT TOUCHED. Affiliate payouts resolve
 * `users/{uid}.affiliateStripeAccountId` — a different field on a different
 * document, written only by `/api/stripe/connect` and `/api/affiliate/onboard`.
 * This function does not read or write the users collection, and the affiliate
 * status mirror stays owned by `account.updated`. Repointing a payout account is
 * the affiliate payout model's business, not this route's.
 */
export async function forgetGoneConnectAccount(tenantId: string): Promise<void> {
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  batch.update(adminDb.collection('tenants').doc(tenantId), {
    stripeConnectStatus: FieldValue.delete(),
    updatedAt: now,
  });
  batch.set(
    tenantPrivateRef(tenantId),
    { stripeConnectAccountId: FieldValue.delete(), updatedAt: now },
    { merge: true },
  );
  await batch.commit();
}
