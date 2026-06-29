import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const FEE_MAP: Record<string, number> = {
  plus: 0.15,
  pro: 0.10,
  max: 0.05,
  ultra: 0,
};

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

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

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
          },
        },
        success_url: `${baseUrl}/?donation=success`,
        cancel_url: `${baseUrl}/?donation=cancel`,
        customer_email: donorEmail || undefined,
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
        },
      },
      success_url: `${baseUrl}/?donation=success`,
      cancel_url: `${baseUrl}/?donation=cancel`,
      customer_email: donorEmail || undefined,
    };
    const session = await stripe.checkout.sessions.create(subParams as any);

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe donate error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to process donation' }, { status: 500 });
  }
}
