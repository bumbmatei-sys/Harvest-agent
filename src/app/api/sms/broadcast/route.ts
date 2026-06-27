import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getTwilioConfig, sendSms } from '@/lib/twilio';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Group = 'all_members' | 'all_donors' | 'tag';

interface ContactRow { firstName?: string; lastName?: string; phone?: string; type?: string; tags?: string[]; tenantId?: string }

/** Pull tenant contacts (single-field query) and filter to the target group + phone. */
async function resolveRecipients(tenantId: string, group: Group, tag?: string): Promise<ContactRow[]> {
  const snap = await adminDb.collection('contacts').where('tenantId', '==', tenantId).limit(5000).get();
  const all = snap.docs.map((d) => d.data() as ContactRow);
  return all.filter((c) => {
    if (!c.phone) return false;
    if (group === 'all_members') return c.type === 'member' || c.type === 'both';
    if (group === 'all_donors') return c.type === 'donor' || c.type === 'both';
    if (group === 'tag') return !!tag && Array.isArray(c.tags) && c.tags.includes(tag);
    return false;
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const { uid } = authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: { message?: string; recipientGroup?: Group; tag?: string; scheduledAt?: string; previewOnly?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const group = (body.recipientGroup || 'all_members') as Group;
  const message = (body.message || '').trim();

  const recipients = await resolveRecipients(tenantId, group, body.tag);

  // Preview: just return the count.
  if (body.previewOnly) {
    return NextResponse.json({ recipientCount: recipients.length });
  }

  if (!message) {
    return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });
  }

  const cfg = await getTwilioConfig(tenantId);
  if (!cfg) {
    return NextResponse.json({ error: 'Twilio is not configured.' }, { status: 400 });
  }

  const broadcastRef = adminDb.collection('tenants').doc(tenantId).collection('smsBroadcasts').doc();

  // Scheduled: persist for a future cron to process; don't send now.
  if (body.scheduledAt) {
    await broadcastRef.set({
      message, recipientGroup: group, tag: body.tag || null,
      recipientCount: recipients.length,
      scheduledAt: body.scheduledAt, sentAt: null,
      delivered: 0, failed: 0, status: 'scheduled',
      createdBy: uid, createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ scheduled: true, recipientCount: recipients.length });
  }

  // Send now.
  let delivered = 0;
  let failed = 0;
  for (const c of recipients) {
    const result = await sendSms(cfg, c.phone!, message);
    if (result.ok) delivered++; else failed++;
    await broadcastRef.collection('logs').add({
      phone: c.phone, status: result.ok ? 'delivered' : 'failed',
      errorCode: result.error || null, sentAt: new Date().toISOString(),
    }).catch(() => {});
  }

  await broadcastRef.set({
    message, recipientGroup: group, tag: body.tag || null,
    recipientCount: recipients.length,
    sentAt: FieldValue.serverTimestamp(), scheduledAt: null,
    delivered, failed, status: 'sent',
    createdBy: uid, createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ sent: true, delivered, failed, recipientCount: recipients.length });
}
