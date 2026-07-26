import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  initiateConnection,
  createSignedState,
  deleteConnection,
  getAuthConfig,
} from '@/lib/composio-client';
import { assertSendOnlyGmailScopes, GmailScopeError } from '@/lib/gmail-scopes';
import { normalizeSenderEmail } from '@/lib/gmail-sender';
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

    // ── Which address this admin will send from ─────────────────────────────
    // Settings asks for it and sends it here, prefilled with the Harvest login
    // so confirming is one click. Reading it from the body is safe HERE in a way
    // it would never be on the send route: this writes only to the caller's OWN
    // `{uid}_gmail` doc, keyed by the uid on the verified token, so an admin can
    // only ever name their own sending address.
    //
    // A body that omits it (or supplies something that is not a bare address)
    // falls back to the token's email rather than refusing — a connection with a
    // guessed address is fixable from Settings, whereas no connection at all is
    // not. Either way the value is this admin's own identity, never another's.
    let senderEmail: string | null = null;
    try {
      const payload = await request.json();
      senderEmail = normalizeSenderEmail((payload as { senderEmail?: unknown })?.senderEmail);
    } catch { /* no body, or not JSON — fall through to the token email */ }
    senderEmail = senderEmail ?? normalizeSenderEmail(userOrResponse.email);

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Per-admin integration doc: {uid}_gmail. Keyed by uid, exactly like
    // {uid}_mailchimp — two admins in the same church get two independent
    // connections and neither can send as the other.
    const integrationRef = adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc(`${uid}_gmail`);

    const existingDoc = await integrationRef.get();
    if (existingDoc.exists) {
      const existingData = existingDoc.data();
      if (existingData?.status === 'active') {
        return NextResponse.json(
          { error: 'Gmail is already connected. Disconnect first.' },
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

    const authConfigId = process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID;
    if (!authConfigId) {
      console.error('COMPOSIO_GMAIL_AUTH_CONFIG_ID is not set');
      return NextResponse.json({ error: 'Gmail integration is not configured' }, { status: 500 });
    }

    // ── The scope gate ──────────────────────────────────────────────────────
    // Re-read the auth config from Composio and refuse to send the admin to
    // Google unless the grant they are about to approve is send-only. This runs
    // BEFORE initiateConnection so a misconfigured auth config never produces a
    // consent screen — once a church clicks "Allow" on a read scope, the grant
    // exists and no code change takes it back. See src/lib/gmail-scopes.ts.
    let approvedScopes: string[];
    let isComposioManaged = false;
    try {
      const authConfig = await getAuthConfig(authConfigId);
      isComposioManaged = authConfig.isComposioManaged;
      approvedScopes = assertSendOnlyGmailScopes(authConfig);
    } catch (error) {
      if (error instanceof GmailScopeError) {
        console.error('Gmail auth config is not send-only:', error.message);
        captureHandledError(error, {
          step: 'gmail-connect-scope-guard',
          tenantId,
          ids: { authConfigId },
        });
        return NextResponse.json(
          { error: 'Gmail integration is not configured for send-only access.' },
          { status: 500 }
        );
      }
      throw error;
    }

    if (isComposioManaged) {
      // Not fatal — the scopes are already proven send-only above, so no mailbox
      // is exposed. But on Composio's shared OAuth app Google names *Composio*
      // on the consent screen, which reads badly on a church product. Fixed by
      // pointing COMPOSIO_GMAIL_AUTH_CONFIG_ID at a custom auth config built on
      // a Harvest-owned Google OAuth client.
      console.warn(
        'Gmail auth config is Composio-managed: the Google consent screen will ' +
        'name Composio, not Harvest.'
      );
    }

    const state = createSignedState(tenantId, uid);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const callbackUrl = `${baseUrl}/api/composio/gmail/callback`;

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
        // Recorded so the granted scopes are auditable from Firestore alone,
        // without a round-trip to Composio.
        scopes: approvedScopes,
        // Passed as `from_email` on every send so Composio never has to look the
        // address up itself — the lookup it would otherwise do needs a mailbox
        // scope. Omitted rather than written as null when unknown, so the send
        // route's "no address recorded" branch stays a single check.
        ...(senderEmail ? { senderEmail } : {}),
        initiatedAt: new Date().toISOString(),
      });
    });

    return NextResponse.json({ connectedAccountId, redirectUrl });
  } catch (error: any) {
    console.error('Gmail connect error:', error);
    if (error?.message === 'ALREADY_CONNECTED') {
      return NextResponse.json({ error: 'Gmail is already connected. Disconnect first.' }, { status: 409 });
    }
    if (error?.message === 'CONNECTION_IN_PROGRESS') {
      return NextResponse.json({ error: 'Connection in progress. Please wait.' }, { status: 409 });
    }
    // Captured only AFTER the two sentinel branches, which are deliberate
    // control flow thrown by the transaction rather than faults. What is left is
    // a real failure, and by then initiateConnection may already have minted a
    // Composio connected account the pending doc never recorded.
    captureHandledError(error, { step: 'gmail-connect-initiate' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
