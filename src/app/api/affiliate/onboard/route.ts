import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { randomBytes } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

async function generateUniqueAffiliateCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomBytes(6).toString('base64url').slice(0, 8).toLowerCase();
    const existing = await adminDb.collection('users').where('affiliateCode', '==', code).limit(1).get();
    if (existing.empty) return code;
  }
  throw new Error('Failed to generate unique affiliate code after 10 attempts');
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const stripe = new Stripe(stripeKey);

    const userDoc = await adminDb.collection('users').doc(userOrErr.uid).get();
    const userData = userDoc.data();

    // Already has a Connect account — generate a new account link
    if (userData?.affiliateStripeAccountId) {
      // Backfill affiliate code if missing
      if (!userData?.affiliateCode) {
        try {
          const code = await generateUniqueAffiliateCode();
          await adminDb.collection('users').doc(userOrErr.uid).update({
            affiliateCode: code,
            affiliateClicks: 0,
            updatedAt: new Date().toISOString(),
          });
        } catch (codeErr) {
          console.error('Failed to backfill affiliate code:', codeErr);
        }
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
      const accountLink = await stripe.accountLinks.create({
        account: userData.affiliateStripeAccountId,
        refresh_url: `${baseUrl}/?section=settings`,
        return_url: `${baseUrl}/api/affiliate/callback?account_id=${userData.affiliateStripeAccountId}`,
        type: 'account_onboarding',
      });
      return NextResponse.json({ url: accountLink.url });
    }

    // Generate unique affiliate code for new affiliate
    const affiliateCode = await generateUniqueAffiliateCode();

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

    await adminDb.collection('users').doc(userOrErr.uid).update({
      affiliateStripeAccountId: account.id,
      affiliateCode,
      affiliateClicks: 0,
      affiliateEarnings: 0,
      affiliatePendingPayouts: 0,
      affiliateReferralCount: 0,
      updatedAt: new Date().toISOString(),
    });

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
