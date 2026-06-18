import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getConnectionStatus,
  executeComposioAction,
  verifySignedState,
} from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/composio/instagram/callback
 * Handles the OAuth callback from Composio after Instagram authorization
 * Query params: connection_id, state (HMAC-signed)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Fix 10: Rename to connectedAccountId for consistency
  const connectedAccountId = searchParams.get('connection_id');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  if (!connectedAccountId) {
    return NextResponse.redirect(
      new URL('/?instagram_error=missing_connection_id', baseUrl)
    );
  }

  // Fix 1: Verify HMAC-signed state parameter
  const stateParam = searchParams.get('state');
  if (!stateParam) {
    return NextResponse.redirect(
      new URL('/?instagram_error=missing_state', baseUrl)
    );
  }

  let tenantId: string;
  let uid: string;
  try {
    const verified = verifySignedState(stateParam);
    tenantId = verified.tenantId;
    uid = verified.uid;
  } catch {
    return NextResponse.redirect(
      new URL('/?instagram_error=invalid_state', baseUrl)
    );
  }

  try {
    // Verify the connection is active with Composio
    const connectionStatus = await getConnectionStatus(connectedAccountId);

    if (connectionStatus.status !== 'ACTIVE') {
      // Update local status to reflect failed/incomplete connection
      await updateIntegrationStatus(tenantId, connectedAccountId, 'failed');
      return NextResponse.redirect(
        new URL('/?instagram_error=connection_not_active', baseUrl)
      );
    }

    // Fetch Instagram user info via Composio action
    let username = '';
    let instagramUserId = '';

    try {
      const userInfo = await executeComposioAction(
        'INSTAGRAM_GET_USER_INFO',
        {},
        connectedAccountId
      );
      username = userInfo?.data?.username || userInfo?.username || '';
      instagramUserId = userInfo?.data?.id || userInfo?.id || '';
    } catch (actionError) {
      console.warn('Could not fetch Instagram user info:', actionError);
      // Continue — we can still store the connection
    }

    // Fix 6: Use .set merge to preserve audit trail
    await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('instagram')
      .set(
        {
          connectedAccountId,
          username,
          userId: instagramUserId,
          connectedAt: new Date().toISOString(),
          connectedBy: uid,
          status: 'active',
        },
        { merge: true }
      );

    return NextResponse.redirect(
      new URL('/?instagram_connected=true', baseUrl)
    );
  } catch (error: any) {
    // Fix 8: Don't leak error details to client
    console.error('Instagram callback error:', error);
    return NextResponse.redirect(
      new URL('/?instagram_error=callback_failed', baseUrl)
    );
  }
}

async function updateIntegrationStatus(
  tenantId: string,
  connectedAccountId: string,
  status: string
): Promise<void> {
  try {
    await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('instagram')
      .update({
        status,
        connectedAccountId,
        updatedAt: new Date().toISOString(),
      });
  } catch {
    // Doc might not exist yet — ignore
  }
}
