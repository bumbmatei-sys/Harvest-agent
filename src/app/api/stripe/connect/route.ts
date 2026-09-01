import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { resolveReturnBaseUrl } from '@/lib/connect-return-url';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { tenantPrivateRef, getTenantPrivate } from '@/lib/tenant-private';
import { STRIPE_CONNECT_ENABLED, STRIPE_CONNECT_HIDDEN_MESSAGE } from '@/lib/stripe-connect-feature';

export const dynamic = 'force-dynamic';

// 🔴 THE-256 — refused while Stripe Connect is hidden, and THE ROUTE THIS
// TICKET EXISTS FOR. `stripe.accounts.create()` below runs against the platform
// account Stripe closed as `rejected.fraud`, so without this an admin pressing
// Connect Stripe got a raw Stripe API error through an `alert()`.
//
// ⚠️ AHEAD OF `requireAuth`, ahead of Firestore and ahead of the Stripe client,
// so the route answers identically to every caller and touches no data at all.
// Nothing below is deleted: the Standard-account creation, the existing-account
// branch, the affiliate mirror and the account link are all intact behind the
// switch, and a church already connected keeps its account id and its status.
export async function POST(request: NextRequest) {
  if (!STRIPE_CONNECT_ENABLED) {
    return NextResponse.json({ error: STRIPE_CONNECT_HIDDEN_MESSAGE }, { status: 503 });
  }
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
    // Build the return/refresh URLs from the host the admin STARTED on (their
    // tenant subdomain or the apex), allowlist-validated so a spoofed Host can't
    // open-redirect. The final destination is unchanged: the connect callback
    // still routes the admin to their own tenant subdomain from the account's
    // tenant doc — this only keeps the intermediate hop on the same host.
    const baseUrl = resolveReturnBaseUrl(request);

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

    // Check if already connected — the account id lives on the server-only
    // tenant_private doc (status stays on the public tenant doc).
    const existingAccountId = (await getTenantPrivate(tenantId)).stripeConnectAccountId;
    if (existingAccountId) {
      // Ensure the affiliate mirror points at the canonical account, even for
      // tenants connected before unification. Mirror the tenant's current status
      // too so a fully-onboarded account is immediately payout-ready for affiliate
      // commissions (account.updated may not fire again for an existing account).
      if (mirrorSafe(existingAccountId)) {
        await connectingUserRef.set({
          affiliateStripeAccountId: existingAccountId,
          ...(tenantData.stripeConnectStatus ? { affiliateConnectStatus: tenantData.stripeConnectStatus } : {}),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      // Create a new account link for existing account
      const accountLink = await stripe.accountLinks.create({
        account: existingAccountId,
        refresh_url: `${baseUrl}/?section=payment`,
        return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${existingAccountId}`,
        type: 'account_onboarding',
      });
      return NextResponse.json({ url: accountLink.url });
    }

    // ─── 🔴 STANDARD, not Express (THE-145 PR 2) ─────────────────────────────
    //
    // #316 made donations DIRECT charges, so Stripe now debits a disputed gift
    // from the CHURCH's balance. Stripe pairs that with Standard, not Express:
    // "Direct charges are recommended for connected accounts with access to the
    // full Stripe Dashboard, which includes Standard accounts." Standard is in
    // fact the only account type whose supported charge type is direct-only.
    //
    // The pairing matters because of what the church can then DO about that
    // debit. An Express holder has no Stripe credentials and only the Express
    // Dashboard, where refunds and disputes are features the PLATFORM may or may
    // not switch on — so a disputed donation lands on the church's balance while
    // the tools to answer it stay with Harvest. A Standard account is the
    // church's OWN Stripe account: its own login at dashboard.stripe.com, its
    // own disputes and refunds, its own records, and Stripe collecting its fees
    // from it directly. For an organisation holding donor money, that is the
    // correct shape — the church is the merchant of record on a direct charge
    // either way, so it should hold the merchant's controls too.
    //
    // ⚠️ ACCOUNT LINKS ARE STILL THE RIGHT ONBOARDING MECHANISM. Both call sites
    // below (`accountLinks.create({ type: 'account_onboarding' })`) are exactly
    // what Stripe documents as "the recommended method for creating standard
    // accounts" — create with `type: 'standard'`, then send the holder through a
    // Connect Onboarding account link. OAuth is for a DIFFERENT job (an
    // extension claiming an EXISTING Stripe account) and is not needed here.
    //
    // ⚠️ THIS APPLIES TO ACCOUNTS CREATED FROM NOW ON, AND ONLY THOSE. Liability
    // and fee responsibility are fixed at creation and Stripe does not allow an
    // account's type to change afterwards, so every already-connected Express
    // account stays Express until it is re-onboarded by hand.
    //
    // ⚠️ WHAT STAYS EXPRESS FOR AFFILIATES IS AN ACCOUNT TYPE, NOT THE
    // AFFILIATE FIELDS — this route writes those. Two separate claims:
    //
    //   • THE STANDALONE, PAYOUT-ONLY AFFILIATE ACCOUNT STAYS EXPRESS. That is
    //     the one `/api/affiliate/onboard` mints for a caller with NO tenant: it
    //     is written only to `users/{uid}.affiliateStripeAccountId`, never to
    //     `tenant_private.stripeConnectAccountId`, so no church's donations
    //     resolve to it and it takes no charges at all. Money reaches it exactly
    //     one way — the platform's `transfers.create({ destination })` — so none
    //     of the direct-charge reasoning above applies and Standard would be the
    //     wrong shape. ⚠️ THAT EXEMPTION IS THE TENANT-LESS BRANCH ONLY: the
    //     tenant branch of the same route creates a 'standard' account (THE-147),
    //     because that account IS the tenant donations account and must match
    //     this one.
    //
    //   • THIS ROUTE DOES WRITE THE CONNECTING USER'S AFFILIATE FIELDS, in both
    //     branches — `affiliateStripeAccountId` (plus `affiliateConnectStatus`,
    //     mirrored from the tenant above and set to 'pending' below) — pointing
    //     them at the tenant's Standard account. That is the unified-account
    //     mirror documented at the top of this handler, not an exception to it.
    //     The one thing never overwritten is a DIFFERENT affiliate account that
    //     is already `active`, which `mirrorSafe` refuses; a user with no
    //     account, one already on this account, or one that is not active IS
    //     repointed.
    const account = await stripe.accounts.create({
      type: 'standard',
      metadata: {
        tenantId,
        tenantName: tenantData.name || '',
        app: 'harvest',
      },
    });

    // Save the account ID (server-only tenant_private) and set the public
    // status to pending — one batch.
    const now = new Date().toISOString();
    const batch = adminDb.batch();
    batch.update(adminDb.collection('tenants').doc(tenantId), {
      stripeConnectStatus: 'pending',
      updatedAt: now,
    });
    batch.set(tenantPrivateRef(tenantId), { stripeConnectAccountId: account.id, updatedAt: now }, { merge: true });
    await batch.commit();

    // Mirror onto the connecting user so the SAME account also powers their
    // affiliate payouts. Status starts 'pending'; the connect callback and
    // account.updated webhook flip it to 'active' once onboarding completes.
    // (`deriveConnectStatus` reads charges_enabled / payouts_enabled /
    // requirements.currently_due — all populated on a Standard account exactly as
    // on an Express one, so neither reconciliation path changes here.)
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
    // This catch also covers the account-id persistence between account creation
    // and the onboarding link, so it can mean a live Stripe account exists that no
    // tenant or user doc points at — the tenant cannot take donations and the
    // orphaned account is invisible to the app.
    captureMoneyPathError(error, { step: 'stripe-connect-onboarding', level: 'error' });
    return NextResponse.json({ error: 'Failed to create Stripe Connect account' }, { status: 500 });
  }
}
