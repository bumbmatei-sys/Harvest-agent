import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantAdmin, requireTenantPermission } from '@/lib/api-auth';

/** Storefront is the ministry's public page, so it sits with the blog: tenant admins who may write articles. */
export async function requireStorefrontEditor(request: NextRequest, tenantId: string) {
  const admin = await requireTenantAdmin(request, tenantId);
  if (admin instanceof NextResponse) return admin;
  if (!admin.isSuperAdmin && admin.tenantId === tenantId) {
    const permitted = await requireTenantPermission(request, tenantId, 'writeArticles');
    if (permitted instanceof NextResponse) return permitted;
  }
  return admin;
}
