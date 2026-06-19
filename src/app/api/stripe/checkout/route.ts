import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { PLAN_PRICES, AI_ASSISTANT_MONTHLY, AI_ASSISTANT_SETUP, AI_CHAT_MONTHLY } from '@/lib/stripe-config';

export const dynamic = 'force-dynamic';

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
    const { plan, billing, tenantId, tenantName, email, addOn, referrerId } = body;

    // Handle AI Chat user subscription (no tenant required)
    if (addOn === 'ai-chat') {
      const userId = userOrErr.uid;
      const userEmail = email || userOrErr.email;

      // Get or create Stripe customer for this user
      const userDoc = await adminDb.collection('users').doc(userId).get();
      const userData = userDoc.data();
      let customerId = userData?.aiChatStripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: userEmail || undefined,
          metadata: { userId, app: 'harvest', type: 'ai-chat' },
        });
        customerId = customer.id;
        await adminDb.collection('users').doc(userId).update({
          aiChatStripeCustomerId: customerId,
          updatedAt: new Date().toISOString(),
        });
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: AI_CHAT_MONTHLY, quantity: 1 }],
        success_url: `${baseUrl}/?stripe=success&session_id={CHECKOUT_SESSION_ID}&addon=ai-chat`,
        cancel_url: `${baseUrl}/?stripe=cancel`,
        metadata: { userId, addOn: 'ai-chat' },
        subscription_data: {
          metadata: { userId, addOn: 'ai-chat' },
        },
      });

      return NextResponse.json({ url: session.url });
    }

    // All remaining routes require tenantId
    // Verify tenant membership
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

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
        success_url: `${baseUrl}/?stripe=success&session_id={CHECKOUT_SESSION_ID}&addon=ai-assistant`,
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

    const priceId = PLAN_PRICES[plan]?.[billing];
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
      metadata: { tenantId, plan, billing, ...(referrerId ? { referrerId } : {}) },
      subscription_data: {
        metadata: { tenantId, plan, billing, ...(referrerId ? { referrerId } : {}) },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to create checkout session' }, { status: 500 });
  }
}
