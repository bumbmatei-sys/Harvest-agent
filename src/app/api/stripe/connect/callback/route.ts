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

    await tenantsSnapshot.docs[0].ref.update({
      stripeConnectStatus: status,
      updatedAt: new Date().toISOString(),
    });

    // Unified account: keep affiliate payouts in lock-step with the donations
    // status. The affiliate-payout path reads users/{referrerId}.affiliateConnectStatus,
    // and any user who set up payouts against this account had it mirrored onto
    // their own doc (affiliateStripeAccountId == accountId). Reconcile status for
    // EVERY such user — covers the owner AND any other admin/affiliate on this
    // tenant, without guessing a single owner id.
    const linkedUsersSnap = await adminDb.collection('users')
      .where('affiliateStripeAccountId', '==', accountId)
      .get();
    if (!linkedUsersSnap.empty) {
      const batch = adminDb.batch();
      linkedUsersSnap.docs.forEach(d => batch.update(d.ref, {
        affiliateConnectStatus: status,
        updatedAt: new Date().toISOString(),
      }));
      await batch.commit();
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
