import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireTenantPermission } from '@/lib/api-auth';
import {
  CLAIM_QUEUE_FIELD,
  INBOX_CEILING,
  providerFromClaim,
  type InboxItem,
} from '@/lib/event-payment-claims';

export const dynamic = 'force-dynamic';

/**
 * THE-351 — 🔴 THE TENANT INBOX: WHO SAYS THEY HAVE PAID, OLDEST FIRST.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. A CHURCH CANNOT SEE ANOTHER CHURCH'S INBOX, AND THE PROOF IS THE PATH
 *
 * There are two locks and they are independent:
 *
 *   1. `requireTenantPermission(request, tenantId, 'manageEvents')` — the same
 *      helper THE-350 used for the money ledger, documented for "admin API
 *      routes that stand in for a client write the rules can't express". It
 *      resolves the caller from a VERIFIED token and checks them against THIS
 *      tenant's roster. A caller who names someone else's tenant is refused
 *      before a single document is read.
 *   2. THE QUERY IS ROOTED AT `tenants/{tenantId}/registrations`. Tenancy is a
 *      PATH SEGMENT, not a `where('tenantId','==',…)` filter — so there is no
 *      shape of this query, mistaken or malicious, that can return a document
 *      belonging to another church. A dropped filter is a whole class of bug
 *      that a subcollection cannot have.
 *
 * ⚠️ `firestore.rules` IS UNTOUCHED AND NEEDS NO CHANGE. The rule it already
 * carries — `allow read: if isAuthenticated() && (isTenantAdmin(tenantId) || …)`
 * on this exact subcollection — is the client-side statement of the same
 * scoping, and the reason this ticket derives its inbox from `registrations`
 * rather than inventing a collection that would have needed a new block in a
 * file that AUTO-DEPLOYS with no emulator tests.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. ORDERED, ASCENDING, AND WITH NO COMPOSITE INDEX
 *
 * `orderBy(CLAIM_QUEUE_FIELD, 'asc')` and nothing else. Three consequences, all
 * of them load-bearing:
 *
 *   · IT IS ORDERED. #405 found 41 files doing `limit(N)` with no `orderBy`,
 *     which returns N ARBITRARY documents. An inbox built that way drops people.
 *   · IT IS ASCENDING, so what falls off the end is the NEWEST claim. A DESC
 *     limit would drop the OLDEST — the one that has waited longest and is most
 *     likely to have been forgotten, which is the single worst row to lose.
 *   · IT NEEDS NO COMPOSITE INDEX AND CANNOT COME TO NEED ONE. The queue filter
 *     and the queue order are the SAME FIELD, so this is a single-field index
 *     Firestore maintains automatically. `firestore.indexes.json` is NOT
 *     deployed by `deploy-rules.yml`, so an index added there would be INERT and
 *     this query would throw `failed-precondition` in production.
 *     Documents that do not carry the field are excluded by the `orderBy`
 *     itself — which is exactly the pending set, because the confirm route
 *     DELETES the field.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. THE COUNT IS EXACT, OR IT SAYS IT IS NOT
 *
 * A figure ships only if its read is EXACT or PROVABLY COMPLETE, and the unread
 * badge is a figure. This reads `INBOX_CEILING + 1` rows:
 *
 *   · ≤ CEILING came back  → the queue is exactly that long. `exact: true`.
 *   · CEILING + 1 came back → there are more than CEILING. `exact: false`, the
 *     badge renders `200+`, and the sheet says how many it is showing.
 *
 * ⚠️ A SECOND `count()` AGGREGATION WAS REJECTED, not overlooked. It would be a
 * separate round trip against a queue that changes between the two, so the
 * figure and the rows could disagree — a badge saying 7 over a list of 6. One
 * read answers both, and the answer is self-consistent by construction.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = (searchParams.get('tenantId') || '').trim();
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const gate = await requireTenantPermission(request, tenantId, 'manageEvents');
  if (gate instanceof NextResponse) return gate;

  try {
    const snap = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('registrations')
      .orderBy(CLAIM_QUEUE_FIELD, 'asc')
      .limit(INBOX_CEILING + 1)
      .get();

    const exact = snap.docs.length <= INBOX_CEILING;
    const docs = snap.docs.slice(0, INBOX_CEILING);

    // The event titles, resolved once per event rather than once per row.
    const eventIds = [...new Set(
      docs.map((d) => d.data().eventId).filter((v): v is string => typeof v === 'string' && !!v),
    )];
    const titles: Record<string, string> = {};
    await Promise.all(eventIds.map(async (eid) => {
      try {
        const es = await adminDb
          .collection('tenants').doc(tenantId)
          .collection('events').doc(eid).get();
        if (es.exists) titles[eid] = es.data()?.title || 'Event';
      } catch {
        // Best-effort join. A row whose event could not be read is still a
        // person waiting, and dropping it would be the silent failure.
      }
    }));

    const items: InboxItem[] = docs.map((d) => {
      const r = d.data();
      const provider = providerFromClaim(r.paymentClaimProvider);
      return {
        kind: 'event_payment_claim',
        id: d.id,
        memberName: typeof r.name === 'string' && r.name ? r.name : 'Someone',
        memberEmail: typeof r.email === 'string' ? r.email : '',
        eventTitle: (typeof r.eventId === 'string' && titles[r.eventId]) || 'Event',
        amountCents: typeof r.amount === 'number' ? r.amount : 0,
        reference: typeof r.paymentReference === 'string' ? r.paymentReference : '',
        providerId: provider ? provider.id : null,
        providerLabel: provider ? provider.label : null,
        claimedAt: typeof r[CLAIM_QUEUE_FIELD] === 'string' ? r[CLAIM_QUEUE_FIELD] : '',
      };
    });

    return NextResponse.json({ items, count: items.length, exact });
  } catch (e) {
    // 🔴 A FAILED READ IS NOT AN EMPTY INBOX. Returning `[]` here would paint
    // "Nothing to confirm" over a church with people waiting — the exact shape
    // of the Silent-Failure Rule, and the reason `bounded-list-read.ts` throws
    // rather than defaulting.
    console.error('event payment inbox read failed:', e);
    return NextResponse.json({ error: 'Failed to read the inbox' }, { status: 500 });
  }
}
