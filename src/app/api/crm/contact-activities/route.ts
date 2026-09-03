import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
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
