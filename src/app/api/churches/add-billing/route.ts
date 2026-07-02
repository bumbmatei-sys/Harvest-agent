import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAdmin(request);
    if (userOrErr instanceof Response) return userOrErr;

    const { tenantId, churchId, churchName } = await request.json();
    if (!tenantId || !churchId) {
      return NextResponse.json({ error: 'tenantId and churchId required' }, { status: 400 });
    }

    // Verify the user belongs to this tenant (super admins bypass)
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const tenantData = tenantDoc.data();
    if (!tenantData) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const subscriptionId = tenantData?.stripeSubscriptionId;
    if (!subscriptionId) {
      return NextResponse.json({ error: 'Tenant has no active Stripe subscription' }, { status: 400 });
    }

    const subItem = await stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price_data: {
        currency: 'usd',
        unit_amount: 1000,
        recurring: { interval: 'month' },
        product_data: {
          name: `Additional Church: ${churchName || churchId}`,
          metadata: { tenantId, churchId, type: 'per_church' },
        },
      } as any,
      metadata: { tenantId, churchId, type: 'per_church' },
    });

    await adminDb.collection('churches').doc(churchId).update({
      stripeSubscriptionItemId: subItem.id,
      billingAmount: 1000,
      billingAddedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, subscriptionItemId: subItem.id });
  } catch (error: any) {
    console.error('add-billing error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to add billing' }, { status: 500 });
  }
}
