import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin, requireTenantPermission } from '@/lib/api-auth';
import { deleteByQuery } from '@/lib/member-deletion';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { sortByTime } from '@/utils/query-helpers';

export const dynamic = 'force-dynamic';

/** Wire shape of one CRM timeline entry. Mirrors ContactActivity in useCRMQueries. */
interface ActivityRow {
  id: string;
  contactId: string;
  tenantId?: string;
  type: string;
  description: string;
  amount: number | null;
  /**
   * THE-350 — the `tenants/{t}/invoices` receipt a manually recorded gift
   * points at, and a CENTS mirror of its amount for the timeline row.
   *
   * 🔴 Carried on the wire so the CRM can DRAW the figure without reading the
   * invoices collection, which is admin-read-only and gated on
   * `manageAccounting`. The money record is the invoice; `amount` is null on
   * these rows precisely so nothing counts the gift twice.
   */
  invoiceId?: string | null;
  invoiceAmountCents?: number | null;
  createdAt: unknown;
  createdBy: string;
}

/**
 * Admin-SDK Timestamps don't survive JSON. Emit ISO strings, which `DateLike` /
 * `toSafeDate` already handle — the donation webhook writes ISO strings into
 * these same documents, so the client has always had to cope with both.
 */
function serializeCreatedAt(v: unknown): string | null {
  if (v == null) return null;
  if (typeof (v as { toDate?: unknown }).toDate === 'function') {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return new Date(v).toISOString();
  return null;
}

/**
 * GET /api/crm/contact-activities?contactId=<id>
 *
 * The CRM contact timeline. Reads run server-side via the Admin SDK because the
 * client query CANNOT work against the top-level `contactActivities` rule:
 *
 *     allow read: if isAuthenticated() && isTenantAdmin(resource.data.get('tenantId', ''))
 *
 * Rules are not filters. For a `list`, Firestore evaluates the rule against the
 * query's POTENTIAL result set, so a query constrained only on `contactId` can
 * prove nothing about `resource.data.tenantId` and the ENTIRE query is rejected
 * with permission-denied — even though every document it would return is
 * individually readable. That is why the timeline rendered empty for weeks
 * (`tests/rules/crm-activities.rules.test.ts` pins the behaviour down).
 *
 * Adding `where('tenantId','==',...)` to the client query would satisfy the rule
 * but needs a composite index, and a missing index fails silently here — one
 * invisible failure traded for another. So the read moved server-side, following
 * /api/sms-usage and /api/rag-usage.
 *
 * SECURITY: the tenant is resolved from the caller's own token / user doc and is
 * NEVER taken from the request. A client-supplied tenant id here would be a
 * cross-tenant read of donor activity. Because the result set is filtered to the
 * caller's own tenant, another tenant's contactId simply returns `[]` — there is
 * no shape of request that can surface another tenant's rows. Super admins are
 * unscoped, matching `getTenantScope()` and the rules' own isTenantAdmin().
 */
export async function GET(request: NextRequest) {
  const userOrErr = await requireAdmin(request);
  if (userOrErr instanceof NextResponse) return userOrErr;
  const user = userOrErr;

  const contactId = request.nextUrl.searchParams.get('contactId');
  if (!contactId) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
  }

  const scope = user.isSuperAdmin ? null : user.tenantId;
  if (!user.isSuperAdmin && !scope) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }

  try {
    // Same single-field query the client ran, same limit — only the credential
    // and the place the tenant comes from have changed.
    // ⚠️ `createdAt` IN THIS COLLECTION HOLDS TWO TYPES — THE-288.
    // Five writers store a Firestore Timestamp (`serverTimestamp()`):
    // /api/checkin/submit, /api/forms/submit, /api/event-registration/submit,
    // the event-registration webhook and AdminCRM. Two store an ISO STRING
    // (`new Date().toISOString()`): lib/donation-webhook.ts and
    // /api/crm/send-email. `serializeCreatedAt` above exists precisely because
    // of that split.
    //
    // 🔴 DO NOT ADD AN `orderBy('createdAt')` TO THIS QUERY. Firestore orders
    // by TYPE before value, so every string row would come back ahead of every
    // Timestamp row — a stable order that is not a chronological one, and one
    // that looks correct on any church whose activities happen to be all of one
    // kind. The sort below is in memory over both types and is deliberate, not
    // an oversight waiting to be optimised into the query.
    //
    // Latent, not live: nothing orders this collection today. Reported by
    // THE-288 and left latent on purpose — normalising the stored values is a
    // migration, and this ticket changes no stored value's type or shape.
    const snap = await adminDb
      .collection('contactActivities')
      .where('contactId', '==', contactId)
      .limit(200)
      .get();

    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ActivityRow);
    if (scope) rows = rows.filter(r => r.tenantId === scope);

    const activities = sortByTime(rows, 'createdAt', 'desc').map(r => ({
      ...r,
      createdAt: serializeCreatedAt(r.createdAt),
    }));

    return NextResponse.json({ activities });
  } catch (e) {
    console.error('contact-activities read error:', e);
    captureHandledError(e, {
      step: 'crm-contact-activities-read',
      tenantId: scope,
      ids: { contactId },
    });
    return NextResponse.json({ error: 'Failed to load activities.' }, { status: 500 });
  }
}

/**
 * DELETE /api/crm/contact-activities?contactId=<id>&tenantId=<id>
 *
 * THE-362 - every timeline row belonging to one contact, removed with it.
 *
 * ─── The defect ─────────────────────────────────────────────────────────────
 *
 * Deleting a contact removed ONE document. `contactActivities` rows are a
 * TOP-LEVEL collection keyed by a `contactId` field, not a subcollection, so
 * Firestore deletes none of them with the parent and every row was left behind
 * pointing at a document that no longer exists. In a collection where a
 * donation row carries an `invoiceId` that is a dangling reference next to the
 * money, and it accumulates for as long as a church tidies its CRM.
 *
 * ─── 🔴 WHY THIS IS SERVER-SIDE, AND WHY firestore.rules IS UNTOUCHED ───────
 *
 * A CLIENT CANNOT LIST THIS COLLECTION AT ALL. The GET above records the reason
 * in full: rules are not filters, so a `list` constrained only on `contactId`
 * cannot prove anything about `resource.data.tenantId` and the whole query is
 * refused. Adding `where('tenantId','==',…)` would satisfy the rule and need a
 * COMPOSITE INDEX - and `firestore.indexes.json` is not deployed by this repo's
 * CI, so the index would be absent in production and the query would throw
 * `failed-precondition` there while passing everywhere else.
 *
 * So a cascade cannot be written on the client without loosening a file that
 * AUTO-DEPLOYS on merge with no emulator tests (THE-313's one line turned 46
 * files red). It runs on the Admin SDK instead, behind
 * `requireTenantPermission(request, tenantId, 'manageCRM')` - the same gate,
 * the same helper and the same argument THE-350 used when the invoice write hit
 * exactly this wall. 🔴 NO RULE CHANGES, and no client gains any access.
 *
 * ─── 🔴 THE QUERY IS THE GET'S, EXACTLY ─────────────────────────────────────
 *
 * One single-field `where('contactId', '==', …)`, with the tenant filtered IN
 * MEMORY afterwards. Not a second equality filter: that is the composite index
 * again, and the guard below is stricter anyway because it is applied per
 * document immediately before that document is deleted.
 *
 * ─── 🔴 RESUMABLE, WHICH IS STRONGER HERE THAN ATOMIC ───────────────────────
 *
 * `deleteByQuery` pages at `CHUNK_LIMIT` and commits each page as ONE batch, so
 * a contact with fewer rows than that page size is deleted atomically and a
 * larger one is deleted in whole pages. A batch cannot span an unbounded number
 * of rows, so "atomic" is not available for every contact - but it is not what
 * protects the church here. THE ORDER IS:
 *
 *   1. the activities (this route),
 *   2. the contact document itself (the client, afterwards).
 *
 * A failure anywhere leaves the CONTACT STILL PRESENT with fewer rows behind
 * it, which is a state the CRM already renders correctly and which pressing
 * Delete again completes. There is no ordering of these two steps that can
 * produce the dangling reference this exists to remove, and no partial state
 * that leaves half a contact on screen. The reverse order - contact first -
 * would manufacture the orphan on every failure.
 *
 * ─── 🔴 WHAT THIS DOES NOT TOUCH ────────────────────────────────────────────
 *
 * `tenants/{t}/invoices` IS NEVER READ OR WRITTEN HERE. The receipt is the
 * money record, it carries no `contactId`, and `AdminAccounting` reads invoices
 * alone - so a gift stays on the church's books, in its totals and on its
 * giving statements after the person it came from is gone, exactly as it does
 * for a donor who erases their account (that path ANONYMISES invoices rather
 * than deleting them). A donation row's `invoiceId` points AT the receipt;
 * deleting the row removes a pointer, never its target.
 *
 * ⚠️ AND THIS IS NOT ERASURE. It removes a church's own CRM record of a person.
 * It does not touch `users`, an account, or any of the other collections
 * `lib/member-erasure.ts` sweeps; that path is member-initiated behind
 * `/api/account/delete` and there is deliberately no admin-facing surface for
 * it. Nothing here may become one.
 */
export async function DELETE(request: NextRequest) {
  const contactId = request.nextUrl.searchParams.get('contactId');
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!contactId) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
  }
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  // The gate. `requireTenantPermission` verifies the caller BELONGS to this
  // tenant before it checks the permission, so a client-supplied id can only
  // ever name a tenant the caller is already a member of.
  const auth = await requireTenantPermission(request, tenantId, 'manageCRM');
  if (auth instanceof NextResponse) return auth;

  try {
    const removed = await deleteByQuery(
      adminDb.collection('contactActivities').where('contactId', '==', contactId),
      // 🔴 THE CROSS-TENANT GUARD, applied per document. `deleteByQuery` skips
      // a row this returns false for and never aborts the page, so another
      // church's row sharing a contact id is spared rather than deleted.
      (data) => (data.tenantId ?? null) === tenantId,
    );
    return NextResponse.json({ removed });
  } catch (e) {
    console.error('contact-activities delete error:', e);
    captureHandledError(e, {
      step: 'crm-contact-activities-delete',
      tenantId,
      ids: { contactId },
    });
    return NextResponse.json({ error: 'Failed to remove this contact’s activity.' }, { status: 500 });
  }
}
