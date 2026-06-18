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
 * GET /api/composio/mailchimp/callback
 * Handles the OAuth callback from Composio after Mailchimp authorization
 * Query params: connection_id, state (HMAC-signed)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Fix 10: Rename to connectedAccountId for consistency
  const connectedAccountId = searchParams.get('connection_id');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  if (!connectedAccountId) {
    return NextResponse.redirect(
      new URL('/?mailchimp_error=missing_connection_id', baseUrl)
    );
  }

  // Fix 1: Verify HMAC-signed state parameter
  const stateParam = searchParams.get('state');
  if (!stateParam) {
    return NextResponse.redirect(
      new URL('/?mailchimp_error=missing_state', baseUrl)
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
      new URL('/?mailchimp_error=invalid_state', baseUrl)
    );
  }

  try {
    // Verify the connection is active with Composio
    const connectionStatus = await getConnectionStatus(connectedAccountId);

    if (connectionStatus.status !== 'ACTIVE') {
      await updateIntegrationStatus(tenantId, connectedAccountId, 'failed');
      return NextResponse.redirect(
        new URL('/?mailchimp_error=connection_not_active', baseUrl)
      );
    }

    // Fetch Mailchimp user info and audiences
    let email = '';
    let audiences: Array<{ id: string; name: string; memberCount: number }> = [];

    try {
      const userInfo = await executeComposioAction(
        'MAILCHIMP_GET_ACCOUNT_INFO',
        {},
        connectedAccountId
      );
      email = userInfo?.data?.email || userInfo?.email || '';
    } catch (actionError) {
      console.warn('Could not fetch Mailchimp account info:', actionError);
    }

    try {
      const audienceResult = await executeComposioAction(
        'MAILCHIMP_GET_LISTS',
        { count: 100 },
        connectedAccountId
      );
      const lists = audienceResult?.data?.lists || audienceResult?.lists || [];
      audiences = lists.map((list: any) => ({
        id: list.id,
        name: list.name,
        memberCount: list.stats?.member_count || 0,
      }));
    } catch (actionError) {
      console.warn('Could not fetch Mailchimp audiences:', actionError);
    }

    // Fix 6: Use .set merge to preserve audit trail
    await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('mailchimp')
      .set(
        {
          connectedAccountId,
          email,
          audiences,
          selectedAudienceId: null,
          connectedAt: new Date().toISOString(),
          connectedBy: uid,
          status: 'active',
        },
        { merge: true }
      );

    return NextResponse.redirect(
      new URL('/?mailchimp_connected=true', baseUrl)
    );
  } catch (error: any) {
    // Fix 8: Don't leak error details to client
    console.error('Mailchimp callback error:', error);
    return NextResponse.redirect(
      new URL('/?mailchimp_error=callback_failed', baseUrl)
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
      .doc('mailchimp')
      .update({
        status,
        connectedAccountId,
        updatedAt: new Date().toISOString(),
      });
  } catch {
    // Doc might not exist yet — ignore
  }
}
