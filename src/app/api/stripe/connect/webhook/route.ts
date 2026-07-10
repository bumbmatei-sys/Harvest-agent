import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { deriveConnectStatus } from '@/lib/stripe-connect-status';
import { sweepPendingAffiliateCommissions } from '@/lib/affiliate-payout';

export const dynamic = 'force-dynamic';

/**
 * Connected-account webhook (separate Stripe endpoint from the main platform
 * webhook, with its OWN signing secret STRIPE_CONNECT_WEBHOOK_SECRET). It listens
 * to `account.updated` and syncs the church's Connect payout status onto its
 * tenant doc AND mirrors it onto the tenant owner's user doc so the ONE account
 * powers donations and affiliate payouts alike. Structure mirrors
 * src/app/api/stripe/webhook/route.ts: verify the signature FIRST, then dedup,
 * then process.
 */
export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  // This endpoint has its own signing secret — NOT the main STRIPE_WEBHOOK_SECRET.
  const connectWebhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!stripeKey || !connectWebhookSecret) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_CONNECT_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // Security boundary: never parse the body before the signature is verified. A
  // forged `account.updated` must not be able to flip a tenant to `active`.
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, connectWebhookSecret);
  } catch (err) {
    console.error('Connect webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency marker + whether THIS invocation wrote it. On failure we undo only
  // a marker of our own — never one left by an earlier successful run (e.g. Stripe
  // redelivers a completed event and the dedup read fails transiently: deleting that
  // marker would let the retry double-process the event).
  const eventRef = adminDb.collection('webhook_events').doc(event.id);
  let markerWritten = false;

  try {
    const eventDoc = await eventRef.get();
    if (eventDoc.exists) {
      console.log(`⏭️ Skipping duplicate connect webhook event ${event.id}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
    markerWritten = true; // flipped before the write so an ambiguous set() failure still gets undone
    await eventRef.set({ type: event.type, processedAt: new Date().toISOString() });

    switch (event.type) {
      case 'account.updated': {
        // Read status ONLY from the signature-verified account object — never from
        // any unverified request input. Shared helper keeps this byte-identical to
        // the Connect callback so the two paths can't drift.
        const account = event.data.object as Stripe.Account;
        const status = deriveConnectStatus(account);

        // Resolve the tenant strictly via the verified account id (there is no
        // tenantId in the body to trust). The unified account is the tenant's
        // single donations/canonical account.
        const tenantsSnapshot = await adminDb.collection('tenants')
          .where('stripeConnectAccountId', '==', account.id)
          .limit(1)
          .get();

        if (tenantsSnapshot.empty) {
          // Not an account we track (or not yet linked). Return 200 so Stripe stops
          // retrying — this is a benign "unknown account", not a processing failure.
          console.log(`ℹ️ No tenant found for Connect account ${account.id}`);
          return NextResponse.json({ received: true });
        }

        const tenantDoc = tenantsSnapshot.docs[0];

        // A real write failure here bubbles to the catch → 500 → Stripe retries,
        // and the idempotency marker undo makes that retry safe.
        await tenantDoc.ref.update({
          stripeConnectStatus: status,
          updatedAt: new Date().toISOString(),
        });

        // Unified account: the SAME account also powers affiliate payouts. Any user
        // who set up payouts against it had it mirrored onto their own doc
        // (affiliateStripeAccountId == account.id), so this single account.updated
        // reconciles affiliate status for EVERY linked user (owner + any other
        // admin/affiliate on the tenant) — keeping ALL consumers in sync, one account.
        const linkedUsersSnap = await adminDb.collection('users')
          .where('affiliateStripeAccountId', '==', account.id)
          .get();
        if (!linkedUsersSnap.empty) {
          const batch = adminDb.batch();
          linkedUsersSnap.docs.forEach(d => batch.update(d.ref, {
            affiliateConnectStatus: status,
            updatedAt: new Date().toISOString(),
          }));
          await batch.commit();
        }

        // Backfill: the moment this account becomes payout-ready, sweep any
        // affiliate commissions that were banked `pending` because the affiliate
        // hadn't connected Connect when they earned them. Each linked user's
        // affiliate payouts resolve THIS same account (the unified account), so we
        // sweep with connectAccountId = account.id for each. Only on `active` —
        // `restricted`/`pending` are not payout-ready.
        //
        // Resilience: each user's sweep is wrapped so a failure NEVER 500s the
        // webhook. The status write above must stick; a stuck commission is not
        // lost — it stays `pending` and is retried by a future account.updated or
        // the daily retry-transfers cron, both idempotent via the per-commission
        // transfer key. (One user failing must not block another, either.)
        if (status === 'active' && !linkedUsersSnap.empty) {
          for (const userDoc of linkedUsersSnap.docs) {
            try {
              const { swept, total } = await sweepPendingAffiliateCommissions({
                stripe,
                referrerId: userDoc.id,
                connectAccountId: account.id,
              });
              if (total > 0) {
                console.log(`💸 Swept ${swept}/${total} pending affiliate commission(s) for ${userDoc.id} on ${account.id}`);
              }
            } catch (sweepErr) {
              console.error(`Affiliate sweep failed for ${userDoc.id} on ${account.id} (will retry on redelivery / cron):`, sweepErr);
            }
          }
        }

        console.log(`✅ Connect account ${account.id} → ${status} for tenant ${tenantDoc.id}`);
        break;
      }

      default:
        // The dashboard endpoint is scoped to account.updated, but stay defensive.
        console.log(`Unhandled connect event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Connect webhook handler error:', error?.message || error);
    if (markerWritten) {
      // Undo the idempotency marker so Stripe's retry re-processes this event.
      // Without this, a mid-processing failure leaves the event marked "done" and
      // the redelivery is skipped as a duplicate — silently losing the event.
      await eventRef.delete().catch(() => { /* best effort */ });
    }
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
