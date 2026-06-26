import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Removes a $15/mo subscription item when an Organization plan admin deletes a church.
 * Called from the client before or after church document deletion.
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
    const { churchId } = body;

    if (!churchId) {
      return NextResponse.json({ error: 'Missing churchId' }, { status: 400 });
    }

    // Read the church document to get the subscription item ID
    const churchDoc = await adminDb.collection('churches').doc(churchId).get();
    const churchData = churchDoc.data();

    if (!churchData) {
      // Church already deleted — check if we got subscriptionItemId in the body
      const subItemId = body.subscriptionItemId;
      if (!subItemId) {
        return NextResponse.json({ error: 'Church not found and no subscriptionItemId provided' }, { status: 404 });
      }
      await stripe.subscriptionItems.del(subItemId);
      return NextResponse.json({ success: true, removed: subItemId });
    }

    // Verify tenant membership
    const tenantId = churchData.tenantId;
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    const subscriptionItemId = churchData.stripeSubscriptionItemId;
    if (!subscriptionItemId) {
      // No subscription item to remove — church was created before billing was set up
      return NextResponse.json({ success: true, message: 'No subscription item to remove' });
    }

    // Remove the subscription item from Stripe
    await stripe.subscriptionItems.del(subscriptionItemId);
    console.log(`Removed subscription item ${subscriptionItemId} for church ${churchId}`);

    return NextResponse.json({ success: true, removed: subscriptionItemId });
  } catch (error: any) {
    console.error('Remove church billing error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to remove church billing' }, { status: 500 });
  }
}