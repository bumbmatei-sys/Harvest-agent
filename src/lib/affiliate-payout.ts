import type Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Stable, per-commission idempotency key for an affiliate-payout transfer.
 *
 * This is THE money-path invariant that makes affiliate payouts safe to run
 * repeatedly AND concurrently. Any code path that transfers a given commission
 * derives the SAME key from the commission's Firestore doc id, so Stripe
 * collapses redeliveries, crash-retries, and a race between the account.updated
 * sweep and the daily retry-transfers cron into ONE transfer — the second
 * attempt gets back the ORIGINAL transfer instead of moving money twice.
 *
 * Keep EVERY affiliate-payout transfer keyed through this function. A divergent
 * (or absent) key on any path reintroduces double-pay.
 */
export function affiliateSweepIdempotencyKey(commissionId: string): string {
  return `aff_sweep_${commissionId}`;
}

export interface SweepResult {
  /** Eligible pending commissions considered (status 'pending', commission > 0). */
  total: number;
  /** Of those, successfully transferred AND flipped to 'paid'. */
  swept: number;
}

/**
 * Backfill: sweep ONE affiliate's outstanding `pending` commissions to `paid`
 * once their Stripe Connect account is payout-ready.
 *
 * A commission is written `pending` when it is earned BEFORE the affiliate has
 * connected Connect — the webhook can't transfer to an account that doesn't
 * exist yet, so it banks the amount and bumps `affiliatePendingPayouts`. Nothing
 * then moved that money when the affiliate later connected (the daily cron is a
 * once-a-day backstop). This function does it at the moment of activation: for
 * each pending commission it creates the Stripe transfer to `connectAccountId`,
 * flips the doc to `paid`, and decrements the affiliate's
 * `affiliatePendingPayouts` counter by exactly the swept amount.
 *
 * Money-path guarantees:
 *  - Idempotent (two independent double-pay guards):
 *      1. Each transfer uses a stable per-commission idempotency key
 *         (affiliateSweepIdempotencyKey), so a redelivered / re-run / raced
 *         sweep returns the ORIGINAL transfer instead of paying twice.
 *      2. The status flips to `paid`, so the next sweep's `pending`-only query
 *         no longer sees it at all.
 *  - `affiliateEarnings` (lifetime) is NOT touched — it already counted this
 *    commission when the pending row was created. Sweeping pending→paid moves
 *    money that was already earned; it is not new earnings.
 *  - The paid-flip and the counter decrement commit in ONE batch, so a mid-sweep
 *    failure can never leave a `paid` commission with an un-decremented counter
 *    (or vice-versa).
 *  - Partial failure is isolated: one commission's transfer failing leaves THAT
 *    commission `pending` and continues with the rest; the caller learns how many
 *    actually swept.
 *  - Never creates a zero / negative transfer, and never re-pays a commission
 *    that is already `paid` / `failed` / `cancelled`.
 */
export async function sweepPendingAffiliateCommissions(opts: {
  stripe: Stripe;
  referrerId: string;
  connectAccountId: string;
}): Promise<SweepResult> {
  const { stripe, referrerId, connectAccountId } = opts;

  // Guardrail: without a destination account there is nowhere to pay to, and
  // without a referrer there is no counter to adjust — do nothing.
  if (!connectAccountId || !referrerId) return { total: 0, swept: 0 };

  // Single-field query (referrerId) → no composite index needed, matching how the
  // affiliate status route reads commissions. Filter to still-`pending`, positive
  // rows in memory so we never require a (referrerId, status) composite index and
  // never touch a paid/failed/cancelled row.
  const snap = await adminDb.collection('affiliate_commissions')
    .where('referrerId', '==', referrerId)
    .get();

  const pending = snap.docs.filter((d) => {
    const c = d.data();
    return c.status === 'pending' && Number(c.commission) > 0;
  });

  let swept = 0;
  for (const doc of pending) {
    const commission = Number(doc.data().commission);
    // Redundant with the filter above, but an explicit money-path guard: a Stripe
    // transfer must never be zero or negative.
    if (!(commission > 0)) continue;

    try {
      const transfer = await stripe.transfers.create({
        amount: commission,
        currency: 'usd',
        destination: connectAccountId,
        metadata: {
          referrerId,
          commissionId: doc.id,
          type: 'affiliate_commission_sweep',
        },
      }, {
        // See affiliateSweepIdempotencyKey: stable per commission, so a retry —
        // whether a redelivered account.updated, a crash between the transfer and
        // the doc-write, or the daily cron racing this sweep — returns the
        // original transfer rather than issuing a second one.
        idempotencyKey: affiliateSweepIdempotencyKey(doc.id),
      });

      // Atomically flip the commission to `paid` AND move the money out of the
      // affiliate's pending-payout counter. Batching the two writes means a
      // partial failure can't desync them. Lifetime `affiliateEarnings` is left
      // untouched — it already included this commission when it was pending.
      const batch = adminDb.batch();
      batch.update(doc.ref, {
        status: 'paid',
        stripeTransferId: transfer.id,
        paidAt: new Date().toISOString(),
      });
      batch.update(adminDb.collection('users').doc(referrerId), {
        affiliatePendingPayouts: FieldValue.increment(-commission),
        updatedAt: new Date().toISOString(),
      });
      await batch.commit();

      swept++;
    } catch (transferErr) {
      // One bad transfer must not block the others or fail the caller. Leave this
      // commission `pending`; the idempotency key means the next attempt (a later
      // account.updated redelivery or the daily retry-transfers cron) re-tries it
      // safely without any risk of double-paying.
      console.error(
        `Affiliate sweep failed for commission ${doc.id} (referrer ${referrerId}); leaving pending:`,
        transferErr,
      );
    }
  }

  return { total: pending.length, swept };
}
