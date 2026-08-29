import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { deriveConnectStatus } from '@/lib/stripe-connect-status';
import { resolveReturnBaseUrl } from '@/lib/connect-return-url';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { STRIPE_CONNECT_ENABLED, STRIPE_CONNECT_HIDDEN_MESSAGE } from '@/lib/stripe-connect-feature';

export const dynamic = 'force-dynamic';

// THE-256 — refused while Stripe Connect is hidden.
//
// This is the hop a browser lands on coming BACK from Stripe onboarding, and
// `/api/stripe/connect` cannot mint an account link while the switch is off —
// so nothing can legitimately arrive here. It refuses rather than retrieving an
// account and writing a status.
//
// ⚠️ A 503 BODY, NOT A REDIRECT, and deliberately: every other exit from this
// route redirects with an `?error=` param, and reusing that shape would send a
// churchless admin to a page that reports a FAILED onboarding for an onboarding
// that never started. 503 says the route exists and is coming back, which is
// the true answer. The four redirect branches below are untouched and return
// whole with the switch.
export async function GET(request: NextRequest) {
  if (!STRIPE_CONNECT_ENABLED) {
    return NextResponse.json({ error: STRIPE_CONNECT_HIDDEN_MESSAGE }, { status: 503 });
  }
  // Fallback for redirects that happen BEFORE the tenant is known (or in the
  // catch, where tenantId may be out of scope). Derived from the host the admin
  // came back on (allowlist-validated, so a spoofed Host falls back to the apex)
  // rather than a hardcoded apex — an error mid-onboarding keeps them on the host
  // they started from. The success path below still routes to the tenant
  // subdomain resolved from the account's tenant doc.
  const apexUrl = resolveReturnBaseUrl(request);
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

    // Find the tenant with this account ID and update status. The account id
    // lives on the server-only tenant_private doc (whose id IS the tenantId);
    // the status stays on the public tenant doc.
    const tenantsSnapshot = await adminDb.collection('tenant_private')
      .where('stripeConnectAccountId', '==', accountId)
      .limit(1)
      .get();

    // No tenant owns this account id → there is no subdomain to route back to;
    // stay on the apex with an error param.
    if (tenantsSnapshot.empty) {
      return NextResponse.redirect(new URL('/?error=connect_tenant_not_found', apexUrl));
    }

    await adminDb.collection('tenants').doc(tenantsSnapshot.docs[0].id).update({
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
    // The admin finished Stripe onboarding but neither the tenant's
    // stripeConnectStatus nor any linked user's affiliateConnectStatus was
    // persisted: the tenant still can't take donations and affiliate payouts stay
    // pending, while the only signal is an `?error=` query param on a redirect.
    captureMoneyPathError(error, { step: 'stripe-connect-callback', level: 'error' });
    // tenantId may not be resolved here → stay on the apex.
    return NextResponse.redirect(new URL('/?error=connect_callback_failed', apexUrl));
  }
}
