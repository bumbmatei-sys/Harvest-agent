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

    // Backfill short code for existing affiliates who don't have one yet
    if (isAffiliate && !affiliateCode) {
      try {
        affiliateCode = await generateUniqueAffiliateCode();
        await adminDb.collection('users').doc(userOrErr.uid).update({
          affiliateCode,
          affiliateClicks: 0,
          updatedAt: new Date().toISOString(),
        });
      } catch (codeErr) {
        console.error('Failed to generate affiliate code:', codeErr);
        affiliateCode = null;
      }
    }

    return NextResponse.json({
      isAffiliate,
      userId: userOrErr.uid,
      stripeConnectAccountId,
      affiliateCode,
      affiliateClicks: userData?.affiliateClicks || 0,
      totalEarnings: userData?.affiliateEarnings || 0,
      pendingPayouts: userData?.affiliatePendingPayouts || 0,
      referralCount: userData?.affiliateReferralCount || 0,
    });
  } catch (error: any) {
    console.error('Affiliate status error:', error?.message || error);
    return NextResponse.json(
      { error: 'Failed to fetch affiliate status' },
      { status: 500 }
    );
  }
}
