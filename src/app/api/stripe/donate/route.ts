import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_FEE_MAP as FEE_MAP } from '@/lib/stripe-config';
import { verifyAuth } from '@/lib/api-auth';

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
    const connectAccountId = tenantData.stripeConnectAccountId;
    const plan = tenantData.plan || 'plus';

    if (!connectAccountId) {
      return NextResponse.json({ error: 'This ministry has not set up payments yet' }, { status: 400 });
    }

    const feePercent = FEE_MAP[plan] ?? 0;
    const applicationFeeAmount = Math.round(amount * feePercent);

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
    // valid on one-time PaymentIntents. feePercent is a decimal (0.15) → ×100 = 15.
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
        application_fee_percent: feePercent * 100,
        metadata: {
          tenantId,
          donationType,
          plan,
          campaignId: campaignId || '',
          donorName: donorName || '',
          donorEmail: effectiveDonorEmail,
          donorUserId,
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
    return NextResponse.json({ error: 'Failed to process donation' }, { status: 500 });
  }
}
