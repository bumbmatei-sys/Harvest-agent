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

    const { tenantId, churchId } = await request.json();
    if (!tenantId || !churchId) {
      return NextResponse.json({ error: 'tenantId and churchId required' }, { status: 400 });
    }

    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

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
    return NextResponse.json({ error: error?.message || 'Failed to remove billing' }, { status: 500 });
  }
}
