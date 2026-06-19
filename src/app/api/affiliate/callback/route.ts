import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/affiliate/callback
 * Stripe Connect redirect target after affiliate onboarding.
 * Retrieves account status and updates the user document.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id');

    if (!accountId) {
      return NextResponse.redirect(
        new URL('/?error=missing_account', process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app')
      );
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.redirect(
        new URL('/?error=stripe_not_configured', process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app')
      );
    }

    const stripe = new Stripe(stripeKey);

    // Retrieve the account to check its status
    const account = await stripe.accounts.retrieve(accountId);

    // Find the user with this account ID and update status
    const usersSnapshot = await adminDb.collection('users')
      .where('affiliateStripeAccountId', '==', accountId)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      const status = account.charges_enabled && account.payouts_enabled ? 'active' : 'pending';
      await usersSnapshot.docs[0].ref.update({
        affiliateConnectStatus: status,
        updatedAt: new Date().toISOString(),
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    return NextResponse.redirect(new URL(`/?affiliate_connect=success`, baseUrl));
  } catch (error: any) {
    console.error('Affiliate callback error:', error?.message || error);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    return NextResponse.redirect(new URL('/?error=affiliate_callback_failed', baseUrl));
  }
}
