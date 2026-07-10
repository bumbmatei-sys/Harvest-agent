import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { deriveConnectStatus } from '@/lib/stripe-connect-status';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Apex fallback for redirects that happen BEFORE the tenant is known (or in the
  // catch, where tenantId may be out of scope). Same convention as the Composio
  // callbacks, which keep missing/invalid-state redirects on the apex.
  const apexUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id');

    if (!accountId) {
      return NextResponse.redirect(new URL('/?error=missing_account', apexUrl));
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.redirect(new URL('/?error=stripe_not_configured', apexUrl));
    }
    const stripe = new Stripe(stripeKey);

    // Retrieve the account to check its status
    const account = await stripe.accounts.retrieve(accountId);

    // Determine status (shared with the account.updated webhook so they can't drift)
    const status = deriveConnectStatus(account);

    // Find the tenant with this account ID and update status
    const tenantsSnapshot = await adminDb.collection('tenants')
      .where('stripeConnectAccountId', '==', accountId)
      .limit(1)
      .get();

    // No tenant owns this account id → there is no subdomain to route back to;
    // stay on the apex with an error param.
    if (tenantsSnapshot.empty) {
      return NextResponse.redirect(new URL('/?error=connect_tenant_not_found', apexUrl));
    }

    const tenantData = tenantsSnapshot.docs[0].data();
    await tenantsSnapshot.docs[0].ref.update({
      stripeConnectStatus: status,
      updatedAt: new Date().toISOString(),
    });

    // Unified account: mirror the same account id/status onto the tenant owner's
    // user doc so this ONE onboarding also marks affiliate payouts ready. The
    // affiliate-payout path reads users/{referrerId}.affiliateStripeAccountId /
    // affiliateConnectStatus — keep it in lock-step with the donations status.
    const affiliateOwnerId = tenantData.ownerId || tenantData.createdBy;
    if (affiliateOwnerId) {
      await adminDb.collection('users').doc(affiliateOwnerId).set({
        affiliateStripeAccountId: accountId,
        affiliateConnectStatus: status,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    // The tenant doc id IS the tenantId (== subdomain), so route the admin back to
    // their own tenant (e.g. bumb.theharvest.app) instead of the apex/super-admin,
    // and land them on the payment section the onboarding started from (the
    // onboarding refresh_url uses /?section=payment).
    const tenantId = tenantsSnapshot.docs[0].id;
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'theharvest.app';
    const tenantBaseUrl = `https://${tenantId}.${rootDomain}`;
    return NextResponse.redirect(new URL(`/?section=payment&stripe_connect=${status}`, tenantBaseUrl));
  } catch (error: any) {
    console.error('Stripe Connect callback error:', error?.message || error);
    // tenantId may not be resolved here → stay on the apex.
    return NextResponse.redirect(new URL('/?error=connect_callback_failed', apexUrl));
  }
}
