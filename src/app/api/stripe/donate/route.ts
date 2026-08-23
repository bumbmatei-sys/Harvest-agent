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
import { getPlanFeatures } from '@/utils/plan-features';

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
    // ⚠️ `stripe-connect.ts` IS NOT TOUCHED. Donations are Stripe Connect direct
    // charges on the church's own account at 0%, and that module's rate table
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

    // 🔴 THE FREE TIER HAS NO DONATE PAGE — THE-202, server side.
    //
    // `free.fundraising` is false (src/utils/plan-features.ts) and THE-202 hides
    // the Give tab in MainApp, but this is a MONEY surface: a hidden tab is not
    // a gate, and this route is deliberately unauthenticated so anonymous donors
    // can give. Anyone holding the URL could POST here. Refused BEFORE any
    // Stripe object is created, and before the fee maths below, so a free tenant
    // can never open a Checkout Session.
    //
    // Reuses GIVING_UNAVAILABLE_MESSAGE verbatim: the reader is a donor, and a
    // church's subscription tier is not theirs to be told — the same reasoning
    // written on the lifecycle refusal above.
    if (getPlanFeatures(plan).fundraising === false) {
      return NextResponse.json({ error: GIVING_UNAVAILABLE_MESSAGE }, { status: 403 });
    }

    if (!connectAccountId) {
      return NextResponse.json({ error: 'This ministry has not set up payments yet' }, { status: 400 });
    }

    const feePercent = FEE_MAP[plan] ?? 0;
    const applicationFeeAmount = Math.round(amount * feePercent);

    // 🔴 THE CHURCH IS CHARGED, NOT HARVEST — this is a DIRECT charge.
    //
    // Both branches below create the Checkout Session AS the connected account
    // (the `Stripe-Account` header, i.e. the `{ stripeAccount }` request option on
    // each `sessions.create` call). That single change moves three things off the
    // platform and onto the church:
    //
    //   • LIABILITY. Stripe, verbatim: "For connected accounts that use direct
    //     charges, Stripe always attempts to debit disputed amounts from the
    //     connected account's balance." Under the destination charges this
    //     replaces, a disputed gift was debited from HARVEST's balance — for a
    //     gift Harvest earns 0% on. That is the defect this change exists to fix,
    //     and `on_behalf_of` could not fix it: "For destination charges, with or
    //     without `on_behalf_of`, Stripe debits dispute amounts and fees from your
    //     platform account."
    //   • MERCHANT OF RECORD. The connected account IS the merchant on a direct
    //     charge — its country, its settlement currency, its fee structure, its
    //     statement descriptor on the donor's card. Harvest being the business of
    //     record contradicted the recorded reason Stripe was kept for donations at
    //     all: a merchant-of-record structure is incompatible with 501(c)(3) donor
    //     substantiation.
    //   • THE MONEY ITSELF. There is no `transfer_data` any more because there is
    //     nothing to transfer — the funds land in the church's balance directly.
    //
    // ⚠️ `on_behalf_of` IS GONE, and so is the capability gate and the
    // `donate-settlement-merchant-fallback` capture that guarded it (#315). That
    // parameter exists to name a settlement merchant on an INDIRECT charge; on a
    // direct charge the connected account already is the merchant, so sending it
    // is meaningless. Its whole apparatus — the `stripeConnectStatus === 'active'`
    // proxy for `card_payments`, the deliberate under-application, the loud
    // fallback — was solving a problem that no longer exists here.
    //
    // ⚠️ THE FEE DOES NOT MOVE. `application_fee_amount` /
    // `application_fee_percent` below still come from PLATFORM_FEE_MAP and are
    // still 0 on every tier — Harvest takes no cut of a gift. Direct charges
    // support application fees exactly as destination charges did; what changed is
    // who is charged, not what Harvest keeps.
    //
    // ⚠️ THE PRICE STAYS INLINE. `price_data` creates the Price and Product on
    // whichever account the session is created on, so nothing has to be
    // provisioned on the church's account first.
    //
    // 🔴 AND THE WEBHOOK MOVED WITH IT. A session created on the connected account
    // emits its events — checkout.session.completed, payment_intent.succeeded,
    // invoice.payment_succeeded — to the CONNECT endpoint, not the platform one.
    // `/api/stripe/connect/webhook` handles them in this same change; shipping
    // this half alone would mean every donation succeeds and Harvest records
    // nothing.
    const directCharge = { stripeAccount: connectAccountId };

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
          // Zero on every tier (PLATFORM_FEE_MAP). A direct charge with no
          // application fee leaves the entire gift in the church's balance.
          // ⚠️ One-time uses a fixed AMOUNT; the monthly branch below uses a
          // PERCENT. That split is required by Stripe, not stylistic — see there.
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
      }, directCharge);

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
        // Zero on every tier (PLATFORM_FEE_MAP), same as the one-time branch —
        // but expressed as a PERCENT, and that is not interchangeable. Stripe:
        // "Application fees on subscriptions must normally be a percentage
        // because the amount billed with subscriptions often varies. You can't
        // set a subscription's recurring application fee as a flat amount."
        // Unifying the two branches on one parameter breaks whichever branch
        // loses its own.
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
    // ⚠️ Created AS the church, exactly like the one-time branch. Checkout mints
    // the Customer on the connected account for us — no platform Customer is
    // passed (only `customer_email`, a prefill), so nothing has to exist on the
    // church's account before a monthly partner can subscribe.
    const session = await stripe.checkout.sessions.create(subParams as any, directCharge);

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe donate error:', error?.message || error);
    // A donor tried to give and couldn't. The generic 'Failed to process donation'
    // body tells them nothing and tells us nothing; this is the only report.
    captureMoneyPathError(error, { step: 'stripe-donate', level: 'error' });
    return NextResponse.json({ error: 'Failed to process donation' }, { status: 500 });
  }
}
