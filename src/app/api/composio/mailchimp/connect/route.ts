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

/**
 * POST /api/composio/mailchimp/connect
 * Initiates Mailchimp OAuth flow via Composio
 */
export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with this user' },
        { status: 400 }
      );
    }

    // Verify tenant exists
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Fix 2 & 3: Check for stale pending status and active connections
    const integrationRef = adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('mailchimp');

    const existingDoc = await integrationRef.get();
    if (existingDoc.exists) {
      const existingData = existingDoc.data();
      if (existingData?.status === 'active') {
        return NextResponse.json(
          { error: 'Mailchimp is already connected. Disconnect first.' },
          { status: 409 }
        );
      }
      if (existingData?.status === 'pending') {
        const initiatedAt = existingData.initiatedAt
          ? new Date(existingData.initiatedAt).getTime()
          : 0;
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        if (initiatedAt > tenMinutesAgo) {
          // Fix 3: Recent pending — reject
          return NextResponse.json(
            { error: 'Connection in progress. Please wait.' },
            { status: 409 }
          );
        }
        // Fix 3: Stale pending — clean up old Composio connection
        if (existingData.connectedAccountId) {
          try {
            await deleteConnection(existingData.connectedAccountId);
          } catch {
            // Best-effort cleanup; continue
          }
        }
      }
    }

    // Fix 1: Generate HMAC-signed state for callback authentication
    const state = createSignedState(tenantId, uid);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const callbackUrl = `${baseUrl}/api/composio/mailchimp/callback`;

    // Fix 10: initiateConnection now returns connectedAccountId
    const { connectedAccountId, redirectUrl } = await initiateConnection(
      'mailchimp',
      `${callbackUrl}?state=${encodeURIComponent(state)}`,
      { tenantId, uid }
    );

    // Fix 2: Use Firestore transaction for atomic duplicate check + write
    await adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(integrationRef);
      if (doc.exists) {
        const data = doc.data();
        if (data?.status === 'active') {
          throw new Error('ALREADY_CONNECTED');
        }
        if (data?.status === 'pending') {
          const initiatedAt = data.initiatedAt
            ? new Date(data.initiatedAt).getTime()
            : 0;
          if (Date.now() - initiatedAt < 10 * 60 * 1000) {
            throw new Error('CONNECTION_IN_PROGRESS');
          }
        }
      }
      // Fix 10: Store connectedAccountId (not connectionId)
      tx.set(integrationRef, {
        connectedAccountId,
        status: 'pending',
        initiatedBy: uid,
        initiatedAt: new Date().toISOString(),
      });
    });

    // Fix 10: Return connectedAccountId
    return NextResponse.json({ connectedAccountId, redirectUrl });
  } catch (error: any) {
    // Fix 8: Don't leak error details; log server-side only
    console.error('Mailchimp connect error:', error);

    if (error?.message === 'ALREADY_CONNECTED') {
      return NextResponse.json(
        { error: 'Mailchimp is already connected. Disconnect first.' },
        { status: 409 }
      );
    }
    if (error?.message === 'CONNECTION_IN_PROGRESS') {
      return NextResponse.json(
        { error: 'Connection in progress. Please wait.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
