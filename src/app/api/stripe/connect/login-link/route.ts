import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { requireOwner } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { getTenantPrivate } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

/**
 * Where a STANDARD account holder signs in — with their own credentials, to
 * their own Stripe account. Not a credential, not single-use, and not
 * account-specific: it is the same public URL for every church, which is why it
 * can be handed back verbatim.
 */
const STRIPE_DASHBOARD_URL = 'https://dashboard.stripe.com';

/**
 * Send a church to its own Stripe dashboard — by whichever mechanism its
 * account type actually supports.
 *
 * ─── THE-137: why this route has to exist at all ─────────────────────────────
 *
 * Harvest used to create EXPRESS connected accounts. An Express account holder
 * has no Stripe password — Express onboarding collects business and bank details
 * and never credentials — so `https://dashboard.stripe.com` is a login wall they
 * can never pass. The settings "Manage Stripe Dashboard" control pointed there,
 * which meant every church that connected Stripe had NO route to its own
 * payouts, balance, payout schedule or bank details. `accounts.createLoginLink`
 * is the only mechanism that works for Express, and nothing in this repo used it
 * before.
 *
 * ─── 🔴 THE-145 PR 2: and why it now has two answers ─────────────────────────
 *
 * `/api/stripe/connect` creates STANDARD accounts from now on, because donations
 * are direct charges and a direct charge debits disputes from the church's own
 * balance. `createLoginLink` is Express-only and is the wrong mechanism for a
 * Standard account — a Standard holder has a real Stripe account with their own
 * credentials, and signs in at `dashboard.stripe.com` themselves. Which is
 * precisely what the button did before #311: for a Standard account that
 * destination was never broken, and the login wall THE-137 removed is a door
 * they hold the key to.
 *
 * So this route dispatches on the account type rather than assuming one:
 *
 *   - `standard` → the Stripe Dashboard URL. No link is minted; there is no
 *     Stripe call to make and nothing single-use to protect.
 *   - `express`  → `createLoginLink`, unchanged. ⚠️ KEEP THIS BRANCH. Every
 *     account connected before that switch is still Express and cannot be
 *     converted (Stripe fixes the type at creation), affiliate payout accounts
 *     are deliberately still Express, and this is their only way in.
 *   - anything else → refused loudly, exactly as before.
 *
 * 🔴 THE TYPE IS DECIDED SERVER-SIDE, and has to be. The account id lives on
 * `tenant_private` (`allow read, write: if false`) and never reaches a browser,
 * so the client cannot know which mechanism applies. It gets a `url` and
 * navigates to it, the same for both — which is also why this needed no change
 * in `PaymentSection`.
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
 *    `stripeConnectAccountId` off `tenant_private` and hands back a destination.
 *    Account lifecycle belongs to `/api/stripe/connect`, untouched by this file.
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

    // ⚠️ Two types reach a dashboard, and nothing else does — loudly. A login
    // link is unavailable for Custom, and `none` is not a dashboard-bearing
    // account at all. If this fires, the account type changed underneath us and
    // the RIGHT destination for the button changed with it — that is a platform
    // fault to be paged about, not something to paper over by silently falling
    // back to a destination the holder cannot use.
    const isStandard = account.type === 'standard';
    if (!isStandard && account.type !== 'express') {
      captureMoneyPathError(
        new Error(`Connect account is '${account.type}', neither 'standard' nor 'express' — no dashboard destination`),
        { step: 'stripe-express-login-link', level: 'error', tenantId },
      );
      return NextResponse.json(
        { error: 'This Stripe account does not support dashboard login links' },
        { status: 500 },
      );
    }

    // Onboarding not finished → back into onboarding, for BOTH types, and for
    // the same underlying reason: there is no dashboard to reach yet.
    //
    //   - Express: `createLoginLink` errors outright for such an account, and
    //     Stripe's documented remedy is an account link instead. Checking first
    //     beats letting Stripe raise and showing a dialog with no way forward.
    //   - Standard: a church that walked away part-way through Connect Onboarding
    //     never finished creating its Stripe login, so `dashboard.stripe.com`
    //     would be exactly the login wall THE-137 exists to stop showing them.
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

    // 🔴 Standard: the church signs in to its OWN Stripe account. No link is
    // minted — there is no Stripe call to make, nothing single-use, and nothing
    // this route could hand over that the holder does not already possess.
    //
    // ⚠️ The bare dashboard root, NOT `dashboard.stripe.com/{account_id}`. The
    // deep link would put the account id in a response body, and this route's
    // whole contract is that the id never reaches a browser. A holder with
    // several Stripe accounts picks theirs after signing in; that is a click,
    // against a leaked server-only identifier.
    if (isStandard) {
      return NextResponse.json({ url: STRIPE_DASHBOARD_URL });
    }

    // Express: minted per click. Nothing here writes it anywhere.
    const loginLink = await stripe.accounts.createLoginLink(accountId);

    return NextResponse.json({ url: loginLink.url });
  } catch (error: any) {
    console.error('Stripe Express login link error:', error?.message || error);
    captureMoneyPathError(error, { step: 'stripe-express-login-link', level: 'error' });
    return NextResponse.json({ error: 'Failed to open your Stripe dashboard' }, { status: 500 });
  }
}
