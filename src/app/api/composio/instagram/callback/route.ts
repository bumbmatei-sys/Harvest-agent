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
  const connectedAccountId = searchParams.get('connection_id');
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  if (!connectedAccountId) {
    return NextResponse.redirect(new URL('/?instagram_error=missing_connection_id', baseUrl));
  }

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

  try {
    const connectionStatus = await getConnectionStatus(connectedAccountId);
    if (connectionStatus.status !== 'ACTIVE') {
      await updateIntegrationStatus(tenantId, uid, connectedAccountId, 'failed');
      return NextResponse.redirect(new URL('/?instagram_error=connection_not_active', baseUrl));
    }

    let username = '';
    let instagramUserId = '';

    try {
      const userInfo = await executeComposioAction('INSTAGRAM_GET_USER_INFO', {}, connectedAccountId);
      username = userInfo?.data?.username || userInfo?.username || '';
      instagramUserId = userInfo?.data?.id || userInfo?.id || '';
    } catch (e) { console.warn('Could not fetch Instagram user info:', e); }

    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const integrationRef = tenantRef.collection('integrations').doc(`${uid}_instagram`);

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
