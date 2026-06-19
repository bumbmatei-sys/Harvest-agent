import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const body = await request.json();
    const { tenantId, addon } = body;

    // Verify tenant membership
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

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

    // Don't null addOnAiAssistant yet — let webhook handle it at period end
    await adminDb.collection('tenants').doc(tenantId).update({
      addOnAiAssistantCancelAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Cancel addon error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to cancel add-on' }, { status: 500 });
  }
}
