import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { deleteConnection } from '@/lib/composio-client';
import { QUICKBOOKS_FEATURE_ENABLED, QUICKBOOKS_HIDDEN_MESSAGE } from '@/lib/quickbooks-feature';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
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
        // The local doc is set to 'disconnected' immediately below regardless, and
        // connectedAccountId is nulled with it — so the third party keeps a live
        // OAuth grant on the ministry's account that the app can no longer even
        // name, let alone revoke. The admin is told the disconnect succeeded.
        console.warn('Could not delete Composio connection:', error);
        captureHandledError(error, {
          step: 'quickbooks-composio-delete-connection',
          tenantId: resolvedTenantId,
          ids: { connectedAccountId: data.connectedAccountId },
        });
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
