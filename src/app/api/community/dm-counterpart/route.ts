import { NextRequest, NextResponse } from 'next/server';
import { requireTenantMember } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';

// Return only the status of a participant in the caller's own thread, not user data.
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  const dmId = request.nextUrl.searchParams.get('dmId');
  if (!tenantId || !dmId || tenantId.includes('/') || dmId.includes('/')) return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 });
  const user = await requireTenantMember(request, tenantId);
  if (user instanceof NextResponse) return user;
  try {
    const thread = await adminDb.collection('tenants').doc(tenantId).collection('directMessages').doc(dmId).get();
    const participants = thread.data()?.participants;
    if (!Array.isArray(participants) || participants.length !== 2 || !participants.includes(user.uid)) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    const other = participants.find((id: unknown) => id !== user.uid);
    if (typeof other !== 'string' || !other || other.includes('/')) return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 });
    const [person, tenant, privateDoc] = await Promise.all([
      adminDb.collection('users').doc(other).get(), adminDb.collection('tenants').doc(tenantId).get(), adminDb.collection('tenant_private').doc(tenantId).get(),
    ]);
    const data = person.data();
    if (!person.exists) return NextResponse.json({ error: 'Could not check conversation' }, { status: 503 });
    const emails = privateDoc.data()?.adminEmails;
    const isAdmin = !!data && ((data.tenantId === tenantId && ['admin', 'super_admin'].includes(data.role)) || tenant.data()?.ownerId === other || (Array.isArray(emails) && emails.includes(data.email)));
    return NextResponse.json({ isAdmin });
  } catch {
    return NextResponse.json({ error: 'Could not check conversation' }, { status: 503 });
  }
}
