import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  initiateConnection,
  createSignedState,
  deleteConnection,
} from '@/lib/composio-client';
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

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Per-admin integration doc: {uid}_instagram
    const integrationRef = adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc(`${uid}_instagram`);

    const existingDoc = await integrationRef.get();
    if (existingDoc.exists) {
      const existingData = existingDoc.data();
      if (existingData?.status === 'active') {
        return NextResponse.json(
          { error: 'Instagram is already connected. Disconnect first.' },
          { status: 409 }
        );
      }
      if (existingData?.status === 'pending') {
        const initiatedAt = existingData.initiatedAt ? new Date(existingData.initiatedAt).getTime() : 0;
        if (Date.now() - initiatedAt < 10 * 60 * 1000) {
          return NextResponse.json({ error: 'Connection in progress. Please wait.' }, { status: 409 });
        }
        if (existingData.connectedAccountId) {
          try { await deleteConnection(existingData.connectedAccountId); } catch { /* best-effort */ }
        }
      }
    }

    const authConfigId = process.env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID;
    if (!authConfigId) {
      console.error('COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID is not set');
      return NextResponse.json({ error: 'Instagram integration is not configured' }, { status: 500 });
    }

    const state = createSignedState(tenantId, uid);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const callbackUrl = `${baseUrl}/api/composio/instagram/callback`;

    const { connectedAccountId, redirectUrl } = await initiateConnection(
      authConfigId,
      `${callbackUrl}?state=${encodeURIComponent(state)}`,
      tenantId,
      uid
    );

    await adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(integrationRef);
      if (doc.exists) {
        const data = doc.data();
        if (data?.status === 'active') throw new Error('ALREADY_CONNECTED');
        if (data?.status === 'pending') {
          const initiatedAt = data.initiatedAt ? new Date(data.initiatedAt).getTime() : 0;
          if (Date.now() - initiatedAt < 10 * 60 * 1000) throw new Error('CONNECTION_IN_PROGRESS');
        }
      }
      tx.set(integrationRef, {
        connectedAccountId,
        status: 'pending',
        initiatedBy: uid,
        connectedBy: uid,
        initiatedAt: new Date().toISOString(),
      });
    });

    return NextResponse.json({ connectedAccountId, redirectUrl });
  } catch (error: any) {
    console.error('Instagram connect error:', error);
    if (error?.message === 'ALREADY_CONNECTED') {
      return NextResponse.json({ error: 'Instagram is already connected. Disconnect first.' }, { status: 409 });
    }
    if (error?.message === 'CONNECTION_IN_PROGRESS') {
      return NextResponse.json({ error: 'Connection in progress. Please wait.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
