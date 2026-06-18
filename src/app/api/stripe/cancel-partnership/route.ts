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
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' });

    const body = await request.json();
    const { userId } = body;

    // Verify user is cancelling their own subscription or is super admin
    if (!userOrErr.isSuperAdmin && userOrErr.uid !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Missing required field: userId' }, { status: 400 });
    }

    // Look up user doc
    const userDoc = await adminDb.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userData = userDoc.data()!;
    const subscriptionId = userData.donationSubscriptionId;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'No active partnership found' }, { status: 400 });
    }

    // Cancel at period end
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Remove subscription reference from user doc
    await adminDb.collection('users').doc(userId).update({
      donationSubscriptionId: null,
      donationAmount: null,
      donationChurchId: null,
      donationChurchName: null,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Cancel partnership error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to cancel partnership' }, { status: 500 });
  }
}
