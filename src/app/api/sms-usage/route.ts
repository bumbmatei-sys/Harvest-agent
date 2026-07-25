import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSmsUsageSnapshot } from '@/lib/sms-usage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sms-usage
 *
 * Returns the caller's OWN tenant SMS usage snapshot for the admin usage
 * indicator (segments used this month vs the plan cap). The unit is SEGMENTS,
 * not messages — see planLimits.ts; the UI must say so.
 *
 * Reads run server-side via the Admin SDK: the usage subcollection has no client
 * rule, so it is default-DENY to every client and this route is the only read
 * path. The tenant is resolved from the authenticated token (never a
 * client-supplied id), so a caller can only ever see their own tenant's usage.
 * Super admins / non-tenant users are not metered → `{ metered: false }`.
 * Mirrors /api/rag-usage exactly.
 */
export async function GET(request: NextRequest) {
  const userOrErr = await requireAuth(request);
  if (userOrErr instanceof Response) return userOrErr;

  if (userOrErr.isSuperAdmin || !userOrErr.tenantId) {
    return NextResponse.json({ metered: false });
  }

  try {
    const snapshot = await getSmsUsageSnapshot(userOrErr.tenantId);
    // A null cap means the tier is deliberately unmetered — report it as
    // unmetered rather than rendering a meter against a missing limit.
    if (snapshot.smsSegmentsCap === null) {
      return NextResponse.json({ metered: false });
    }
    return NextResponse.json({ metered: true, ...snapshot });
  } catch (e) {
    console.error('sms-usage snapshot error:', e);
    return NextResponse.json({ error: 'Failed to load SMS usage.' }, { status: 500 });
  }
}
