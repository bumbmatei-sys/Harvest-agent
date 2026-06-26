import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { deleteConnection } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with this user' }, { status: 400 });
    }

    const integrationsRef = adminDb.collection('tenants').doc(tenantId).collection('integrations');

    // Check per-admin doc first, fall back to legacy
    let integrationRef = integrationsRef.doc(`${uid}_mailchimp`);
    let integrationDoc = await integrationRef.get();

    if (!integrationDoc.exists) {
      const legacyRef = integrationsRef.doc('mailchimp');
      const legacyDoc = await legacyRef.get();
      if (legacyDoc.exists && legacyDoc.data()?.connectedBy === uid) {
        integrationRef = legacyRef;
        integrationDoc = legacyDoc;
      }
    }

    if (!integrationDoc.exists) {
      return NextResponse.json({ error: 'Mailchimp is not connected' }, { status: 404 });
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({ error: 'Mailchimp is not connected' }, { status: 404 });
    }

    if (data.connectedAccountId) {
      try {
        await deleteConnection(data.connectedAccountId);
      } catch (error) {
        console.warn('Could not delete Composio connection:', error);
      }
    }

    await integrationRef.set({
      status: 'disconnected',
      disconnectedAt: new Date().toISOString(),
      connectedAccountId: null,
      email: null,
    });

    return NextResponse.json({ success: true, message: 'Mailchimp disconnected' });
  } catch (error) {
    console.error('Mailchimp disconnect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
