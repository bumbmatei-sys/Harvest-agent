import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { deleteConnection } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    const resolvedTenantId = tenantId || PLATFORM_TENANT_ID;

    const integrationRef = adminDb
      .collection('tenants').doc(resolvedTenantId)
      .collection('integrations').doc(`${uid}_quickbooks`);
    const integrationDoc = await integrationRef.get();

    if (!integrationDoc.exists) {
      return NextResponse.json({ error: 'QuickBooks is not connected' }, { status: 404 });
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({ error: 'QuickBooks is not connected' }, { status: 404 });
    }

    if (data.connectedAccountId) {
      try {
        await deleteConnection(data.connectedAccountId);
      } catch (error) {
        console.warn('Could not delete Composio connection:', error);
      }
    }

    await integrationRef.set({
      status: 'disconnected',
      disconnectedAt: new Date().toISOString(),
      connectedAccountId: null,
      companyName: null,
      realmId: null,
    });

    return NextResponse.json({ success: true, message: 'QuickBooks disconnected' });
  } catch (error) {
    console.error('QuickBooks disconnect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
