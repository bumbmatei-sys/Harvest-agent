import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate, DODO_ON_HOLD_FIELD } from '@/lib/tenant-private';
import { PLATFORM_FEE_MAP as FEE_MAP } from '@/lib/stripe-connect';
import {
  GIVING_UNAVAILABLE_MESSAGE,
  resolveEffectiveTenantStatus,
  tenantAllows,
} from '@/lib/tenant-lifecycle';
import { convergeExpiredDodoGrace } from '@/lib/dodo/lifecycle';
import { verifyAuth } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

// The platform/apex "tenant" is not a real subdomain — donations to it stay on
// the apex. Any other tenantId is a live subdomain (tenants/{id}.id == subdomain).
const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

export async function POST(request: NextRequest) {
  try {
    // Public giving: donations must work for anonymous and cross-church donors.
    // The donor pays through Stripe Checkout, so an open endpoint has no abuse vector
    // (an unpaid session expires and records nothing).
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const body = await request.json();
    // Accept fields at the top level OR nested under `metadata` (the campaign widget nests them).
    const src = { ...(body.metadata || {}), ...body };
    const { amount, tenantId, donationType, donorEmail, donorName, campaignId } = src;

    if (!amount || !tenantId || !donationType) {
      return NextResponse.json({ error: 'Missing required fields: amount, tenantId, donationType' }, { status: 400 });
    }

    // Optional auth: this endpoint is public (anonymous/cross-church giving), but
    // an in-app donor sends a Bearer token (authFetch). When present, capture their
    // account email + uid so the webhook can link the donation to their CRM contact
    // and move them member→donor. Falls back to the body's donorEmail for anonymous
    // donors. Without this, pi.receipt_email is null and CRM linkage never fires.
    const authedUser = await verifyAuth(request);
    const effectiveDonorEmail = (donorEmail || authedUser?.email || '').trim();
    const donorUserId = authedUser?.uid || '';

    // Validate donation amount (Stripe minimum $0.50, max $100,000)
    if (typeof amount !== 'number' || amount < 50 || amount > 10000000) {
      return NextResponse.json({ error: 'Invalid donation amount. Must be between $0.50 and $100,000.' }, { status: 400 });
    }

    if (donationType !== 'one-time' && donationType !== 'monthly') {
      return NextResponse.json({ error: 'donationType must be "one-time" or "monthly"' }, { status: 400 });
    }

    // Look up tenant
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenantData = tenantDoc.data()!;

    // 🔴 GIVING STOPS WHEN THE LIFECYCLE SAYS SO — the one gate this PR enforces
    // on the SERVER rather than in the UI.
    //
    // Everything else REP-4 stops (publishing, sending) is client-gated for now,
    // because a hidden button is enough until someone has an incentive to beat
    // it. Giving is different on both counts: it is money, and at a 0% platform
    // fee a live donate page is the most valuable surface in the product, so a
    // cancelled church left with one is the product given away for free
    // indefinitely. It is also a SINGLE ROUTE, which makes the server gate one
    // check rather than a sweep.
    //
    // ⚠️ Placed BEFORE the Connect lookup and before either checkout branch, so
    // one-time and monthly are both refused by the same line — a gate on only
    // one of them is a gate on neither.
    //
    // ⚠️ `stripe-connect.ts` IS NOT TOUCHED. Donations are Stripe Connect
    // destination charges into the church's own account at 0%, and that module
    // stays exactly as it is; the gate belongs on the route, which is the thing
    // that decides whether a checkout happens at all.
    //
    // ⚠️ The private doc is read BEFORE the gate now, because the gate needs it.
    // This costs NOTHING: the Connect account id below came from the same
    // document and the same read, which is now simply hoisted above the check
    // rather than performed after it.
    const tenantPrivate = await getTenantPrivate(tenantId);

    // 🔴 AND THE GRACE TIMER BITES HERE. A church whose renewal failed is still
    // recorded `active` — Dodo never sends a terminal event for a subscription
    // that stays `on_hold`, so nothing has rewritten the status. The deadline
    // lives on the SERVER-ONLY private doc (a billing-trouble timestamp on the
    // world-readable tenant doc would publish a named church's failed card), and
    // `resolveEffectiveTenantStatus` turns it into the status to ENFORCE.
    //
    // Inside the window this returns the recorded status untouched, so a church
    // in grace keeps its donate page for the full 21 days. Past it, the answer is
    // the archived state and the existing capability table refuses giving with no
    // second list of rules to keep in step.
    const effectiveStatus = resolveEffectiveTenantStatus({
      status: tenantData.status,
      onHoldAt: tenantPrivate[DODO_ON_HOLD_FIELD],
      now: Date.now(),
    });

    if (!tenantAllows(effectiveStatus, 'giving')) {
      // The enforced answer and the recorded one disagree exactly when the timer
      // has fired and nothing has written it down yet. Converge — through the
      // same guarded path the terminal events use, so a Stripe-owned or
      // conflict-owned tenant is refused there rather than trusted here.
      //
      // ⚠️ AFTER the decision to refuse and never in front of it. This is a
      // best-effort write on a request that is already returning 403; if it
      // fails, the donor still gets the same refusal and the next request tries
      // again. Enforcement never waits on the bookkeeping.
      if (effectiveStatus !== tenantData.status) {
        try {
          await convergeExpiredDodoGrace(tenantId, Date.now());
        } catch (convergeErr) {
          console.error(`[dodo] Could not converge expired grace for tenant ${tenantId}:`, convergeErr);
          captureMoneyPathError(convergeErr, {
            step: 'dodo-grace-converge',
            level: 'warning',
            tenantId,
          });
        }
      }

      // 403, not 409: the request is fine and this donor is not at fault — the
      // ministry is not open for giving. The message says nothing about billing,
      // because the reader is a donor and a church's subscription status is not
      // theirs to be told.
      return NextResponse.json({ error: GIVING_UNAVAILABLE_MESSAGE }, { status: 403 });
    }

    const connectAccountId = tenantPrivate.stripeConnectAccountId;
    const plan = tenantData.plan || 'plus';

    if (!connectAccountId) {
      return NextResponse.json({ error: 'This ministry has not set up payments yet' }, { status: 400 });
    }

    const feePercent = FEE_MAP[plan] ?? 0;
    const applicationFeeAmount = Math.round(amount * feePercent);

    // 🔴 WHO THE DONOR'S CARD STATEMENT NAMES — the church, not Harvest.
    //
    // Both branches below create DESTINATION charges (transfer_data.destination =
    // the church's connected account). Stripe: "If `on_behalf_of` is omitted, the
    // platform is the business of record for the payment." Omitting it made
    // Harvest the business of record on every donation to every church, which
    // contradicts the reason donations stayed on Stripe at all: a
    // merchant-of-record structure is incompatible with 501(c)(3) substantiation.
    // Subscriptions moved to Dodo precisely so this path would not have to.
    //
    // Setting it makes the CHURCH the settlement merchant, which per Stripe's
    // destination-charge docs changes three things that matter here:
    //   - charges settle in the church's country and settlement currency (a
    //     verified sandbox donation charged usd and settled RON, because
    //     settlement followed the PLATFORM);
    //   - the church's fee structure applies;
    //   - the church's statement descriptor — not `THE HARVEST SANDBOX` — is what
    //     the donor sees, which is the difference between a recognised gift and a
    //     chargeback.
    //
    // ⚠️ IT DOES NOT MOVE LIABILITY, and no comment here should imply it does.
    // Stripe, verbatim: "For destination charges, with or without `on_behalf_of`,
    // Stripe debits dispute amounts and fees from your platform account." Disputes
    // and refunds stay with Harvest either way. Moving that is the direct- vs
    // destination-charge decision, which is a different and larger change.
    //
    // ⚠️ AND IT DOES NOT TOUCH THE FEE. `application_fee_amount` /
    // `application_fee_percent` below are computed above from PLATFORM_FEE_MAP and
    // are unchanged — 0 on every tier. `on_behalf_of` selects the settlement
    // merchant; it is not a fee parameter.
    //
    // ─── WHY THIS IS GATED, AND ON WHAT ──────────────────────────────────────
    //
    // Stripe: "The `on_behalf_of` parameter is supported only for connected
    // accounts with a payments capability such as `card_payments`." Sending it to
    // an account without one is an API error — which, from this route, means the
    // Checkout Session throws and the DONOR SEES A FAILED DONATION. So it can only
    // be sent where it is known to be accepted.
    //
    // 🔴 The capability itself is NOT stored anywhere, and this route deliberately
    // does not call Stripe to ask: an extra `accounts.retrieve` on the donate path
    // would put a network round-trip in front of every gift. What IS already on
    // the tenant doc read above is `stripeConnectStatus`, mirrored by the Connect
    // webhook (`account.updated`) and the onboarding callback, both via
    // `deriveConnectStatus` — 'active' exactly when Stripe reports
    // `charges_enabled && payouts_enabled`.
    //
    // `charges_enabled` is Stripe's own summary of "the account can process
    // charges", which an account cannot do without an active payments capability.
    // So 'active' ⟹ the capability is present. That direction is sound and it is
    // the only one being relied on.
    //
    // ⚠️ THE CONVERSE IS NOT TRUE and must not be read into this. 'pending' and
    // 'restricted' mean "payouts are off" or "Stripe has fresh `currently_due`
    // requirements" — an account in either state may well still hold
    // `card_payments`. This gate is therefore CONSERVATIVE, not precise: it is a
    // sufficient condition, not a necessary one, and it under-applies rather than
    // risking a rejected donation. THE-137 made the same call in the opposite
    // direction for the same reason (see the login-link route) — 'active' is too
    // coarse to gate a church out of its own dashboard, and here it is too coarse
    // to gate a church out of its own donations, so the fallback keeps giving up.
    const canSettleAsChurch = tenantData.stripeConnectStatus === 'active';

    // 🔴 THE FALLBACK IS LOUD. Refusing the donation was the alternative, and it
    // was rejected: the gate above cannot tell "capability lapsed" from "payouts
    // not enabled yet", so refusing would take a working donate page away from
    // every church that is merely mid-onboarding — turning an attribution fix into
    // an outage on the one surface that must never go down.
    //
    // But a church whose donations quietly revert to settling as Harvest is
    // exactly the defect this ticket exists to fix, so the fallback is never
    // silent. This names the tenant and the status that produced it, so the church
    // still settling as Harvest can be found and finished rather than discovered
    // by a donor reading their card statement.
    //
    // `warning`, not `error`, and deliberately: the donation SUCCEEDS and the
    // church receives the whole gift — nothing is lost and no money is stranded.
    // It also self-heals, because the next `account.updated` that flips this
    // tenant to 'active' makes every subsequent donation carry `on_behalf_of` with
    // no intervention. Raising `error` on every gift to every not-yet-onboarded
    // church would bury the `money_path:true` alert that exists to mean a payment
    // actually broke.
    if (!canSettleAsChurch) {
      console.warn(
        `[donate] Tenant ${tenantId} has Connect status '${tenantData.stripeConnectStatus ?? 'unset'}' — ` +
        'donation will settle with Harvest as the business of record, not the church.'
      );
      captureMoneyPathError(
        new Error('Donation settling as the platform: Connect account is not confirmed payments-capable'),
        {
          step: 'donate-settlement-merchant-fallback',
          level: 'warning',
          tenantId,
          ids: {
            connectAccountId,
            // Defaulted rather than left undefined: `buildDetails` drops falsy
            // ids, and "no status recorded at all" is the case most worth seeing.
            connectStatus: tenantData.stripeConnectStatus ?? 'unset',
          },
        },
      );
    }

    // Undefined is omitted by stripe-node on the wire, same as `customer_email`
    // below — so the fallback sends exactly today's request, unchanged.
    const settlementAccountId = canSettleAsChurch ? connectAccountId : undefined;

    // Return the donor to the TENANT'S subdomain after checkout, not the apex.
    // Same bug class as the Connect callback fix (#114): building from
    // NEXT_PUBLIC_APP_URL drops tenant context (bumb.theharvest.app → theharvest.app).
    // The platform/apex "tenant" has no real subdomain, so it stays on the apex.
    const apexBase = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'theharvest.app';
    const isPlatform = tenantId === PLATFORM_TENANT_ID;
    const returnBase = isPlatform ? apexBase : `https://${tenantId}.${rootDomain}`;

    if (donationType === 'one-time') {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'One-Time Donation',
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          transfer_data: {
            destination: connectAccountId,
          },
          // The church is the business of record for this gift. See the block
          // above for why this is gated and why the fallback is reported.
          on_behalf_of: settlementAccountId,
          application_fee_amount: applicationFeeAmount,
          metadata: {
            tenantId,
            type: 'partnership',
            donationType,
            campaignId: campaignId || '',
            donorName: donorName || '',
            // Donor identity for CRM linkage in the webhook (payment_intent.succeeded).
            // donorUserId lets a logged-in member be matched by uid (survives email
            // changes) and stamped as donor; donorEmail is the fallback / anonymous key.
            donorEmail: effectiveDonorEmail,
            donorUserId,
          },
        },
        success_url: `${returnBase}/?donation=success`,
        cancel_url: `${returnBase}/?donation=cancel`,
        customer_email: effectiveDonorEmail || undefined,
        metadata: {
          tenantId,
          donationType,
          plan,
          campaignId: campaignId || '',
          donorName: donorName || '',
        },
      });

      return NextResponse.json({ url: session.url });
    }

    // Monthly (subscription): Stripe Checkout subscriptions take a PERCENT fee
    // (application_fee_percent), not a fixed amount — application_fee_amount is only
    // valid on one-time PaymentIntents. feePercent is a decimal (0.015) → ×100 = 1.5.
    const subParams = {
      mode: 'subscription' as const,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Monthly Donation',
            },
            unit_amount: amount,
            recurring: { interval: 'month' as const },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        transfer_data: {
          destination: connectAccountId,
        },
        // Same settlement merchant as the one-time branch — a monthly partner's
        // card statement must name the church too, on every renewal.
        on_behalf_of: settlementAccountId,
        application_fee_percent: feePercent * 100,
        metadata: {
          // `type: 'partnership'` lets the webhook's checkout.session.completed
          // recognize this as a monthly partnership and write the donor's
          // donationSubscriptionId/donationAmount/donationChurchName (BUG 3/4) —
          // and intercept it BEFORE the plan-change path, which would otherwise
          // read `plan` and cancel the tenant's real subscription.
          type: 'partnership',
          tenantId,
          donationType,
          plan,
          campaignId: campaignId || '',
          donorName: donorName || '',
          donorEmail: effectiveDonorEmail,
          donorUserId,
          // Church name for the donor's Profile partnership card (webhook falls
          // back to the tenant doc's name if this is empty).
          donationChurchName: tenantData.name || tenantData.displayName || '',
        },
      },
      success_url: `${returnBase}/?donation=success`,
      cancel_url: `${returnBase}/?donation=cancel`,
      customer_email: effectiveDonorEmail || undefined,
    };
    const session = await stripe.checkout.sessions.create(subParams as any);

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe donate error:', error?.message || error);
    // A donor tried to give and couldn't. The generic 'Failed to process donation'
    // body tells them nothing and tells us nothing; this is the only report.
    captureMoneyPathError(error, { step: 'stripe-donate', level: 'error' });
    return NextResponse.json({ error: 'Failed to process donation' }, { status: 500 });
  }
}
