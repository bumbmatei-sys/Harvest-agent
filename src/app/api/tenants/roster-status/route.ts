import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { firebaseAdminCredentialsAvailable } from '@/lib/firebase-admin-credentials';
import { getTenantPrivate } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tenants/roster-status?tenantId=<id>
 *
 * "Am I on this tenant's admin roster?" for the CALLER only. The roster left
 * the world-readable tenants/{id} doc for the server-only tenant_private/{id}
 * doc, so client components that used to check `tenant.adminEmails` ask here
 * instead (OnboardingGate, AdminDashboard, AllNews, NewsTab).
 *
 * Returns only a boolean about the caller — never the roster itself, so an
 * authenticated user learns nothing about who else administers a church.
 */
export async function GET(request: NextRequest) {
  const callerOrErr = await requireAuth(request);
  if (callerOrErr instanceof Response) return callerOrErr;

  const tenantId = request.nextUrl.searchParams.get('tenantId') || callerOrErr.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  if (!firebaseAdminCredentialsAvailable()) {
    console.error('roster-status skipped: Firebase admin credentials are not available');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  try {
    const email = (callerOrErr.email || '').toLowerCase();
    const adminEmails = (await getTenantPrivate(tenantId)).adminEmails;
    const isRosterAdmin = !!email
      && Array.isArray(adminEmails)
      && adminEmails.some((e: string) => (e || '').toLowerCase() === email);

    return NextResponse.json({ isRosterAdmin });
  } catch (error) {
    console.error('roster-status could not read Firebase admin', error);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
