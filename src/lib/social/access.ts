import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireTenantAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getEffectiveFeatures, readTenantAddons, toTenantPlan } from '@/utils/plan-features';
import { socialMode, socialSampleWithoutEntitlement } from './mode';

export interface SocialAccess {
  readonly tenantId: string;
  readonly entitled: boolean;
  readonly sample: boolean;
}

/**
 * Authenticated, tenant-scoped, and entitled — or a preview that is allowed
 * to show seeded fiction. The tenant id always comes from the caller's own
 * token. A body cannot name another ministry.
 */
export async function requireSocialAccess(request: NextRequest): Promise<SocialAccess | NextResponse> {
  const headerTenant = request.headers.get('x-harvest-tenant');
  const tokenTenant = await tenantIdFromAuth(request);
  if (tokenTenant instanceof NextResponse) return tokenTenant;
  if (headerTenant && headerTenant !== tokenTenant) {
    return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
  }
  const admin = await requireTenantAdmin(request, tokenTenant);
  if (admin instanceof NextResponse) return admin;

  const snap = await adminDb.collection('tenants').doc(tokenTenant).get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const data = snap.data() || {};
  const features = getEffectiveFeatures(toTenantPlan(data.plan), readTenantAddons(data.addons));
  const entitled = features.socialScheduler === true;
  const mock = socialMode() === 'mock';
  const sampleGate = mock && socialSampleWithoutEntitlement();
  if (!entitled && !sampleGate) {
    return NextResponse.json({ error: 'social_scheduler_not_entitled' }, { status: 403 });
  }
  return { tenantId: tokenTenant, entitled, sample: mock };
}

async function tenantIdFromAuth(request: NextRequest): Promise<string | NextResponse> {
  const { requireAdmin } = await import('@/lib/api-auth');
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  if (!admin.tenantId) {
    return NextResponse.json({ error: 'No tenant associated with this account' }, { status: 403 });
  }
  return admin.tenantId;
}
