import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getConnectionStatus } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/composio/mailchimp/status
 * Returns the Mailchimp connection status and audiences for the authenticated tenant
 */
export async function GET(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with this user' },
        { status: 400 }
      );
    }

    const integrationDoc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('mailchimp')
      .get();

    if (!integrationDoc.exists) {
      return NextResponse.json({
        connected: false,
        status: 'not_configured',
        audiences: [],
      });
    }

    // Fix 7: Null guard on Firestore data()
    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({
        connected: false,
        status: 'not_configured',
        audiences: [],
      });
    }

    // If we have a connection ID and status is active, verify with Composio
    if (data.connectedAccountId && data.status === 'active') {
      try {
        const composioStatus = await getConnectionStatus(data.connectedAccountId);

        if (composioStatus.status !== 'ACTIVE') {
          await integrationDoc.ref.update({
            status: 'disconnected',
            updatedAt: new Date().toISOString(),
          });
          return NextResponse.json({
            connected: false,
            status: 'disconnected',
            email: data.email,
            audiences: data.audiences || [],
          });
        }
      } catch (error) {
        console.warn('Could not verify Mailchimp connection with Composio:', error);
      }
    }

    return NextResponse.json({
      connected: data.status === 'active',
      status: data.status || 'unknown',
      email: data.email || null,
      audiences: data.audiences || [],
      selectedAudienceId: data.selectedAudienceId || null,
      connectedAt: data.connectedAt || null,
    });
  } catch (error) {
    // Fix 8: Don't leak error details; log server-side only
    console.error('Mailchimp status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
