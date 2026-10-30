import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

/** First-run setup changes branding, never the tenant's address or identity. */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAuth(request);
    if (caller instanceof Response) return caller;
    if (!caller.tenantId) return NextResponse.json({ error: 'No workspace.' }, { status: 400 });
    const ref = adminDb.collection('tenants').doc(caller.tenantId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
    const privateData = await getTenantPrivate(caller.tenantId);
    const roster = Array.isArray(privateData.adminEmails) ? privateData.adminEmails : [];
    if (!caller.isAdmin && !caller.isSuperAdmin && !roster.some((email: string) => email.toLowerCase() === caller.email?.toLowerCase())) {
      return NextResponse.json({ error: 'Not authorized for this workspace.' }, { status: 403 });
    }
    await ref.update({ setupCompleted: true, updatedAt: new Date().toISOString() });
    return NextResponse.json({ tenantId: caller.tenantId });
  } catch {
    return NextResponse.json({ error: 'Could not finish setup. Please try again.' }, { status: 503 });
  }
}
