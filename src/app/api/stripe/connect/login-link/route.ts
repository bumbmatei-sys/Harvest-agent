import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { requireOwner } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { getTenantPrivate } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

/**
 * Mint a single-use link into a church's own Express dashboard.
 *
 * ─── THE-137: why this route has to exist at all ─────────────────────────────
 *
 * Harvest creates EXPRESS connected accounts (`accounts.create({ type:
 * 'express' })`). An Express account holder has no Stripe password — Express
 * onboarding collects business and bank details and never credentials — so
 * `https://dashboard.stripe.com` is a login wall they can never pass. The
 * settings "Manage Stripe Dashboard" control pointed there, which meant every
 * church that connected Stripe had NO route to its own payouts, balance, payout
 * schedule or bank details. `accounts.createLoginLink` is the only mechanism
 * that works for Express, and nothing in this repo used it before.
 *
 * ─── 🔴 THE GATE: requireOwner, not a tenant match ───────────────────────────
 *
 * A login link is the most privileged thing this platform can hand out. It is a
 * session inside the church's Stripe account: payout history, bank account
 * details, and the ability to CHANGE WHERE THE MONEY LANDS. Whoever holds one
 * can redirect the congregation's giving to their own bank.
 *
 * `/api/stripe/connect` (onboarding) gates on `!isSuperAdmin && tenantId !==
 * body.tenantId`. That is a MEMBERSHIP test, and a member is anyone who signed
 * up through the church's public subdomain — the congregation. It is defensible
 * for onboarding, which only ever starts a Stripe-hosted form. It is not
 * defensible for this: it would hand every member of every congregation the
 * keys to their church's bank details.
 *
 * `requireOwner` is the same gate THE-80 tightened the checkout/portal paths to,
 * for the same reason, and it admits exactly three identities: the tenant's
 * `ownerId`, a `tenant_private.adminEmails` roster admin (🔴 THE-64 — their
 * entitlement is not on their user doc, and a check that reads only the user doc
 * locks out a legitimate owner), and the super admin. A volunteer with the admin
 * role managing events gets 403.
 *
 * Strictly: reaching a church's bank details is at least as privileged as
 * changing its plan, so this must not be gated more loosely than plan change is.
 *
 * ─── What this route may and may not do ──────────────────────────────────────
 *
 *  - It NEVER creates, modifies or deletes a Stripe account. It reads
 *    `stripeConnectAccountId` off `tenant_private` and mints a link. Account
 *    lifecycle belongs to `/api/stripe/connect`, untouched by this file.
 *  - 🔴 The link is NEVER persisted or cached — not in Firestore, not in a
 *    module-level variable, not in the client bundle. It is single-use and
 *    short-lived, so a stored one is both broken and a stored credential. One
 *    click, one link, minted server-side, handed straight back.
 *  - The response carries the link and nothing else: no account id, no key.
 *    The account id is server-only (`tenant_private` is `allow read, write: if
 *    false`) and there is no reason for a browser to learn it.
 */
export async function POST(request: NextRequest) {
  try {
    // Parsed before the gate only because the gate needs the candidate tenant.
    // It is a CANDIDATE, never a grant: `requireOwner` re-proves it, and the
    // tenant this route acts on is the one it hands back — never the raw body
    // value. That is what keeps a member of church A from ever naming church B.
    const body = await request.json().catch(() => ({}));
    const requestedTenantId: string | undefined = body?.tenantId;

    // 🔴 Before Stripe, before Firestore, before anything.
    // `{ tenantId }` is passed for the two identities a token cannot resolve on
    // its own — an apex super admin (`tenantId: null`) and a roster admin whose
    // user doc carries no tenantId. Both are re-proved inside.
    const ownerOrErr = await requireOwner(request, { tenantId: requestedTenantId });
    if (ownerOrErr instanceof NextResponse) return ownerOrErr;
    const tenantId = ownerOrErr.tenantId;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    // Server-only doc. The id never leaves this function.
    const accountId: string | undefined = (await getTenantPrivate(tenantId)).stripeConnectAccountId;

    // Never connected. Not an error — there is simply nothing to log in to yet,
    // and the honest answer is the onboarding flow. The client starts it via the
    // existing `/api/stripe/connect`; this route does not mint account links.
    if (!accountId) {
      return NextResponse.json({ onboardingRequired: true, reason: 'not_connected' });
    }

    const account = await stripe.accounts.retrieve(accountId);

    // ⚠️ Express only, loudly. A login link is meaningless for a Standard account
    // (whose holder logs in at dashboard.stripe.com with their own credentials)
    // and unavailable for Custom. If this ever fires, the account type changed
    // underneath us and the RIGHT destination for the button changed with it —
    // that is a platform fault to be paged about, not something to paper over by
    // silently falling back to a link the holder cannot use.
    if (account.type !== 'express') {
      captureMoneyPathError(
        new Error(`Connect account is '${account.type}', not 'express' — login link is the wrong mechanism`),
        { step: 'stripe-express-login-link', level: 'error', tenantId },
      );
      return NextResponse.json(
        { error: 'This Stripe account does not support dashboard login links' },
        { status: 500 },
      );
    }

    // `createLoginLink` errors outright for an account that has not finished
    // onboarding, and Stripe's documented remedy is an account link instead. So
    // check first and route them back into onboarding — the churn that gets them
    // to a working dashboard — rather than letting Stripe raise and showing an
    // error dialog that offers no way forward.
    //
    // 🔴 `details_submitted` is the right signal, and deliberately NOT
    // `deriveConnectStatus(account) === 'active'`. That derivation reports
    // 'restricted' whenever Stripe has fresh `currently_due` requirements — and a
    // restricted church still has a real dashboard, still has money in it, and
    // the dashboard is exactly where they go to see what is holding their payouts
    // up. Gating on 'active' would lock a church out of its own balance at the
    // one moment it most needs to look at it.
    if (!account.details_submitted) {
      return NextResponse.json({ onboardingRequired: true, reason: 'onboarding_incomplete' });
    }

    // Minted per click. Nothing here writes it anywhere.
    const loginLink = await stripe.accounts.createLoginLink(accountId);

    return NextResponse.json({ url: loginLink.url });
  } catch (error: any) {
    console.error('Stripe Express login link error:', error?.message || error);
    captureMoneyPathError(error, { step: 'stripe-express-login-link', level: 'error' });
    return NextResponse.json({ error: 'Failed to open your Stripe dashboard' }, { status: 500 });
  }
}
