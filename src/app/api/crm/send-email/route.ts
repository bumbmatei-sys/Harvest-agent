import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

/** Gmail caps a message at ~25 MB; these are UI-sanity bounds, not API limits. */
const MAX_SUBJECT = 500;
const MAX_BODY = 50_000;

/**
 * POST /api/crm/send-email
 *
 * Send one email to one CRM contact from the calling admin's own connected
 * Gmail account, then log it on the contact's timeline.
 *
 * SECURITY — everything that decides *who sends* and *who receives* is resolved
 * server-side:
 *
 *   • `tenantId` and `uid` come from the verified token, never the body. A
 *     request-supplied tenant would be a cross-tenant send.
 *   • The Gmail connection is looked up at `{uid}_gmail`, so admin A can never
 *     send through admin B's account even inside the same church. Composio
 *     enforces the same boundary a second time: the connection was created
 *     under the composite userId `tenantId:uid` and is a PRIVATE connected
 *     account, so executing against it with any other userId is denied.
 *   • The recipient is read from the contact document, NOT from the body.
 *     Accepting a `to` address would turn a church's Gmail account into an open
 *     relay driven through Harvest.
 *
 * Only `subject` and `body` are taken from the caller.
 *
 * FAILURE — a failed send must never look like a success. The activity is
 * written only after Composio reports the send succeeded; any failure returns a
 * non-2xx with a real message so the client can keep the composed text.
 */
export async function POST(request: NextRequest) {
  const userOrErr = await requireAdmin(request);
  if (userOrErr instanceof NextResponse) return userOrErr;
  const user = userOrErr;

  let payload: { contactId?: unknown; subject?: unknown; body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const contactId = typeof payload.contactId === 'string' ? payload.contactId.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';

  if (!contactId) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: 'A subject is required.' }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: 'A message body is required.' }, { status: 400 });
  }
  if (subject.length > MAX_SUBJECT) {
    return NextResponse.json({ error: `Subject must be ${MAX_SUBJECT} characters or fewer.` }, { status: 400 });
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: `Message must be ${MAX_BODY} characters or fewer.` }, { status: 400 });
  }

  // Which contacts may be addressed: super admins are unscoped, matching
  // /api/crm/contact-activities and the rules' own isTenantAdmin(). Every other
  // admin is pinned to their own tenant.
  const scope = user.isSuperAdmin ? null : user.tenantId;

  // Which account sends: always the caller's own tenant, super admin or not.
  // The Gmail connection lives at tenants/{tenantId}/integrations/{uid}_gmail,
  // so an account with no tenant has no connection to send through.
  const senderTenantId = user.tenantId;
  if (!senderTenantId) {
    return NextResponse.json(
      { error: 'No tenant associated with this account', code: 'no_tenant' },
      { status: 403 }
    );
  }

  try {
    // ── Recipient: from the contact doc, never the request ──────────────────
    const contactSnap = await adminDb.collection('contacts').doc(contactId).get();
    if (!contactSnap.exists) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const contact = contactSnap.data() || {};
    if (scope && contact.tenantId !== scope) {
      // Same response as a genuine miss — a foreign contact id must not be
      // distinguishable from a nonexistent one.
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const to = typeof contact.email === 'string' ? contact.email.trim() : '';
    if (!to) {
      return NextResponse.json(
        { error: 'This contact has no email address.', code: 'no_recipient' },
        { status: 400 }
      );
    }

    // ── Sender: the calling admin's OWN Gmail connection ────────────────────
    const integrationSnap = await adminDb
      .collection('tenants').doc(senderTenantId)
      .collection('integrations').doc(`${user.uid}_gmail`)
      .get();
    const integration = integrationSnap.exists ? integrationSnap.data() : null;
    if (!integration || integration.status !== 'active' || !integration.connectedAccountId) {
      // `code` lets the client show the "Connect your email" prompt rather than
      // a generic failure. The UI already hides the button in this state; this
      // is the server-side backstop for a stale client.
      return NextResponse.json(
        { error: 'Connect your Gmail account in Settings before sending.', code: 'not_connected' },
        { status: 409 }
      );
    }

    // ── Send ────────────────────────────────────────────────────────────────
    // executeComposioAction throws when Composio reports `successful: false`,
    // so a tool-level failure lands in the catch below and never reaches the
    // activity write.
    await executeComposioAction(
      'GMAIL_SEND_EMAIL',
      { recipient_email: to, subject, body, is_html: false },
      integration.connectedAccountId,
      senderTenantId,
      user.uid
    );

    // ── Log it, and only now ────────────────────────────────────────────────
    // Shape matches the CRM manual-add and the donation webhook so the timeline
    // renders it identically. `tenantId` is the contact's own concrete tenant so
    // the row is readable under the contactActivities rule.
    const activityTenantId = contact.tenantId || senderTenantId;
    try {
      await adminDb.collection('contactActivities').add({
        contactId,
        tenantId: activityTenantId,
        type: 'email',
        description: `Sent email: ${subject}`,
        amount: null,
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
      });
    } catch (logError) {
      // The email HAS been sent. Reporting failure here would invite the admin
      // to send it a second time — the mirror image of the silent-failure bug
      // and just as bad on pastoral correspondence. Report success, say the log
      // is missing, and capture it.
      console.error('crm send-email: sent but failed to log activity:', logError);
      captureHandledError(logError, {
        step: 'crm-send-email-log-activity',
        tenantId: activityTenantId,
        ids: { contactId },
      });
      return NextResponse.json({
        sent: true,
        logged: false,
        warning: 'The email was sent, but it could not be added to the timeline.',
      });
    }

    return NextResponse.json({ sent: true, logged: true });
  } catch (e) {
    console.error('crm send-email error:', e);
    captureHandledError(e, {
      step: 'crm-send-email',
      tenantId: senderTenantId,
      ids: { contactId },
    });
    return NextResponse.json(
      { error: 'The email could not be sent. Nothing was delivered — your message has been kept.' },
      { status: 502 }
    );
  }
}
