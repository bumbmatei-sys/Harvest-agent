import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { AI_ASSISTANT_MONTHLY } from '@/lib/stripe-config';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://theharvest.site',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500, headers: CORS_HEADERS });
    }
    const stripe = new Stripe(stripeKey);

    if (!AI_ASSISTANT_MONTHLY) {
      return NextResponse.json({ error: 'AI Assistant price not configured — set STRIPE_PRICE_AI_MONTHLY ($200/mo)' }, { status: 500, headers: CORS_HEADERS });
    }

    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400, headers: CORS_HEADERS });
    }

    const existing = await stripe.customers.list({ email, limit: 1 });
    let customerId: string;
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { type: 'standalone_ai_user', app: 'harvest' },
      });
      customerId = customer.id;
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: AI_ASSISTANT_MONTHLY, quantity: 1 }],
      success_url: `${baseUrl}/ai-assistant?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://theharvest.site/#ai-assistant`,
      subscription_data: {
        metadata: { type: 'standalone_ai_assistant', email },
      },
    });

    return NextResponse.json({ url: session.url }, { headers: CORS_HEADERS });
  } catch (error: any) {
    console.error('Standalone checkout error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to create checkout' }, { status: 500, headers: CORS_HEADERS });
  }
}
