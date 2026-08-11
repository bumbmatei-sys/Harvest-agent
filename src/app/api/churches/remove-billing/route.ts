import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireTenantAdmin } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { tenantId, churchId } = await request.json();
    if (!tenantId || !churchId) {
      return NextResponse.json({ error: 'tenantId and churchId required' }, { status: 400 });
    }

    // THE-80: same fold as its add-billing counterpart — `requireAdmin` plus an
    // inline tenant-match becomes the one tenant-scoped, roster-aware helper.
    // Kept at admin level with add-billing on purpose: an admin who can add a
    // church's $10/mo line must be able to remove it again, or deleting a church
    // leaves the church gone and the charge running.
    const userOrErr = await requireTenantAdmin(request, tenantId);
    if (userOrErr instanceof Response) return userOrErr;

    const churchDoc = await adminDb.collection('churches').doc(churchId).get();
    const churchData = churchDoc.data();
    if (!churchData) {
      // Church already deleted or not found — nothing to remove
      return NextResponse.json({ success: true, skipped: true });
    }

    const subscriptionItemId = churchData?.stripeSubscriptionItemId;
    if (!subscriptionItemId) {
      return NextResponse.json({ success: true, skipped: true, reason: 'no subscription item' });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    await stripe.subscriptionItems.del(subscriptionItemId);

    return NextResponse.json({ success: true, subscriptionItemId });
  } catch (error: any) {
    console.error('remove-billing error:', error?.message || error);
    // AdminChurches calls this with `.catch(err => console.error(...))` and then
    // deletes the church regardless, so a failure here is invisible to the admin
    // AND leaves the $10/mo subscription item live for a church that no longer
    // exists. This is the only place that can report it.
    captureMoneyPathError(error, { step: 'church-billing-remove', level: 'error' });
    return NextResponse.json({ error: error?.message || 'Failed to remove billing' }, { status: 500 });
  }
}
