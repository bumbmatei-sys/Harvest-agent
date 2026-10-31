import { NextRequest, NextResponse } from 'next/server';
import { requireTenantAdmin, requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getEffectiveFeatures, readTenantAddons, toTenantPlan, UNLIMITED_CAP } from '@/utils/plan-features';
import { DEFAULT_COMMUNITY_ID, defaultCommunityRecord, readCommunityRecord, type CommunityRecord } from './communities';
import { readCommunitySettings } from './settings';

/** The same gate as the community settings route: a tenant admin holding manageCommunity. */
export async function requireCommunityManager(request: NextRequest, tenantId: string) {
  const admin = await requireTenantAdmin(request, tenantId);
  if (admin instanceof NextResponse) return admin;
  // The roster is an independent admin grant and can have no tenant claim.
  if (!admin.isSuperAdmin && admin.tenantId === tenantId) {
    const permitted = await requireTenantPermission(request, tenantId, 'manageCommunity');
    if (permitted instanceof NextResponse) return permitted;
  }
  return admin;
}

export function isTenantIdParam(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export const communitiesRef = (tenantId: string) => adminDb.collection('tenants').doc(tenantId).collection('communities');

/** -1 is unlimited. */
export function communityLimit(tenant: Record<string, unknown>): number {
  const plan = toTenantPlan(typeof tenant.plan === 'string' ? tenant.plan : null);
  const cap = getEffectiveFeatures(plan, readTenantAddons(tenant.addons)).maxCommunities;
  return cap === UNLIMITED_CAP ? -1 : cap;
}

export type CommunityList = { communities: CommunityRecord[]; limit: number; defaultClosed: boolean };

/**
 * Every community of a ministry: the default one first (unless deleted), then
 * the others by creation. A malformed stored record fails the whole read
 * rather than vanishing from the admin's list.
 */
export async function loadCommunities(tenantId: string): Promise<CommunityList | null> {
  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const [tenant, settings, records] = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('settings').doc('community').get(),
    communitiesRef(tenantId).orderBy('createdAt', 'asc').get(),
  ]);
  if (!tenant.exists) return null;
  const tenantData = tenant.data() ?? {};
  const setup = readCommunitySettings(settings.exists ? settings.data() : undefined);
  const defaultClosed = setup.closed === true;
  const others = records.docs.filter(doc => doc.id !== DEFAULT_COMMUNITY_ID).map(doc => readCommunityRecord(doc.id, doc.data()));
  const name = typeof tenantData.name === 'string' ? tenantData.name : '';
  return {
    communities: defaultClosed ? others : [defaultCommunityRecord(name, setup), ...others],
    limit: communityLimit(tenantData),
    defaultClosed,
  };
}
