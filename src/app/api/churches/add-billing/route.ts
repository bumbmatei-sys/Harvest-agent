import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/** Every plan includes 1 church free (the tenant's own). */
const INCLUDED_CHURCHES = 1;

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

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const tenantData = tenantDoc.data();
    if (!tenantData) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Only Ministry (ultra) pays per-church; every other plan is capped at 1
    // church and must never be charged here.
    if (tenantData.plan !== 'ultra') {
      return NextResponse.json({ success: true, skipped: 'not-ministry' });
    }

    const churchDoc = await adminDb.collection('churches').doc(churchId).get();
    const churchData = churchDoc.data();
    if (!churchData) {
      return NextResponse.json({ error: 'Church not found' }, { status: 404 });
    }
    if (churchData.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Church does not belong to this tenant' }, { status: 403 });
    }
    // Idempotency: this church is already billed — don't create a duplicate item
    if (churchData.stripeSubscriptionItemId) {
      return NextResponse.json({
        success: true,
        skipped: 'already-billed',
        subscriptionItemId: churchData.stripeSubscriptionItemId,
      });
    }

    // The client creates the church doc before calling this endpoint, so the
    // just-added church is already in the count: count <= INCLUDED_CHURCHES
    // means this is the tenant's first church, which is free on every plan.
    const churchesSnap = await adminDb.collection('churches').where('tenantId', '==', tenantId).get();
    if (churchesSnap.docs.length <= INCLUDED_CHURCHES) {
      return NextResponse.json({ success: true, skipped: 'first-church-free' });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

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
