import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Adds a $10/mo subscription item to the tenant's Stripe subscription
 * when an Organization plan admin creates a new church.
 */
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
    const { tenantId, churchId, churchName } = body;

    if (!tenantId || !churchId) {
      return NextResponse.json({ error: 'Missing tenantId or churchId' }, { status: 400 });
    }

    // Verify tenant membership (or super admin)
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const tenantData = tenantDoc.data();
    if (!tenantData) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const subscriptionId = tenantData?.stripeSubscriptionId;
    if (!subscriptionId) {
      return NextResponse.json({ error: 'Tenant has no active Stripe subscription' }, { status: 400 });
    }

    // Create subscription item with inline price_data (no pre-created product needed)
    const subItem = await stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price_data: {
        currency: 'usd',
        unit_amount: 1000, // $10.00/mo
        recurring: { interval: 'month' },
        product_data: {
          name: `Additional Church: ${churchName || churchId}`,
          metadata: { tenantId, churchId, type: 'per_church' },
        },
      } as any,
      metadata: {
        tenantId,
        churchId,
        type: 'per_church',
      },
    });

    // Store the subscription item ID on the church document
    await adminDb.collection('churches').doc(churchId).update({
      stripeSubscriptionItemId: subItem.id,
      billingAmount: 1000,
      billingAddedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, subscriptionItemId: subItem.id });
  } catch (error: any) {
    console.error('Add church billing error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to add church billing' }, { status: 500 });
  }
}