import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const FEE_MAP: Record<string, number> = {
  plus: 0.15,
  pro: 0.10,
  max: 0.05,
  ultra: 0,
  enterprise: 0,
};

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' });

    const body = await request.json();
    const { amount, tenantId, donationType, donorEmail } = body;

    // Verify tenant membership
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

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
        },
        success_url: `${baseUrl}/?donation=success`,
        cancel_url: `${baseUrl}/?donation=cancel`,
        customer_email: donorEmail || undefined,
        metadata: {
          tenantId,
          donationType,
          plan,
        },
      });

      return NextResponse.json({ url: session.url });
    }

    // Monthly (subscription)
    // application_fee_amount is valid in the Stripe API but the TS types for v22
    // don't expose it on SubscriptionData, so we use Stripe's raw API params.
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
        application_fee_amount: applicationFeeAmount,
      },
      success_url: `${baseUrl}/?donation=success`,
      cancel_url: `${baseUrl}/?donation=cancel`,
      customer_email: donorEmail || undefined,
      metadata: {
        tenantId,
        donationType,
        plan,
      },
    };
    const session = await stripe.checkout.sessions.create(subParams as any);

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe donate error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to process donation' }, { status: 500 });
  }
}
