import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getTwilioConfig, sendSms, SMS_CAP_MESSAGE } from '@/lib/twilio';
import { getSmsUsageSnapshot } from '@/lib/sms-usage';
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
  // Billing tenant, resolved SERVER-SIDE from the verified token — never from
  // the request body. Only a super admin bypasses metering; a super admin's own
  // tenantId is null, and `null` here means "do not meter" so no
  // tenants/null/usage doc is ever written. Every other admin meters against a
  // real tenant id.
  const meterTenantId = authResult.isSuperAdmin ? null : tenantId;

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

  // Scheduling is NOT supported. This used to write a `status: 'scheduled'`
  // broadcast doc and return success, but nothing ever processed that
  // collection — there is no cron and no worker, and the only other reader is
  // the admin's own history list. The message was never sent while the UI
  // reported it as scheduled. Reject explicitly rather than silently ignoring
  // the field, so an API caller can't believe a send was booked. The schedule
  // picker is gone from AdminSms; build a processor before re-adding either.
  if (body.scheduledAt) {
    return NextResponse.json(
      { error: 'Scheduled broadcasts are not supported — send now instead.' },
      { status: 400 },
    );
  }

  const cfg = await getTwilioConfig(tenantId);
  if (!cfg) {
    return NextResponse.json({ error: 'Twilio is not configured.' }, { status: 400 });
  }

  // A broadcast to 500 recipients is 500+ SEGMENTS, not one send, so it is
  // metered PER RECIPIENT — each sendSms call reserves and settles its own
  // segments. Refuse up front when the tenant is already at cap, so an admin
  // gets an upgrade CTA instead of a broadcast that delivers nothing.
  if (meterTenantId) {
    const usage = await getSmsUsageSnapshot(meterTenantId);
    if (usage.smsSegmentsCap !== null && usage.smsSegmentsUsed >= usage.smsSegmentsCap) {
      return NextResponse.json(
        {
          error: SMS_CAP_MESSAGE,
          code: 'sms_cap_reached',
          used: usage.smsSegmentsUsed,
          cap: usage.smsSegmentsCap,
        },
        { status: 403 },
      );
    }
  }

  const broadcastRef = adminDb.collection('tenants').doc(tenantId).collection('smsBroadcasts').doc();

  // Send now.
  //
  // CROSSING THE CAP MID-BROADCAST: send PARTIALLY and report it precisely.
  // The alternatives are worse — refusing the whole broadcast because recipient
  // 480 of 500 wouldn't fit throws away 479 legitimate messages, and continuing
  // past the cap is the unbounded bill this cap exists to prevent. So the loop
  // stops at the first recipient the cap rejects, every remaining recipient is
  // counted as `skipped`, the history doc is written with status 'partial', and
  // the response says exactly how many were sent, how many were not, and why.
  // Truncating silently — reporting "sent" for a broadcast that stopped at 480 —
  // is the one thing this must never do.
  //
  // Non-US recipients are skipped INDIVIDUALLY (they cost nothing and consume no
  // allotment) and counted separately, so one international contact never aborts
  // a broadcast to everyone else. They are reported, not dropped quietly.
  let delivered = 0;
  let failed = 0;
  let skippedNonUs = 0;
  let capReached = false;
  let capUsed: number | undefined;
  let capLimit: number | null | undefined;
  let attempted = 0;

  for (const c of recipients) {
    const result = await sendSms(cfg, c.phone!, message, { tenantId: meterTenantId });

    if (result.code === 'sms_cap_reached') {
      // Nothing was sent for this recipient and no allotment was consumed.
      capReached = true;
      capUsed = result.used;
      capLimit = result.cap;
      break;
    }

    attempted++;
    let status: string;
    if (result.ok) {
      delivered++;
      status = 'delivered';
    } else if (result.code === 'non_us_destination' || result.code === 'invalid_destination') {
      skippedNonUs++;
      status = 'blocked';
    } else {
      failed++;
      status = 'failed';
    }

    await broadcastRef.collection('logs').add({
      phone: c.phone, status,
      errorCode: result.error || null,
      segments: result.ok ? result.segments ?? null : null,
      sentAt: new Date().toISOString(),
    }).catch(() => {});
  }

  const skipped = recipients.length - attempted;

  await broadcastRef.set({
    message, recipientGroup: group, tag: body.tag || null,
    recipientCount: recipients.length,
    sentAt: FieldValue.serverTimestamp(), scheduledAt: null,
    delivered, failed, skipped, skippedNonUs,
    status: capReached ? 'partial' : 'sent',
    capReached,
    createdBy: uid, createdAt: new Date().toISOString(),
  });

  return NextResponse.json({
    sent: true,
    delivered,
    failed,
    skipped,
    skippedNonUs,
    recipientCount: recipients.length,
    ...(capReached ? { capReached: true, error: SMS_CAP_MESSAGE, used: capUsed, cap: capLimit } : {}),
  });
}
