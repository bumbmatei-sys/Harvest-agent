import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getConnectionStatus } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with this user' }, { status: 400 });
    }

    // Per-admin only. Unlike Mailchimp there is no legacy flat `gmail` doc to
    // migrate from, and deliberately no tenant-wide fallback: sending mail as
    // someone else's Gmail account is exactly what must not happen.
    const integrationDoc = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc(`${uid}_gmail`)
      .get();

    if (!integrationDoc.exists) {
      return NextResponse.json({ connected: false, status: 'not_configured' });
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({ connected: false, status: 'not_configured' });
    }

    if (data.connectedAccountId && data.status === 'active') {
      try {
        const composioStatus = await getConnectionStatus(data.connectedAccountId);
        if (composioStatus.status.toUpperCase() !== 'ACTIVE') {
          await integrationDoc.ref.update({ status: 'disconnected', updatedAt: new Date().toISOString() });
          return NextResponse.json({ connected: false, status: 'disconnected' });
        }
      } catch (error) {
        console.warn('Could not verify Gmail connection with Composio:', error);
      }
    }

    return NextResponse.json({
      connected: data.status === 'active',
      status: data.status || 'unknown',
      scopes: data.scopes || [],
      // The address this connection sends from. Also what the Settings card
      // shows, which is why "Connected" can finally name an account: an admin
      // with two Google accounts could not otherwise tell which one they linked.
      senderEmail: data.senderEmail || null,
      connectedAt: data.connectedAt || null,
    });
  } catch (error) {
    console.error('Gmail status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
