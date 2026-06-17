import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/affiliate/status
 * Returns the affiliate status for the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const userDoc = await adminDb.collection('users').doc(userOrErr.uid).get();
    const userData = userDoc.data();

    const stripeConnectAccountId = userData?.affiliateStripeAccountId || null;
    const isAffiliate = !!stripeConnectAccountId;

    return NextResponse.json({
      isAffiliate,
      userId: userOrErr.uid,
      stripeConnectAccountId,
      totalEarnings: userData?.affiliateEarnings || 0,
      pendingPayouts: userData?.affiliatePendingPayouts || 0,
      referralCount: userData?.affiliateReferralCount || 0,
    });
  } catch (error: any) {
    console.error('Affiliate status error:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch affiliate status' },
      { status: 500 }
    );
  }
}
