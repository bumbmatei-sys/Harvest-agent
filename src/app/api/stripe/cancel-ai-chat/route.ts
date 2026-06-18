import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/cancel-ai-chat
 * Cancels the user's AI Chat subscription at period end.
 */
export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' });

    const userDoc = await adminDb.collection('users').doc(userOrErr.uid).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = userDoc.data();
    const subscriptionId = userData?.aiChatSubscription?.stripeSubscriptionId;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'No active AI Chat subscription found' }, { status: 404 });
    }

    // Cancel at period end
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Mark cancellation pending in Firestore
    await adminDb.collection('users').doc(userOrErr.uid).update({
      'aiChatSubscription.cancelAt': new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Cancel AI chat error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to cancel subscription' }, { status: 500 });
  }
}
