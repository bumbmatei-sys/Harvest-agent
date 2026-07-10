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
    const stripe = new Stripe(stripeKey);

    const body = await request.json();
    const { tenantId } = body;

    // Verify tenant membership
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenantData = tenantDoc.data()!;

    // Unified account: the ONE Connect account created here powers BOTH donations
    // (tenants/{id}.stripeConnectAccountId, read by /api/stripe/donate) AND affiliate
    // payouts. The affiliate-payout path reads users/{referrerId}.affiliateStripeAccountId
    // / affiliateConnectStatus, so we mirror the SAME account id/status onto the
    // CONNECTING user's doc — that user is the affiliate whose referrals credit their
    // own uid, so this makes THEIR payouts resolve the one account. The connect
    // callback / account.updated webhook then reconcile status for EVERY user linked
    // to this account (so a multi-admin tenant works too, still with one account).
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

    // Safety: never silently repoint/downgrade a DIFFERENT, already-ACTIVE affiliate
    // account. A legacy user who onboarded a standalone affiliate account via
    // /api/affiliate/onboard (active, receiving payouts) must not have it clobbered
    // by a not-yet-ready tenant donations account just because they clicked Connect.
    // We still mirror when they have no account, already point at this one, or their
    // affiliate isn't active — so the founder's primary (no-account) flow is unaffected.
    const connectingUserRef = adminDb.collection('users').doc(userOrErr.uid);
    const connectingUser = (await connectingUserRef.get()).data();
    const mirrorSafe = (accountId: string): boolean =>
      !(connectingUser?.affiliateStripeAccountId
        && connectingUser.affiliateStripeAccountId !== accountId
        && connectingUser.affiliateConnectStatus === 'active');

    // Check if already connected
    if (tenantData.stripeConnectAccountId) {
      // Ensure the affiliate mirror points at the canonical account, even for
      // tenants connected before unification. Mirror the tenant's current status
      // too so a fully-onboarded account is immediately payout-ready for affiliate
      // commissions (account.updated may not fire again for an existing account).
      if (mirrorSafe(tenantData.stripeConnectAccountId)) {
        await connectingUserRef.set({
          affiliateStripeAccountId: tenantData.stripeConnectAccountId,
          ...(tenantData.stripeConnectStatus ? { affiliateConnectStatus: tenantData.stripeConnectStatus } : {}),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      // Create a new account link for existing account
      const accountLink = await stripe.accountLinks.create({
        account: tenantData.stripeConnectAccountId,
        refresh_url: `${baseUrl}/?section=payment`,
        return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${tenantData.stripeConnectAccountId}`,
        type: 'account_onboarding',
      });
      return NextResponse.json({ url: accountLink.url });
    }

    // Create a new Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: {
        tenantId,
        tenantName: tenantData.name || '',
        app: 'harvest',
      },
    });

    // Save the account ID and set status to pending
    await adminDb.collection('tenants').doc(tenantId).update({
      stripeConnectAccountId: account.id,
      stripeConnectStatus: 'pending',
      updatedAt: new Date().toISOString(),
    });

    // Mirror onto the connecting user so the SAME account also powers their
    // affiliate payouts. Status starts 'pending'; the connect callback and
    // account.updated webhook flip it to 'active' once Express onboarding completes.
    // (mirrorSafe is always true here for a brand-new account unless the user already
    // holds a different active one — in which case we leave their working payout be.)
    if (mirrorSafe(account.id)) {
      await connectingUserRef.set({
        affiliateStripeAccountId: account.id,
        affiliateConnectStatus: 'pending',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    // Create an account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/?section=payment`,
      return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${account.id}`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error: any) {
    console.error('Stripe Connect error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to create Stripe Connect account' }, { status: 500 });
  }
}
