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

    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const integrationsRef = tenantRef.collection('integrations');

    // Check per-admin doc first
    let integrationDoc = await integrationsRef.doc(`${uid}_mailchimp`).get();

    // Lazy migration from legacy flat doc
    if (!integrationDoc.exists) {
      const legacyDoc = await integrationsRef.doc('mailchimp').get();
      if (legacyDoc.exists && !legacyDoc.data()?._migrated) {
        const legacyData = legacyDoc.data();
        if (!legacyData?.connectedBy || legacyData.connectedBy === uid) {
          const newRef = integrationsRef.doc(`${uid}_mailchimp`);
          await newRef.set({ ...legacyData, connectedBy: uid });
          const tDoc = await tenantRef.get();
          if (!tDoc.data()?.primaryMailchimpAdmin) {
            await tenantRef.update({ primaryMailchimpAdmin: uid });
          }
          await legacyDoc.ref.update({ _migrated: true });
          integrationDoc = await newRef.get();
        }
      }
    }

    if (!integrationDoc.exists) {
      return NextResponse.json({ connected: false, status: 'not_configured', audiences: [], isPrimary: false });
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({ connected: false, status: 'not_configured', audiences: [], isPrimary: false });
    }

    const tenantDoc = await tenantRef.get();
    const isPrimary = tenantDoc.data()?.primaryMailchimpAdmin === uid;

    if (data.connectedAccountId && data.status === 'active') {
      try {
        const composioStatus = await getConnectionStatus(data.connectedAccountId);
        if (composioStatus.status !== 'ACTIVE') {
          await integrationDoc.ref.update({ status: 'disconnected', updatedAt: new Date().toISOString() });
          return NextResponse.json({
            connected: false, status: 'disconnected',
            email: data.email, audiences: data.audiences || [], isPrimary,
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
      isPrimary,
    });
  } catch (error) {
    console.error('Mailchimp status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
