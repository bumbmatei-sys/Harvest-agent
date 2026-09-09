import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getConnectionStatus,
  executeComposioAction,
  verifySignedState,
} from '@/lib/composio-client';
import { QUICKBOOKS_FEATURE_ENABLED, QUICKBOOKS_HIDDEN_MESSAGE } from '@/lib/quickbooks-feature';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 🔴 THE-335 — the master switch, before anything else in this handler.
  // The route is not deleted and every gate below it is untouched; flipping
  // QUICKBOOKS_FEATURE_ENABLED brings it back exactly as it was.
  if (!QUICKBOOKS_FEATURE_ENABLED) {
    return NextResponse.json({ error: QUICKBOOKS_HIDDEN_MESSAGE }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  const stateParam = searchParams.get('state');
  if (!stateParam) {
    return NextResponse.redirect(new URL('/?quickbooks_error=missing_state', baseUrl));
  }

  let tenantId: string;
  let uid: string;
  try {
    const verified = verifySignedState(stateParam);
    tenantId = verified.tenantId;
    uid = verified.uid;
  } catch {
    return NextResponse.redirect(new URL('/?quickbooks_error=invalid_state', baseUrl));
  }

  // tenantId is known from here on, so route back to the tenant's own subdomain
  // (e.g. bumb.theharvest.app) instead of the apex — otherwise the user loses
  // tenant context after completing OAuth.
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'theharvest.app';
  const tenantBaseUrl = `https://${tenantId}.${rootDomain}`;

  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const integrationRef = tenantRef.collection('integrations').doc(`${uid}_quickbooks`);

  // Resolve the connected-account id. The value we persisted at connect time is
  // authoritative and identity-bound (written under this uid), so we prefer it:
  // a signed state is replayable for up to 15 min, and trusting the callback
  // query param first would let an attacker replay a victim's state with their
  // own `connectedAccountId` and overwrite the victim's stored account. The v3
  // callback query param (`connectedAccountId`) is only a fallback for the
  // unexpected case where nothing was persisted.
  const pending = await integrationRef.get();
  const connectedAccountId =
    (pending.data()?.connectedAccountId as string | undefined) ??
    searchParams.get('connectedAccountId') ??
    null;
  if (!connectedAccountId) {
    return NextResponse.redirect(new URL('/admin/accounting?quickbooks_error=missing_connection_id', tenantBaseUrl));
  }

  try {
    const connectionStatus = await getConnectionStatus(connectedAccountId);
    if (connectionStatus.status.toUpperCase() !== 'ACTIVE') {
      await updateIntegrationStatus(tenantId, uid, connectedAccountId, 'failed');
      return NextResponse.redirect(new URL('/admin/accounting?quickbooks_error=connection_not_active', tenantBaseUrl));
    }

    let companyName = '';
    let realmId = '';

    try {
      const info = await executeComposioAction('QUICKBOOKS_GET_COMPANY_INFO', {}, connectedAccountId, tenantId, uid);
      const company = info?.data?.CompanyInfo || info?.data?.companyInfo || info?.data || info;
      companyName = company?.CompanyName || company?.companyName || '';
      realmId = company?.Id || company?.realmId || connectionStatus.metadata?.realmId || '';
    } catch (e) {
      // Persisted as `status: 'active'` below with an EMPTY realmId/companyName —
      // the connection looks healthy in Settings but carries none of the company
      // identity the sales-receipt sync is written against.
      console.warn('Could not fetch QuickBooks company info:', e);
      captureHandledError(e, {
        step: 'quickbooks-fetch-company-info',
        level: 'warning',
        tenantId,
        ids: { connectedAccountId },
      });
    }

    await integrationRef.set({
      connectedAccountId,
      companyName,
      realmId,
      connectedAt: new Date().toISOString(),
      connectedBy: uid,
      status: 'active',
    }, { merge: true });

    // Set as primary if tenant doesn't have one yet
    const tDoc = await tenantRef.get();
    if (!tDoc.data()?.primaryQuickBooksAdmin) {
      await tenantRef.update({ primaryQuickBooksAdmin: uid });
    }

    return NextResponse.redirect(new URL('/admin/accounting?quickbooks_connected=true', tenantBaseUrl));
  } catch (error) {
    console.error('QuickBooks callback error:', error);
    // Composio holds a live ACTIVE connected account; only our persist failed. The
    // tenant granted QuickBooks access the app has no record of.
    captureHandledError(error, {
      step: 'quickbooks-oauth-callback',
      tenantId,
      ids: { connectedAccountId },
    });
    return NextResponse.redirect(new URL('/admin/accounting?quickbooks_error=callback_failed', tenantBaseUrl));
  }
}

async function updateIntegrationStatus(
  tenantId: string,
  uid: string,
  connectedAccountId: string,
  status: string
): Promise<void> {
  try {
    await adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc(`${uid}_quickbooks`)
      .update({ status, connectedAccountId, updatedAt: new Date().toISOString() });
  } catch { /* Doc might not exist yet */ }
}
