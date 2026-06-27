import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
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

export async function GET(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const userDoc = await adminDb.collection('users').doc(userOrErr.uid).get();
    const userData = userDoc.data();

    const stripeConnectAccountId = userData?.affiliateStripeAccountId || null;
    const isAffiliate = !!stripeConnectAccountId;

    let affiliateCode = userData?.affiliateCode || null;

    // Always generate a short code on first load so the referral link is
    // available instantly — Stripe Connect is only required to receive payouts,
    // not to generate a link.
    if (!affiliateCode) {
      try {
        affiliateCode = await generateUniqueAffiliateCode();
        await adminDb.collection('users').doc(userOrErr.uid).update({
          affiliateCode,
          affiliateClicks: userData?.affiliateClicks || 0,
          updatedAt: new Date().toISOString(),
        });
      } catch (codeErr) {
        console.error('Failed to generate affiliate code:', codeErr);
        affiliateCode = null;
      }
    }

    // Compute this month's earnings from affiliate_commissions collection
    let thisMonthEarnings = 0;
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthSnap = await adminDb
        .collection('affiliate_commissions')
        .where('referrerId', '==', userOrErr.uid)
        .where('status', '==', 'paid')
        .get();
      // Filter client-side (avoid compound index)
      thisMonthEarnings = monthSnap.docs
        .filter(d => (d.data().createdAt || '') >= startOfMonth)
        .reduce((sum, d) => sum + (d.data().commission || 0), 0);
    } catch (monthErr) {
      console.warn('Failed to compute monthly earnings:', monthErr);
    }

    return NextResponse.json({
      isAffiliate,
      userId: userOrErr.uid,
      stripeConnectAccountId,
      affiliateConnectStatus: userData?.affiliateConnectStatus || null,
      affiliateCode,
      affiliateClicks: userData?.affiliateClicks || 0,
      totalEarnings: userData?.affiliateEarnings || 0,
      pendingPayouts: userData?.affiliatePendingPayouts || 0,
      referralCount: userData?.affiliateReferralCount || 0,
      thisMonthEarnings,
    });
  } catch (error: any) {
    console.error('Affiliate status error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch affiliate status' },
      { status: 500 }
    );
  }
}
