import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { authorizeForms } from '@/lib/form-follow-up/authorize';
import { adminDb } from '@/lib/firebase-admin';
import { validId } from '@/lib/signup-pages/server';
import type { FollowUp } from '@/lib/form-follow-up/model';
import { InvalidFollowUp, validateFollowUp } from '@/lib/form-follow-up/server';
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (user instanceof NextResponse) return user;
    const tenantId = request.nextUrl.searchParams.get('tenantId') || user.tenantId;
    if (!validId(tenantId)) return NextResponse.json({ error: 'Tenant required' }, { status: 400 });
    const access = await authorizeForms(request, tenantId);
    if (access instanceof NextResponse) return access;
    const options: (FollowUp & { name: string })[] = [];
    try {
      const community = await validateFollowUp(tenantId, { type: 'community', id: tenantId });
      if (community) options.push({ type: 'community', id: tenantId, name: community.listing.name });
    } catch (error) { if (!(error instanceof InvalidFollowUp)) throw error; }
    const courses = await adminDb.collection('courses').where('tenantId', '==', tenantId).get();
    for (const doc of courses.docs) {
      if (doc.data().status !== 'published') continue;
      try {
        const item = await validateFollowUp(tenantId, { type: 'product', id: doc.id });
        if (item) options.push({ type: 'product', id: doc.id, name: item.listing.name });
      } catch (error) { if (!(error instanceof InvalidFollowUp)) throw error; }
    }
    const digital = await adminDb.collection('tenants').doc(tenantId).collection('digitalProducts').get();
    for (const doc of digital.docs) {
      if (doc.data().status !== 'published') continue;
      try {
        const item = await validateFollowUp(tenantId, { type: 'product', productKind: 'digital', id: doc.id });
        if (item) options.push({ type: 'product', productKind: 'digital', id: doc.id, name: item.listing.name });
      } catch (error) { if (!(error instanceof InvalidFollowUp)) throw error; }
    }
    return NextResponse.json({ options }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Could not load follow-up choices. Please retry.' }, { status: 503 }); }
}
