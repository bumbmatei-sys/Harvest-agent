import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { billingActionUnavailable, blocksStripeAction, resolveBillingOwnership } from '@/lib/billing-processor';
import { requireAdmin } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

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

    // A $10/mo line added to the tenant's subscription — a charge, on whichever
    // processor owns it. Dodo's equivalent is an ADD-ON, which is a later part of
    // this migration, so a Dodo-owned tenant is refused here rather than having a
    // per-church line attached to a Stripe subscription it does not have. The
    // refusal is visible: AdminChurches surfaces a billing-setup notice.
    const privateData = await getTenantPrivate(tenantId);
    const ownership = resolveBillingOwnership(privateData);
    if (blocksStripeAction(ownership)) {
      return billingActionUnavailable('adding billing for an extra church', ownership);
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const subscriptionId = privateData.stripeSubscriptionId;
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
    // Same ordering hazard as the legacy route: the subscription item exists in
    // Stripe before the church doc records it. AdminChurches shows a "billing
    // setup failed" notice and creates the church anyway, so the ministry ends up
    // with an unbilled church or an untracked charge, and nothing reconciles it.
    captureMoneyPathError(error, { step: 'church-billing-add', level: 'error' });
    return NextResponse.json({ error: error?.message || 'Failed to add billing' }, { status: 500 });
  }
}
