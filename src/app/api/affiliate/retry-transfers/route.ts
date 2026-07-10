import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { affiliateSweepIdempotencyKey } from '@/lib/affiliate-payout';

export const dynamic = 'force-dynamic';

/**
 * POST /api/affiliate/retry-transfers
 * Retries pending affiliate commission transfers.
 * Called by Vercel Cron every hour.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }
  const stripe = new Stripe(stripeKey);

  try {
    // Find pending commissions older than 5 minutes (give initial transfer time to complete)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    // Single-field filter only (status); age window applied in-memory to avoid a composite index.
    const pendingSnap = await adminDb.collection('affiliate_commissions')
      .where('status', '==', 'pending')
      .limit(200)
      .get();
    const pendingDocs = pendingSnap.docs
      .filter(d => String(d.data().createdAt || '') < fiveMinAgo)
      .slice(0, 50);

    if (pendingDocs.length === 0) {
      return NextResponse.json({ message: 'No pending commissions', processed: 0 });
    }

    let retried = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of pendingDocs) {
      const data = doc.data();
      const referrerId = data.referrerId;

      try {
        // Check referrer's Connect account status
        const referrerDoc = await adminDb.collection('users').doc(referrerId).get();
        if (!referrerDoc.exists) {
          skipped++;
          continue;
        }

        const connectAccountId = referrerDoc.data()?.affiliateStripeAccountId;
        const connectStatus = referrerDoc.data()?.affiliateConnectStatus;

        if (!connectAccountId || connectStatus !== 'active') {
          skipped++;
          continue;
        }

        // Attempt the transfer. Key it per-commission with the SAME scheme the
        // account.updated sweep uses (affiliateSweepIdempotencyKey), so this daily
        // cron and the real-time sweep can never double-pay the same commission —
        // whichever runs second gets back the original transfer. This also closes
        // the cron's own latent double-pay: a transfer that succeeds but whose
        // status write below fails would otherwise be re-sent (unkeyed) next run.
        const transfer = await stripe.transfers.create({
          amount: data.commission,
          currency: 'usd',
          destination: connectAccountId,
          metadata: {
            referrerId,
            tenantId: data.tenantId,
            plan: data.plan,
            type: data.type === 'recurring' ? 'affiliate_commission_recurring' : 'affiliate_commission',
            retry: 'true',
          },
        }, {
          idempotencyKey: affiliateSweepIdempotencyKey(doc.id),
        });

        // Update commission status
        await doc.ref.update({
          status: 'paid',
          stripeTransferId: transfer.id,
          retriedAt: new Date().toISOString(),
        });

        // Decrement pending payouts
        await adminDb.collection('users').doc(referrerId).update({
          affiliatePendingPayouts: FieldValue.increment(-(data.commission || 0)),
          updatedAt: new Date().toISOString(),
        });

        retried++;
      } catch (err) {
        console.error(`Retry transfer failed for commission ${doc.id}:`, err);
        failed++;
      }
    }

    return NextResponse.json({
      message: 'Retry complete',
      total: pendingDocs.length,
      retried,
      skipped,
      failed,
    });
  } catch (error: any) {
    console.error('Retry transfers error:', error);
    return NextResponse.json({ error: 'Failed to retry transfers' }, { status: 500 });
  }
}
