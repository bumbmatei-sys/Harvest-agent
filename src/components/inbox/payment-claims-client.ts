import { authFetch } from '@/utils/auth-fetch';
import type { InboxItem } from '@/lib/event-payment-claims';

/**
 * THE-351 — the browser half of the payment-claim routes, in ONE module.
 *
 * 🔴 THERE ARE TWO SURFACES THAT CONFIRM AND THERE MUST BE ONE CALL. The inbox
 * is where an admin is PROMPTED; the event's attendee list is where they are
 * already standing when they notice an unconfirmed row (and the only surface
 * that reaches a member who registered logged-out and can therefore never press
 * "I've paid" themselves). Both press the same button and both must reach the
 * same idempotent route — a second `fetch` written inline in the second screen
 * is how the two drift into disagreeing about what a confirmation is.
 *
 * ⚠️ NOTHING HERE CATCHES. A failed confirmation must surface VISIBLY and must
 * not mark the ticket paid, so a rejection is thrown for the caller's own
 * `saveState` machine to render. Swallowing it into `{ ok: false }` that a
 * caller might ignore is the silent failure THE-342 named.
 */

export interface InboxPayload {
  items: InboxItem[];
  /** How many rows came back. */
  count: number;
  /** 🔴 False when the read hit its ceiling — the badge must say so. */
  exact: boolean;
}

/**
 * 🔴 HOW LONG ONE READ SERVES, AND WHY THERE IS A CACHE AT ALL.
 *
 * ⚠️ THE BADGE IS ON EVERY ADMIN SCREEN, AND THE ADMIN SHELL REMOUNTS ON EVERY
 * NAVIGATION. Read naively, that is one API call per screen the admin opens —
 * and THE-139 is the card about exactly this: "the cost of a session does not
 * grow with navigation", asserted by mounting the shell seven times and
 * counting. A per-mount inbox read would have re-introduced that defect for a
 * figure that changes when a member presses a button, i.e. rarely.
 *
 * So one read serves every mount for this long. `roster-cache.ts` answers the
 * same question the same way for the roster.
 *
 * ⚠️ IT IS NOT A CORRECTNESS COMPROMISE. The cache is INVALIDATED the moment
 * anything can have changed it — {@link confirmPaymentClaim} clears it on the
 * way out — and opening the sheet forces a fresh read, so the list an admin is
 * actually working from is never cached. What ages is the BADGE, by at most
 * this long, on a queue whose items arrive at human speed.
 */
export const INBOX_CACHE_TTL_MS = 120_000;

/** Per-tenant, in-memory. Not sessionStorage: a stale count must not outlive the tab. */
const inboxCache = new Map<string, { at: number; payload: InboxPayload }>();

/** Drop the cached count for a tenant — called wherever the queue can have moved. */
export function invalidatePaymentInbox(tenantId?: string): void {
  if (tenantId) inboxCache.delete(tenantId);
  else inboxCache.clear();
}

/**
 * Read the tenant's pending payment claims, oldest first. THROWS on failure.
 *
 * `force` skips the cache — what the sheet passes when it opens, and what a
 * confirmation passes when it refreshes.
 */
export async function fetchPaymentInbox(tenantId: string, force = false): Promise<InboxPayload> {
  const hit = inboxCache.get(tenantId);
  if (!force && hit && Date.now() - hit.at < INBOX_CACHE_TTL_MS) return hit.payload;

  const res = await authFetch(`/api/event-payment/inbox?tenantId=${encodeURIComponent(tenantId)}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    // 🔴 A FAILED READ IS NOT CACHED. Caching it would paint an empty inbox
    // over a church with people waiting for the whole TTL.
    throw new Error(detail.error || 'The inbox could not be read.');
  }
  const data = await res.json();
  const payload: InboxPayload = {
    items: Array.isArray(data.items) ? data.items : [],
    count: typeof data.count === 'number' ? data.count : 0,
    exact: data.exact !== false,
  };
  inboxCache.set(tenantId, { at: Date.now(), payload });
  return payload;
}

export interface ConfirmOutcome {
  invoiceId?: string;
  /** True when the route found this already confirmed — NOT a second write. */
  alreadyConfirmed: boolean;
  /** False when the gift was recorded against no email; see THE-350. */
  visibleToMember: boolean;
}

/**
 * 🔴 CONFIRM ONE CLAIM. IDEMPOTENT AT THE ROUTE, AND THIS RELIES ON THAT.
 *
 * A second press does not write a second invoice — the route's transaction sees
 * the existing `paymentInvoiceId` and returns it. So this reports
 * `alreadyConfirmed` rather than an error: the admin needs to know the money was
 * recorded ONCE, not that their tap failed.
 */
export async function confirmPaymentClaim(
  tenantId: string,
  registrationId: string,
): Promise<ConfirmOutcome> {
  const res = await authFetch('/api/event-payment/confirm', {
    method: 'POST',
    body: JSON.stringify({ tenantId, registrationId }),
  });
  const data = await res.json().catch(() => ({}));
  // 🔴 CLEARED WHETHER OR NOT IT SUCCEEDED. A failed confirmation leaves the row
  // in the queue, so a cached count would still be right — but a SUCCEEDED one
  // that the client mis-read as a failure would leave a badge one too high
  // forever. Dropping it either way costs one read and cannot be wrong.
  invalidatePaymentInbox(tenantId);
  if (!res.ok) throw new Error(data.error || 'The confirmation failed.');
  return {
    invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : undefined,
    alreadyConfirmed: data.alreadyConfirmed === true,
    visibleToMember: data.visibleToMember === true,
  };
}

/** The member's own "I've paid". THROWS on failure — see the module header. */
export async function claimPaymentSent(
  tenantId: string,
  registrationId: string,
  provider: string | null,
): Promise<void> {
  const res = await authFetch('/api/event-payment/claim', {
    method: 'POST',
    body: JSON.stringify({ tenantId, registrationId, provider }),
  });
  // The member's own press changes the church's queue, and an admin may be
  // looking at the badge in another tab of the same browser.
  invalidatePaymentInbox(tenantId);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || 'That could not be sent.');
  }
}
