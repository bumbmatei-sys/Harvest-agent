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
          updatedAt: new Date().toISOString(),
        });
      } catch (codeErr) {
        console.error('Failed to generate affiliate code:', codeErr);
        affiliateCode = null;
      }
    }

    // Earnings breakdown from affiliate_commissions. Fetch the referrer's commissions
    // once (single-field query → no composite index) and compute client-side.
    let thisMonthEarnings = 0; // paid + pending this month — matches Lifetime's basis
    let thisMonthPending = 0;  // of that, not yet paid out (Connect wasn't active when earned)
    let recurringEarnings = 0; // recurring commissions in the trailing 30 days (active referrals)
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const commSnap = await adminDb
        .collection('affiliate_commissions')
        .where('referrerId', '==', userOrErr.uid)
        .get();
      for (const d of commSnap.docs) {
        const c = d.data();
        const commission = c.commission || 0;
        const createdAt = c.createdAt || '';
        // 'cancelled' rows are zero-commission markers; paid/pending/failed each
        // represent money the affiliate earned (Lifetime counts them the same way),
        // so "This Month" must include pending — a commission written before the
        // referrer connected Stripe is 'pending' yet still earned this month.
        if (c.status === 'cancelled' || commission <= 0) continue;
        if (createdAt >= startOfMonth) {
          thisMonthEarnings += commission;
          if (c.status !== 'paid') thisMonthPending += commission;
        }
        // Recurring income = ACTUAL recurring commissions in the trailing 30 days.
        // A cancelled referral stops generating these, so it drops off on its own —
        // there is no static referral count to decrement (see ISSUE 6).
        if (c.type === 'recurring' && createdAt >= thirtyDaysAgo) {
          recurringEarnings += commission;
        }
      }
    } catch (monthErr) {
      console.warn('Failed to compute affiliate earnings:', monthErr);
    }

    return NextResponse.json({
      isAffiliate,
      userId: userOrErr.uid,
      stripeConnectAccountId,
      affiliateConnectStatus: userData?.affiliateConnectStatus || null,
      affiliateCode,
      totalEarnings: userData?.affiliateEarnings || 0,
      pendingPayouts: userData?.affiliatePendingPayouts || 0,
      referralCount: userData?.affiliateReferralCount || 0,
      thisMonthEarnings,
      thisMonthPending,
      recurringEarnings,
    });
  } catch (error: any) {
    console.error('Affiliate status error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch affiliate status' },
      { status: 500 }
    );
  }
}
