import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getConnectionStatus,
  executeComposioAction,
  verifySignedState,
} from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  const stateParam = searchParams.get('state');
  if (!stateParam) {
    return NextResponse.redirect(new URL('/?instagram_error=missing_state', baseUrl));
  }

  let tenantId: string;
  let uid: string;
  try {
    const verified = verifySignedState(stateParam);
    tenantId = verified.tenantId;
    uid = verified.uid;
  } catch {
    return NextResponse.redirect(new URL('/?instagram_error=invalid_state', baseUrl));
  }

  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  const integrationRef = tenantRef.collection('integrations').doc(`${uid}_instagram`);

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
    return NextResponse.redirect(new URL('/?instagram_error=missing_connection_id', baseUrl));
  }

  try {
    const connectionStatus = await getConnectionStatus(connectedAccountId);
    if (connectionStatus.status.toUpperCase() !== 'ACTIVE') {
      await updateIntegrationStatus(tenantId, uid, connectedAccountId, 'failed');
      return NextResponse.redirect(new URL('/?instagram_error=connection_not_active', baseUrl));
    }

    let username = '';
    let instagramUserId = '';

    try {
      const userInfo = await executeComposioAction('INSTAGRAM_GET_USER_INFO', {}, connectedAccountId, tenantId, uid);
      username = userInfo?.data?.username || userInfo?.username || '';
      instagramUserId = userInfo?.data?.id || userInfo?.id || '';
    } catch (e) { console.warn('Could not fetch Instagram user info:', e); }

    await integrationRef.set({
      connectedAccountId,
      username,
      userId: instagramUserId,
      connectedAt: new Date().toISOString(),
      connectedBy: uid,
      status: 'active',
    }, { merge: true });

    // Set as primary if tenant doesn't have one yet
    const tDoc = await tenantRef.get();
    if (!tDoc.data()?.primaryInstagramAdmin) {
      await tenantRef.update({ primaryInstagramAdmin: uid });
    }

    return NextResponse.redirect(new URL('/?instagram_connected=true', baseUrl));
  } catch (error) {
    console.error('Instagram callback error:', error);
    return NextResponse.redirect(new URL('/?instagram_error=callback_failed', baseUrl));
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
      .collection('integrations').doc(`${uid}_instagram`)
      .update({ status, connectedAccountId, updatedAt: new Date().toISOString() });
  } catch { /* Doc might not exist yet */ }
}
