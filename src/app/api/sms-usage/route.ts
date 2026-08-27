import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSmsUsageSnapshot } from '@/lib/sms-usage';
import { getSmsCredentialSource } from '@/lib/twilio';
import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from '@/lib/sms-feature';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sms-usage
 *
 * Returns the caller's OWN tenant SMS usage snapshot for the admin usage
 * indicator. The unit is SEGMENTS, not messages — see planLimits.ts; the UI must
 * say so.
 *
 * `metered` means "a cap applies to you", and it is true ONLY for a tenant
 * sending on Harvest's own Twilio account. A tenant on their own credentials
 * (`source: 'byo'`) is billed by Twilio directly and subject to no allotment, so
 * it reports `metered: false` with their own volume and a null cap — the UI must
 * not show them a limit they are not subject to. A tenant with no credentials at
 * all reports `source: null`: it can't send, so there is nothing to show.
 *
 * Reads run server-side via the Admin SDK: the usage subcollection has no client
 * rule, so it is default-DENY to every client and this route is the only read
 * path. The tenant is resolved from the authenticated token (never a
 * client-supplied id), so a caller can only ever see their own tenant's usage.
 * The credential SOURCE is read server-side too and no credential ever leaves
 * this process. Super admins / non-tenant users are not metered.
 */
// THE-245 — refused while the SMS feature is hidden. The usage DOCUMENTS are
// untouched; only this read path is closed, and it reopens with the switch.
export async function GET(request: NextRequest) {
  if (!SMS_FEATURE_ENABLED) {
    return NextResponse.json({ error: SMS_HIDDEN_MESSAGE }, { status: 503 });
  }
  const userOrErr = await requireAuth(request);
  if (userOrErr instanceof Response) return userOrErr;

  if (userOrErr.isSuperAdmin || !userOrErr.tenantId) {
    return NextResponse.json({ metered: false, source: null });
  }

  try {
    const [snapshot, source] = await Promise.all([
      getSmsUsageSnapshot(userOrErr.tenantId),
      getSmsCredentialSource(userOrErr.tenantId),
    ]);

    // BYO: their own volume, explicitly no cap. `smsSegmentsUsed` is the count
    // for the account being described, so the UI renders one number either way.
    if (source === 'byo') {
      return NextResponse.json({
        metered: false,
        source,
        plan: snapshot.plan,
        month: snapshot.month,
        smsSegmentsUsed: snapshot.smsSegmentsByoUsed,
        smsSegmentsCap: null,
      });
    }

    // A null cap means the tier is deliberately unmetered — report it as
    // unmetered rather than rendering a meter against a missing limit.
    if (snapshot.smsSegmentsCap === null) {
      return NextResponse.json({ metered: false, source });
    }
    return NextResponse.json({ metered: source === 'platform', source, ...snapshot });
  } catch (e) {
    console.error('sms-usage snapshot error:', e);
    return NextResponse.json({ error: 'Failed to load SMS usage.' }, { status: 500 });
  }
}
