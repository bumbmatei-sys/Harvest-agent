import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Price IDs for each plan
// AI Assistant add-on price IDs
const AI_ASSISTANT_MONTHLY = 'price_1TiqsB1YKkcSbTf3QabrkQIU';
const AI_ASSISTANT_SETUP = 'price_1TiqsB1YKkcSbTf35n5cW3hu';

const PRICE_MAP: Record<string, Record<string, string>> = {
  plus: {
    monthly: 'price_1TipKw1YKkcSbTf3NBKUJQxW',
    yearly: 'price_1TipKw1YKkcSbTf3lxwJrDPb',
  },
  pro: {
    monthly: 'price_1TipKx1YKkcSbTf3BLNULdsm',
    yearly: 'price_1TipKx1YKkcSbTf3lYNIc7GB',
  },
  ultra: {
    monthly: 'price_1TipKx1YKkcSbTf3d1QlW8nA',
    yearly: 'price_1TipKy1YKkcSbTf3dTDBc6iI',
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
    const { plan, billing, tenantId, tenantName, email, addOn } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    // Handle AI Assistant add-on checkout
    if (addOn === 'ai-assistant') {
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
        await adminDb.collection('tenants').doc(tenantId).update({
          stripeCustomerId: customerId,
          updatedAt: new Date().toISOString(),
        });
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [
          { price: AI_ASSISTANT_SETUP, quantity: 1 },
          { price: AI_ASSISTANT_MONTHLY, quantity: 1 },
        ],
        success_url: `${baseUrl}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?stripe=cancel`,
        metadata: { tenantId, addOn: 'ai-assistant' },
        subscription_data: {
          metadata: { tenantId, addOn: 'ai-assistant' },
        },
      });

      return NextResponse.json({ url: session.url });
    }

    // Regular plan checkout
    if (!plan || !billing) {
      return NextResponse.json({ error: 'Missing required fields: plan, billing' }, { status: 400 });
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
  } catch (error: any) {
    console.error('Stripe checkout error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to create checkout session' }, { status: 500 });
  }
}
