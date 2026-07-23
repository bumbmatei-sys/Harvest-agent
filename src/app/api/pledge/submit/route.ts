import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { adminDb } from '@/lib/firebase-admin';
import { sendAutomatedSms } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

/**
 * Public (no-auth) pledge submission. Records a pledge against an active pledge
 * campaign and sends best-effort SMS + email confirmations. All writes use the
 * admin SDK.
 */
export async function POST(request: NextRequest) {
  let body: {
    tenantId?: string;
    campaignId?: string;
    donorName?: string;
    donorEmail?: string;
    donorPhone?: string;
    pledgeAmount?: number | string;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId, campaignId } = body;
  const donorName = (body.donorName || '').trim();
  const donorEmail = (body.donorEmail || '').trim().toLowerCase();
  const donorPhone = (body.donorPhone || '').trim();
  const pledgeAmount = Number(body.pledgeAmount);
  const notes = (body.notes || '').trim();

  if (!tenantId || !campaignId || !donorName || !donorEmail || !pledgeAmount || pledgeAmount <= 0) {
    return NextResponse.json({ error: 'tenantId, campaignId, donorName, donorEmail and a pledge amount are required' }, { status: 400 });
  }

  try {
    const campSnap = await adminDb.collection('campaigns').doc(campaignId).get();
    if (!campSnap.exists) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    const campaign = campSnap.data() || {};
    if (campaign.tenantId !== tenantId || campaign.campaignType !== 'pledge' || !campaign.isActive) {
      return NextResponse.json({ error: 'This pledge campaign is not available.' }, { status: 410 });
    }

    await adminDb.collection('tenants').doc(tenantId).collection('pledges').add({
      campaignId,
      tenantId,
      donorName,
      donorEmail,
      donorPhone: donorPhone || null,
      pledgeAmount,
      paidAmount: 0,
      notes,
      dueDate: null,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
    const tenantName = tenantSnap.data()?.name || tenantSnap.data()?.displayName || 'Harvest';

    // Best-effort SMS confirmation. Routed through sendAutomatedSms so the
    // pledge trigger obeys the SAME rules as every other automated SMS:
    //   • it sends only when the admin has enabled `pledge_confirmation` with
    //     non-empty text (the AdminSms toggle) — no more hardcoded fallback that
    //     fired even with the trigger off / unconfigured;
    //   • it logs the REAL Twilio outcome (status 'delivered'/'failed' +
    //     errorCode) instead of an unconditional 'delivered'.
    // sendAutomatedSms is best-effort and never throws.
    if (donorPhone) {
      await sendAutomatedSms(tenantId, 'pledge_confirmation', donorPhone, {
        name: donorName,
        amount: String(pledgeAmount),
        tenantName,
      });
    }

    // Best-effort email confirmation.
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: donorEmail,
          subject: `Your pledge to ${campaign.title}`,
          html: `<p>Thank you, ${donorName}!</p><p>Your pledge of <strong>$${pledgeAmount}</strong> to <strong>${campaign.title}</strong> has been recorded. We'll be in touch.</p><br><p>— ${tenantName}</p>`,
        });
      } catch (e) { console.warn('Pledge email confirmation failed:', e); }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Pledge submit error:', e);
    return NextResponse.json({ error: 'Failed to record pledge' }, { status: 500 });
  }
}
