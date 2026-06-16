import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' });

    const body = await request.json();
    const { tenantId, addon } = body;

    if (!tenantId || addon !== 'ai-assistant') {
      return NextResponse.json({ error: 'Missing or invalid tenantId or addon' }, { status: 400 });
    }

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenantData = tenantDoc.data();
    const subscriptionId = tenantData?.addOnAiAssistant;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'No active AI Assistant subscription found' }, { status: 404 });
    }

    // Cancel at period end
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Remove addOnAiAssistant from tenant doc
    await adminDb.collection('tenants').doc(tenantId).update({
      addOnAiAssistant: null,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Cancel addon error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to cancel add-on' }, { status: 500 });
  }
}
