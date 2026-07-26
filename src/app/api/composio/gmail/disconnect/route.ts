import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { deleteConnection } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with this user' }, { status: 400 });
    }

    // Per-admin doc only — an admin can only revoke their OWN Gmail grant.
    const integrationRef = adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc(`${uid}_gmail`);
    const integrationDoc = await integrationRef.get();

    if (!integrationDoc.exists) {
      return NextResponse.json({ error: 'Gmail is not connected' }, { status: 404 });
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({ error: 'Gmail is not connected' }, { status: 404 });
    }

    if (data.connectedAccountId) {
      try {
        await deleteConnection(data.connectedAccountId);
      } catch (error) {
        // The local doc is set to 'disconnected' below regardless, and
        // connectedAccountId is nulled with it — so Google keeps a live OAuth
        // grant the app can no longer even name, let alone revoke, while the
        // admin is told the disconnect succeeded. Report it.
        console.warn('Could not delete Composio Gmail connection:', error);
        captureHandledError(error, {
          step: 'gmail-composio-delete-connection',
          tenantId,
          ids: { connectedAccountId: data.connectedAccountId },
        });
      }
    }

    await integrationRef.set({
      status: 'disconnected',
      disconnectedAt: new Date().toISOString(),
      connectedAccountId: null,
      scopes: [],
    });

    return NextResponse.json({ success: true, message: 'Gmail disconnected' });
  } catch (error) {
    console.error('Gmail disconnect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
