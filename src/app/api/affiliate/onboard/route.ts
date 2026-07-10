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

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const userRef = adminDb.collection('users').doc(userOrErr.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    // Backfill an affiliate code if missing — the referral link works without a
    // Connect account (Connect is only needed to RECEIVE payouts).
    if (!userData?.affiliateCode) {
      try {
        const code = await generateUniqueAffiliateCode();
        await userRef.set({
          affiliateCode: code,
          affiliateClicks: userData?.affiliateClicks || 0,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch (codeErr) {
        console.error('Failed to backfill affiliate code:', codeErr);
      }
    }

    // ── Unified-account backstop (server-authoritative) ──────────────────────
    // The ONE tenant Connect account (tenants/{id}.stripeConnectAccountId) powers
    // affiliate payouts too, so if the caller belongs to a tenant we must NEVER
    // mint a second, user-scoped Express account here. Reuse the tenant's account
    // (or create it AS the canonical account) and mirror it onto the user doc.
    // tenantId comes from requireAuth, which resolves it from the token claim OR
    // the authoritative user-doc read — so a flaky CLIENT-side tenant lookup can't
    // route us into a double-account. Onboarding returns through the shared connect
    // callback so status reconciliation (and the owner mirror) stays unified.
    const tenantId = userOrErr.tenantId;
    if (tenantId) {
      const tenantRef = adminDb.collection('tenants').doc(tenantId);
      const tenantSnap = await tenantRef.get();
      if (tenantSnap.exists) {
        const tData = tenantSnap.data()!;
        let accountId: string | undefined = tData.stripeConnectAccountId;
        let connectStatus: string | undefined = tData.stripeConnectStatus;
        if (!accountId) {
          const account = await stripe.accounts.create({
            type: 'express',
            metadata: { tenantId, tenantName: tData.name || '', app: 'harvest' },
          });
          accountId = account.id;
          connectStatus = 'pending';
          await tenantRef.update({
            stripeConnectAccountId: accountId,
            stripeConnectStatus: 'pending',
            updatedAt: new Date().toISOString(),
          });
        }
        // Mirror onto the caller's user doc so their affiliate-payout path resolves
        // the SAME account (the payout path reads users/{uid}.affiliateStripeAccountId).
        await userRef.set({
          affiliateStripeAccountId: accountId,
          ...(connectStatus ? { affiliateConnectStatus: connectStatus } : {}),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${baseUrl}/?section=payment`,
          return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${accountId}`,
          type: 'account_onboarding',
        });
        return NextResponse.json({ url: accountLink.url });
      }
      // tenantId set but the tenant doc is missing → fall through to the
      // user-scoped path (defensive; shouldn't happen for a real member).
    }

    // ── Tenant-less affiliate (e.g. platform super admin) ────────────────────
    // No tenant to unify with → keep a user-scoped Connect account. Already has one
    // → just refresh the onboarding link.
    if (userData?.affiliateStripeAccountId) {
      const accountLink = await stripe.accountLinks.create({
        account: userData.affiliateStripeAccountId,
        refresh_url: `${baseUrl}/?section=settings`,
        return_url: `${baseUrl}/api/affiliate/callback?account_id=${userData.affiliateStripeAccountId}`,
        type: 'account_onboarding',
      });
      return NextResponse.json({ url: accountLink.url });
    }

    // Create a new user-scoped Stripe Connect Express account.
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: {
        userId: userOrErr.uid,
        email: userOrErr.email || '',
        role: 'affiliate',
        app: 'harvest',
      },
    });

    await userRef.set({
      affiliateStripeAccountId: account.id,
      affiliateClicks: userData?.affiliateClicks || 0,
      affiliateEarnings: userData?.affiliateEarnings || 0,
      affiliatePendingPayouts: userData?.affiliatePendingPayouts || 0,
      affiliateReferralCount: userData?.affiliateReferralCount || 0,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

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
