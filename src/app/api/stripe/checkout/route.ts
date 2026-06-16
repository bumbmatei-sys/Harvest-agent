import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Price IDs for each plan
const PRICE_MAP: Record<string, Record<string, string>> = {
  plus: {
    monthly: 'price_1TioOs1YKkcSbTf3eHwgIu2J',
    yearly: 'price_1TioOs1YKkcSbTf39WQDS5QB',
  },
  pro: {
    monthly: 'price_1TioOs1YKkcSbTf35trtKkNC',
    yearly: 'price_1TioOs1YKkcSbTf3XF71Y8uy',
  },
  ultra: {
    monthly: 'price_1TioOs1YKkcSbTf3B9ZbWHEA',
    yearly: 'price_1TioOs1YKkcSbTf35csZtLNe',
  },
};

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' });

    const body = await request.json();
    const { plan, billing, tenantId, tenantName, email } = body;

    if (!plan || !billing || !tenantId) {
      return NextResponse.json({ error: 'Missing required fields: plan, billing, tenantId' }, { status: 400 });
    }

    const priceId = PRICE_MAP[plan]?.[billing];
    if (!priceId) {
      return NextResponse.json({ error: `Invalid plan/billing: ${plan}/${billing}` }, { status: 400 });
    }

    // Get or create Stripe customer
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const tenantData = tenantDoc.data();
    let customerId = tenantData?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        name: tenantName || tenantData?.name || tenantId,
        metadata: { tenantId, app: 'harvest' },
      });
      customerId = customer.id;
      // Save customer ID to tenant
      await adminDb.collection('tenants').doc(tenantId).update({
        stripeCustomerId: customerId,
        updatedAt: new Date().toISOString(),
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?stripe=cancel`,
      metadata: { tenantId, plan, billing },
      subscription_data: {
        metadata: { tenantId, plan, billing },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
