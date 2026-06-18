import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/affiliate/onboard
 * Creates a Stripe Connect Express account for the authenticated user
 * and returns an onboarding link.
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
    const userData = userDoc.data();

    // Already has a Connect account — generate a new account link
    if (userData?.affiliateStripeAccountId) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
      const accountLink = await stripe.accountLinks.create({
        account: userData.affiliateStripeAccountId,
        refresh_url: `${baseUrl}/?section=settings`,
        return_url: `${baseUrl}/api/affiliate/callback?account_id=${userData.affiliateStripeAccountId}`,
        type: 'account_onboarding',
      });
      return NextResponse.json({ url: accountLink.url });
    }

    // Create a new Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: {
        userId: userOrErr.uid,
        email: userOrErr.email || '',
        role: 'affiliate',
        app: 'harvest',
      },
    });

    // Save the account ID to the user document
    await adminDb.collection('users').doc(userOrErr.uid).update({
      affiliateStripeAccountId: account.id,
      affiliateEarnings: 0,
      affiliatePendingPayouts: 0,
      affiliateReferralCount: 0,
      updatedAt: new Date().toISOString(),
    });

    // Create an account link for onboarding
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/?section=settings`,
      return_url: `${baseUrl}/api/affiliate/callback?account_id=${account.id}`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error: any) {
    console.error('Affiliate onboard error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to create affiliate account' },
      { status: 500 }
    );
  }
}
