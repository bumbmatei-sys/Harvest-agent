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
    let integrationDoc = await integrationsRef.doc(`${uid}_instagram`).get();

    // Lazy migration from legacy flat doc
    if (!integrationDoc.exists) {
      const legacyDoc = await integrationsRef.doc('instagram').get();
      if (legacyDoc.exists && !legacyDoc.data()?._migrated) {
        const legacyData = legacyDoc.data();
        if (!legacyData?.connectedBy || legacyData.connectedBy === uid) {
          const newRef = integrationsRef.doc(`${uid}_instagram`);
          await newRef.set({ ...legacyData, connectedBy: uid });
          const tDoc = await tenantRef.get();
          if (!tDoc.data()?.primaryInstagramAdmin) {
            await tenantRef.update({ primaryInstagramAdmin: uid });
          }
          await legacyDoc.ref.update({ _migrated: true });
          integrationDoc = await newRef.get();
        }
      }
    }

    if (!integrationDoc.exists) {
      return NextResponse.json({ connected: false, status: 'not_configured', isPrimary: false });
    }

    const data = integrationDoc.data();
    if (!data) {
      return NextResponse.json({ connected: false, status: 'not_configured', isPrimary: false });
    }

    const tenantDoc = await tenantRef.get();
    const isPrimary = tenantDoc.data()?.primaryInstagramAdmin === uid;

    if (data.connectedAccountId && data.status === 'active') {
      try {
        const composioStatus = await getConnectionStatus(data.connectedAccountId);
        if (composioStatus.status !== 'ACTIVE') {
          await integrationDoc.ref.update({ status: 'disconnected', updatedAt: new Date().toISOString() });
          return NextResponse.json({
            connected: false, status: 'disconnected', username: data.username, isPrimary,
          });
        }
      } catch (error) {
        console.warn('Could not verify Instagram connection with Composio:', error);
      }
    }

    return NextResponse.json({
      connected: data.status === 'active',
      status: data.status || 'unknown',
      username: data.username || null,
      userId: data.userId || null,
      connectedAt: data.connectedAt || null,
      isPrimary,
    });
  } catch (error) {
    console.error('Instagram status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
