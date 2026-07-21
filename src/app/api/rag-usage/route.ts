import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getUsageSnapshot } from '@/lib/rag-usage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rag-usage
 *
 * Returns the caller's OWN tenant RAG usage snapshot for the admin usage
 * indicator (query tokens this month vs cap; ingest used vs ceiling). Reads run
 * server-side via the Admin SDK — the usage subcollection is default-deny to
 * every client, so this route is the only read path. The tenant is resolved from
 * the authenticated token (never a client-supplied id), so a caller can only see
 * their own tenant's usage. Super admins / non-tenant users are not metered →
 * `{ metered: false }`.
 */
export async function GET(request: NextRequest) {
  const userOrErr = await requireAuth(request);
  if (userOrErr instanceof Response) return userOrErr;

  if (userOrErr.isSuperAdmin || !userOrErr.tenantId) {
    return NextResponse.json({ metered: false });
  }

  try {
    const snapshot = await getUsageSnapshot(userOrErr.tenantId);
    return NextResponse.json({ metered: true, ...snapshot });
  } catch (e) {
    console.error('rag-usage snapshot error:', e);
    return NextResponse.json({ error: 'Failed to load usage.' }, { status: 500 });
  }
}
