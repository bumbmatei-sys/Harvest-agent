import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { deriveConnectStatus } from '@/lib/stripe-connect-status';
import { sweepPendingAffiliateCommissions } from '@/lib/affiliate-payout';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import {
  finalizePartnershipSubscription,
  incrementCampaignRaised,
  recordOneTimeDonation,
  recordPartnershipRenewalDonation,
} from '@/lib/donation-webhook';

export const dynamic = 'force-dynamic';

/**
 * Connected-account webhook (separate Stripe endpoint from the main platform
 * webhook, with its OWN signing secret STRIPE_CONNECT_WEBHOOK_SECRET). Structure
 * mirrors src/app/api/stripe/webhook/route.ts: verify the signature FIRST, then
 * dedup, then process.
 *
 * It handles two unrelated families of event:
 *
 *  1. `account.updated` — syncs the church's Connect payout status onto its
 *     tenant doc AND mirrors it onto the tenant owner's user doc so the ONE
 *     account powers donations and affiliate payouts alike, then sweeps any
 *     affiliate commissions banked `pending`. Untouched by THE-145.
 *
 *  2. 🔴 THE DONATIONS THEMSELVES (THE-145). A donation is now a DIRECT charge
 *     created on the church's connected account, so Stripe delivers its
 *     lifecycle events HERE rather than to the platform endpoint — Stripe's own
 *     scoping table puts "direct charges paid to connected accounts" and
 *     "updates to Invoices and Subscriptions that connected accounts charge
 *     their customers using direct charges" in the Connected accounts scope.
 *     Without these cases every donation would succeed at Stripe and Harvest
 *     would record nothing: no CRM activity, no receipt PDF, no `totalDonated`,
 *     no donor profile. That is why the charge change and this one are one PR.
 *
 * ⚠️ EVERY STRIPE READ IN THE DONATION PATH IS SCOPED TO THE CONNECTED ACCOUNT.
 * The Session, the PaymentIntent, the Subscription and the Invoice all live on
 * the connected account now; a platform-scoped `retrieve` 404s — silently, if it
 * is inside a `try`. The scope comes from `event.account`, which Stripe sets on
 * every Connect-scoped delivery, NOT from anything in the payload body.
 *
 * ⚠️ The tenant is resolved from `metadata.tenantId`, exactly as on the platform
 * endpoint. `event.account` is the CHURCH'S STRIPE ACCOUNT, not a tenant id.
 *
 * ⚠️ The bookkeeping itself is imported, never re-implemented — the same
 * functions the platform endpoint calls. Two copies of the code that writes CRM
 * activity, receipts and `totalDonated` is the duplicated-fact shape this
 * project keeps paying for.
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

    // 🔴 THE SCOPE FOR EVERY STRIPE READ BELOW. On a direct charge the Session,
    // the PaymentIntent, the Subscription and the Invoice all live on the
    // CONNECTED account — a platform-scoped `retrieve` 404s, and inside a `try`
    // it does so silently. `event.account` is set by Stripe on Connect-scoped
    // deliveries and is part of the signature-verified payload.
    //
    // `undefined` when absent rather than a bogus id: stripe-node then makes a
    // plain platform-scoped call, which is correct for `account.updated`
    // (delivered without an `account` field on some paths) and fails loudly
    // rather than quietly against the wrong account for anything else.
    const connectedAccount = event.account ? { stripeAccount: event.account } : undefined;

    switch (event.type) {
      case 'account.updated': {
        // Read status ONLY from the signature-verified account object — never from
        // any unverified request input. Shared helper keeps this byte-identical to
        // the Connect callback so the two paths can't drift.
        const account = event.data.object as Stripe.Account;
        const status = deriveConnectStatus(account);

        // An account.updated can belong to a tenant (the church's unified
        // donations/canonical account), to standalone affiliate users who connected
        // Connect for payouts ONLY (they have NO tenant — that's the whole point of
        // the affiliate track), to BOTH, or — legitimately — to NEITHER. These two
        // lookups are INDEPENDENT, so resolve both up front and act on each on its
        // own merits. Resolve strictly via the verified account id (there is no
        // tenantId / userId in the body to trust).
        //
        // The tenant lookup previously early-returned when empty, which made the
        // affiliate status-sync + sweep below dead code for exactly the standalone
        // affiliates it was meant to serve — a tenant-less affiliate never had a
        // tenant row to match, so the route returned before ever reaching them.
        // The account id lives on the server-only tenant_private doc (whose id
        // IS the tenantId); the status stays on the public tenant doc.
        const tenantsSnapshot = await adminDb.collection('tenant_private')
          .where('stripeConnectAccountId', '==', account.id)
          .limit(1)
          .get();

        // The SAME account also powers affiliate payouts. Any user who set up payouts
        // against it had it mirrored onto their own doc (affiliateStripeAccountId ==
        // account.id): for a tenant's unified account that's the owner (+ any other
        // admin/affiliate on the tenant); for a standalone affiliate it's just that
        // one user, with no tenant at all.
        const linkedUsersSnap = await adminDb.collection('users')
          .where('affiliateStripeAccountId', '==', account.id)
          .get();

        if (tenantsSnapshot.empty && linkedUsersSnap.empty) {
          // Only when BOTH are empty is this a genuinely unknown account (or one not
          // yet linked). Return 200 so Stripe stops retrying — a benign "unknown
          // account", not a processing failure. An account with affiliate users but
          // no tenant must NOT fall through here — that is the standalone-affiliate
          // path, handled below.
          console.log(`ℹ️ No tenant or affiliate user found for Connect account ${account.id}`);
          return NextResponse.json({ received: true });
        }

        // Tenant path — runs only if a tenant is linked (church donations/canonical
        // account). A real write failure here bubbles to the catch → 500 → Stripe
        // retries, and the idempotency marker undo makes that retry safe.
        const tenantDoc = tenantsSnapshot.empty ? null : tenantsSnapshot.docs[0];
        if (tenantDoc) {
          await adminDb.collection('tenants').doc(tenantDoc.id).update({
            stripeConnectStatus: status,
            updatedAt: new Date().toISOString(),
          });
        }

        // Affiliate path — runs INDEPENDENTLY of whether a tenant was found. This
        // single account.updated reconciles affiliate status for EVERY linked user
        // (a standalone affiliate, or the owner + any other admin/affiliate on a
        // tenant) — keeping ALL consumers in sync off one account. A batch write
        // failure bubbles to the catch → 500 → safe (idempotent) retry.
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
        // affiliate payouts resolve THIS same account, so we sweep with
        // connectAccountId = account.id for each. Only on `active` —
        // `restricted`/`pending` are not payout-ready. This is the fix's payoff: a
        // standalone affiliate (no tenant) is now paid on activation instead of
        // waiting up to 24h for the daily retry-transfers cron.
        //
        // Resilience: each user's sweep is wrapped so a failure NEVER 500s the
        // webhook. The status write(s) above must stick; a stuck commission is not
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
              // Warning, not error: the commissions stay `pending` and both a
              // future account.updated and the daily retry-transfers cron will
              // pick them up, idempotently. But a sweep that keeps failing means
              // an affiliate is not being paid, and nothing else says so.
              console.error(`Affiliate sweep failed for ${userDoc.id} on ${account.id} (will retry on redelivery / cron):`, sweepErr);
              captureMoneyPathError(sweepErr, {
                step: 'connect-webhook-affiliate-sweep',
                level: 'warning',
                eventId: event.id,
                eventType: event.type,
                ids: { referrerId: userDoc.id, connectAccountId: account.id },
              });
            }
          }
        }

        console.log(`✅ Connect account ${account.id} → ${status}${tenantDoc ? ` for tenant ${tenantDoc.id}` : ' (affiliate-only, no tenant)'}`);
        break;
      }

      // ── Donations, which are direct charges on this connected account ──────
      //
      // `connectedAccount` is the scope EVERY Stripe read below is made under.
      // Stripe sets `event.account` on Connect-scoped deliveries; it is part of
      // the signed payload, so it is as trustworthy as the event itself.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = session.subscription as string | null;

        // 🔴 ONE-TIME GIFTS ARE NOT RECORDED HERE. A one-time donation's session
        // has no subscription, and its money is recorded from
        // payment_intent.succeeded below — the only place that carries the
        // partnership metadata for a one-time gift. Recording it here as well
        // would double every one-time donation, because the session and the
        // PaymentIntent are DISTINCT events whose ids the webhook_events marker
        // cannot dedup across.
        if (!subscriptionId) break;

        let subObj: Stripe.Subscription | null = null;
        try {
          // `undefined` params, options third: `subscriptions.retrieve` takes
          // (id, params, options) positionally, so the account scope only lands
          // in the Stripe-Account header from the THIRD slot.
          subObj = await stripe.subscriptions.retrieve(subscriptionId, undefined, connectedAccount);
        } catch (subErr) {
          console.error('Connect webhook: failed to retrieve subscription metadata:', subErr);
          captureMoneyPathError(subErr, {
            step: 'connect-subscription-metadata-load',
            level: 'warning',
            eventId: event.id,
            eventType: event.type,
            ids: { subscriptionId, connectAccountId: event.account },
          });
          // Without the metadata we cannot tell a monthly partnership from any
          // other subscription on this account, and a partner's opening gift
          // would be silently lost. Undo the marker and 5xx so Stripe redelivers.
          await eventRef.delete().catch(() => { /* best effort */ });
          return NextResponse.json({ error: 'Could not load subscription metadata; will retry' }, { status: 503 });
        }

        const meta = (subObj.metadata || {}) as Record<string, string>;
        // A connected account may run subscriptions of its own that have nothing
        // to do with Harvest. Only a Harvest donation carries this marker.
        if (meta.type !== 'partnership') {
          console.log(`ℹ️ Non-partnership subscription ${subscriptionId} on ${event.account} — nothing to record`);
          break;
        }

        await finalizePartnershipSubscription(session, subObj, meta);
        break;
      }

      case 'payment_intent.succeeded': {
        // One-time gifts. The PaymentIntent arrives complete on the verified
        // event, so there is no Stripe read to scope — and the recorder itself
        // ignores anything without `type: 'partnership'`.
        await recordOneTimeDonation(event.data.object as Stripe.PaymentIntent);
        break;
      }

      case 'invoice.payment_succeeded': {
        // Every month AFTER a monthly partner's first. Without this a partner's
        // giving statement shows one month forever and their `totalDonated`
        // freezes after the opening gift.
        //
        // ⚠️ ONLY the donation half of the platform endpoint's handler belongs
        // here. Tenant reactivation and affiliate commissions key off a CHURCH'S
        // OWN plan subscription, which is billed by Dodo/Stripe on the PLATFORM
        // account and never reaches this endpoint.
        const invoice = event.data.object as Stripe.Invoice;
        // Same off-type read the platform route documents: `subscription` was
        // removed from Stripe's Invoice type but is still on the wire.
        const invoiceSubId = (invoice as unknown as { subscription?: string | null }).subscription ?? null;
        if (!invoiceSubId) break;

        let subMeta: Record<string, string> = {};
        try {
          const sub = await stripe.subscriptions.retrieve(invoiceSubId, undefined, connectedAccount);
          subMeta = (sub.metadata || {}) as Record<string, string>;
        } catch (subErr) {
          console.error('Connect webhook: failed to retrieve subscription for invoice.payment_succeeded:', subErr);
          captureMoneyPathError(subErr, {
            step: 'connect-invoice-payment-succeeded-subscription-load',
            level: 'warning',
            eventId: event.id,
            eventType: event.type,
            ids: { subscriptionId: invoiceSubId, invoiceId: invoice.id, connectAccountId: event.account },
          });
          // A renewal gift with no receipt and no CRM credit. Retry it rather
          // than 200 it away — the recorders are idempotent per invoice id.
          await eventRef.delete().catch(() => { /* best effort */ });
          return NextResponse.json({ error: 'Could not load subscription metadata; will retry' }, { status: 503 });
        }

        const tenantId = subMeta.tenantId;
        // The OPENING month arrives as billing_reason 'subscription_create' and is
        // already recorded by checkout.session.completed above. The two are
        // DISTINCT events, so the webhook_events marker cannot dedup across them;
        // this guard is what stops month one from counting twice.
        const isPartnershipRenewal =
          subMeta.type === 'partnership' &&
          (invoice as any).billing_reason !== 'subscription_create';

        if (!isPartnershipRenewal || !tenantId) break;

        if (subMeta.campaignId) {
          await incrementCampaignRaised({
            campaignId: subMeta.campaignId,
            tenantId,
            amountDollars: (invoice.amount_paid || 0) / 100,
            paymentId: invoice.id,
          });
        }

        await recordPartnershipRenewalDonation({ invoice, subMeta, tenantId });
        break;
      }

      default:
        console.log(`Unhandled connect event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Connect webhook handler error:', error?.message || error);
    // Warning: the marker undo below makes Stripe's redelivery safe, so one
    // failure self-heals. A persistent one does not — Connect payout status stops
    // syncing onto tenants and affiliates entirely, and Stripe eventually gives up.
    captureMoneyPathError(error, {
      step: 'connect-webhook',
      level: 'warning',
      eventId: event.id,
      eventType: event.type,
    });
    if (markerWritten) {
      // Undo the idempotency marker so Stripe's retry re-processes this event.
      // Without this, a mid-processing failure leaves the event marked "done" and
      // the redelivery is skipped as a duplicate — silently losing the event.
      await eventRef.delete().catch(() => { /* best effort */ });
    }
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
