import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

/** GET — return the tenant's giving-statement configuration. */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  const snap = await adminDb.collection('tenants').doc(tenantId).get();
  const cfg = (snap.data()?.config?.givingStatements as Record<string, unknown>) || {};

  return NextResponse.json({
    ein: cfg.ein || '',
    address: cfg.address || '',
    footer: cfg.footer || '',
    country: cfg.country || 'US',
  });
}

/** PUT — update the tenant's giving-statement configuration. */
export async function PUT(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: { ein?: string; address?: string; footer?: string; country?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const givingStatements: Record<string, string> = {};
  if (body.ein !== undefined) givingStatements.ein = body.ein.trim();
  if (body.address !== undefined) givingStatements.address = body.address.trim();
  if (body.footer !== undefined) givingStatements.footer = body.footer.trim();
  if (body.country !== undefined) givingStatements.country = body.country.trim() || 'US';

  // merge: true deep-merges into config.givingStatements without clobbering
  // other config fields (logo, primaryColor, …).
  await adminDb.collection('tenants').doc(tenantId).set(
    { config: { givingStatements } },
    { merge: true },
  );

  return NextResponse.json({ success: true });
}
