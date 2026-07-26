import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { normalizeSenderEmail } from '@/lib/gmail-sender';

export const dynamic = 'force-dynamic';

/**
 * POST /api/composio/gmail/address
 *
 * Change the address this admin's Gmail connection sends from.
 *
 * Needed because the address is captured at connect time and can be wrong: an
 * admin whose Harvest login is pastor@church.org may well have authorised
 * personal@gmail.com. A wrong value is not silent — Gmail refuses a `From` that
 * is neither the authenticated account nor a verified "Send mail as" alias, so
 * the send fails rather than going out misattributed — but without this route
 * the only fix would be disconnect-and-reconnect, or a support request.
 *
 * It is also the route that back-fills every connection made before the address
 * was recorded at all.
 *
 * SCOPE — writes only `tenants/{tenantId}/integrations/{uid}_gmail`, with both
 * ids taken from the verified token. An admin cannot name another admin's doc,
 * so the address on a connection is only ever set by the admin who owns it.
 */
export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with this user' }, { status: 400 });
    }

    let senderEmail: string | null = null;
    try {
      const payload = await request.json();
      senderEmail = normalizeSenderEmail((payload as { senderEmail?: unknown })?.senderEmail);
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!senderEmail) {
      return NextResponse.json(
        { error: 'Enter a single email address, for example you@yourchurch.org.' },
        { status: 400 }
      );
    }

    const integrationRef = adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc(`${uid}_gmail`);

    // Requiring the doc to exist keeps this from minting a half-integration that
    // records a sending address for an account nobody ever connected.
    const integrationDoc = await integrationRef.get();
    if (!integrationDoc.exists) {
      return NextResponse.json({ error: 'Gmail is not connected' }, { status: 404 });
    }

    await integrationRef.set(
      { senderEmail, senderEmailUpdatedAt: new Date().toISOString() },
      { merge: true }
    );

    return NextResponse.json({ senderEmail });
  } catch (error) {
    console.error('Gmail sending-address update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
