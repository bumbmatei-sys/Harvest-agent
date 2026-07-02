import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const ENTERPRISE_PRICE_PER_CHURCH = 1000; // $10 in cents

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
    const { tenantId, action } = body;

    // Verify tenant membership
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    // Look up tenant
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenantData = tenantDoc.data()!;
    const subscriptionId = tenantData.stripeSubscriptionId;
    const plan = tenantData.plan;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'No active subscription found for this tenant' }, { status: 400 });
    }

    // Count churches for this tenant
    const churchesSnap = await adminDb.collection('churches')
      .where('tenantId', '==', tenantId)
      .get();
    const churchCount = churchesSnap.size;

    if (plan !== 'ultra') {
      return NextResponse.json({ 
        success: true, 
        churchCount, 
        newAmount: null,
        message: 'Not a Ministry plan — quantity update not applicable' 
      });
    }

    // Get subscription to find the subscription item
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const subscriptionItem = subscription.items.data[0];

    if (!subscriptionItem) {
      return NextResponse.json({ error: 'No subscription item found' }, { status: 400 });
    }

    // Update quantity to match church count (minimum 1)
    const newQuantity = Math.max(churchCount, 1);
    await stripe.subscriptionItems.update(subscriptionItem.id, {
      quantity: newQuantity,
    });

    const newAmount = newQuantity * ENTERPRISE_PRICE_PER_CHURCH;

    return NextResponse.json({ success: true, churchCount, newAmount });
  } catch (error: any) {
    console.error('Update quantity error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to update subscription quantity' }, { status: 500 });
  }
}
