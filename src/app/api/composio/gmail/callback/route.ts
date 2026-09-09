import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getConnectionStatus, verifySignedState } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { GMAIL_FEATURE_ENABLED, GMAIL_HIDDEN_MESSAGE } from '@/lib/gmail-feature';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 🔴 THE-339 — the master switch, before anything else in this handler.
  // The route is not deleted and every gate below it is untouched; flipping
  // GMAIL_FEATURE_ENABLED brings it back exactly as it was. A stale tab holding
  // a signed state cannot complete a grant after the switch went off.
  if (!GMAIL_FEATURE_ENABLED) {
    return NextResponse.json({ error: GMAIL_HIDDEN_MESSAGE }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

  const stateParam = searchParams.get('state');
  if (!stateParam) {
    return NextResponse.redirect(new URL('/?gmail_error=missing_state', baseUrl));
  }

  let tenantId: string;
  let uid: string;
  try {
    const verified = verifySignedState(stateParam);
    tenantId = verified.tenantId;
    uid = verified.uid;
  } catch {
    return NextResponse.redirect(new URL('/?gmail_error=invalid_state', baseUrl));
  }

  // tenantId is known from here on, so route back to the tenant's own subdomain
  // instead of the apex — otherwise the user loses tenant context after OAuth.
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'theharvest.app';
  const tenantBaseUrl = `https://${tenantId}.${rootDomain}`;

  const integrationRef = adminDb
    .collection('tenants').doc(tenantId)
    .collection('integrations').doc(`${uid}_gmail`);

  // The value persisted at connect time is authoritative and identity-bound
  // (written under this uid), so we prefer it: a signed state is replayable for
  // up to 15 min, and trusting the callback query param first would let an
  // attacker replay a victim's state with their own `connectedAccountId` and
  // overwrite the victim's stored account. The query param is only a fallback
  // for the unexpected case where nothing was persisted.
  const pending = await integrationRef.get();
  const connectedAccountId =
    (pending.data()?.connectedAccountId as string | undefined) ??
    searchParams.get('connectedAccountId') ??
    null;
  if (!connectedAccountId) {
    return NextResponse.redirect(new URL('/admin/settings?gmail_error=missing_connection_id', tenantBaseUrl));
  }

  try {
    const connectionStatus = await getConnectionStatus(connectedAccountId);
    if (connectionStatus.status.toUpperCase() !== 'ACTIVE') {
      await updateIntegrationStatus(tenantId, uid, connectedAccountId, 'failed');
      return NextResponse.redirect(new URL('/admin/settings?gmail_error=connection_not_active', tenantBaseUrl));
    }

    // NOTE: unlike the Mailchimp callback, nothing is fetched from the account
    // here. Reading the connected address would mean GMAIL_GET_PROFILE, which
    // Google gates behind gmail.metadata/readonly/modify — mailbox scopes this
    // integration deliberately does not hold, and never will.
    //
    // The address is therefore not discovered, it is DECLARED: the admin confirms
    // it in Settings at connect time and it is already on this doc. `merge: true`
    // below is what preserves it — this write must not clobber `senderEmail`.
    await integrationRef.set({
      connectedAccountId,
      connectedAt: new Date().toISOString(),
      connectedBy: uid,
      status: 'active',
    }, { merge: true });

    return NextResponse.redirect(new URL('/admin/settings?gmail_connected=true', tenantBaseUrl));
  } catch (error) {
    console.error('Gmail callback error:', error);
    // Composio holds a live, ACTIVE connected account at this point; the failure
    // is on our side of the persist. The admin has granted send access that the
    // app has no record of, and they just see `?gmail_error=`.
    captureHandledError(error, {
      step: 'gmail-oauth-callback',
      tenantId,
      ids: { connectedAccountId },
    });
    return NextResponse.redirect(new URL('/admin/settings?gmail_error=callback_failed', tenantBaseUrl));
  }
}

async function updateIntegrationStatus(
  tenantId: string,
  uid: string,
  connectedAccountId: string,
  status: string
): Promise<void> {
  try {
    await adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc(`${uid}_gmail`)
      .update({ status, connectedAccountId, updatedAt: new Date().toISOString() });
  } catch { /* Doc might not exist yet */ }
}
