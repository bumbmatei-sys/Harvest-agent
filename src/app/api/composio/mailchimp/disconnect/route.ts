import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { deleteConnection } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/composio/mailchimp/disconnect
 * Disconnects Mailchimp integration for the authenticated tenant
 */
export async function POST(request: NextRequest) {
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

    const integrationRef = adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('mailchimp');

    const integrationDoc = await integrationRef.get();

    if (!integrationDoc.exists) {
      return NextResponse.json(
        { error: 'Mailchimp is not connected' },
        { status: 404 }
      );
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json(
        { error: 'Mailchimp is not connected' },
        { status: 404 }
      );
    }

    // Delete the connection from Composio
    if (data.connectedAccountId) {
      try {
        await deleteConnection(data.connectedAccountId);
      } catch (error) {
        console.warn('Could not delete Composio connection:', error);
        // Continue with local cleanup even if Composio delete fails
      }
    }

    // Update local status
    await integrationRef.set({
      status: 'disconnected',
      disconnectedAt: new Date().toISOString(),
      connectedAccountId: null,
      email: null,
    });

    return NextResponse.json({ success: true, message: 'Mailchimp disconnected' });
  } catch (error) {
    console.error('Mailchimp disconnect error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
