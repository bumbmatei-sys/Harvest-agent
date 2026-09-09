import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getConnectionStatus } from '@/lib/composio-client';
import { QUICKBOOKS_FEATURE_ENABLED, QUICKBOOKS_HIDDEN_MESSAGE } from '@/lib/quickbooks-feature';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 🔴 THE-335 — the master switch, before anything else in this handler.
  // The route is not deleted and every gate below it is untouched; flipping
  // QUICKBOOKS_FEATURE_ENABLED brings it back exactly as it was.
  if (!QUICKBOOKS_FEATURE_ENABLED) {
    return NextResponse.json({ error: QUICKBOOKS_HIDDEN_MESSAGE }, { status: 503 });
  }

  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    const resolvedTenantId = tenantId || PLATFORM_TENANT_ID;

    const tenantRef = adminDb.collection('tenants').doc(resolvedTenantId);
    const integrationsRef = tenantRef.collection('integrations');

    const integrationDoc = await integrationsRef.doc(`${uid}_quickbooks`).get();

    if (!integrationDoc.exists) {
      return NextResponse.json({ connected: false, status: 'not_configured', isPrimary: false });
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({ connected: false, status: 'not_configured', isPrimary: false });
    }

    const tenantDoc = await tenantRef.get();
    const isPrimary = tenantDoc.data()?.primaryQuickBooksAdmin === uid;

    if (data.connectedAccountId && data.status === 'active') {
      try {
        const composioStatus = await getConnectionStatus(data.connectedAccountId);
        if (composioStatus.status.toUpperCase() !== 'ACTIVE') {
          await integrationDoc.ref.update({ status: 'disconnected', updatedAt: new Date().toISOString() });
          return NextResponse.json({
            connected: false, status: 'disconnected',
            companyName: data.companyName || null, isPrimary,
          });
        }
      } catch (error) {
        console.warn('Could not verify QuickBooks connection with Composio:', error);
      }
    }

    return NextResponse.json({
      connected: data.status === 'active',
      status: data.status || 'unknown',
      companyName: data.companyName || null,
      realmId: data.realmId || null,
      connectedAt: data.connectedAt || null,
      isPrimary,
    });
  } catch (error) {
    console.error('QuickBooks status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
