import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { getTenantPrivate } from '@/lib/tenant-private';
import { resolveBillingOwnership, STRIPE_PLATFORM_ACCOUNT_OPERATIONAL } from '@/lib/billing-processor';
import { dodoBillingProvider } from '@/lib/dodo/dodo-provider';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { requireAuth, requireOwner } from '@/lib/api-auth';

/**
 * POST /api/stripe/portal — "Manage subscription".
 *
 * 🔴 THIS IS THE ONLY WAY OUT. Harvest has no cancel button of its own: this
 * route is what the "Manage subscription" control in Settings, on the upgrade
 * page and in the plan section all open, and the hosted portal behind it is where
 * an admin cancels, replaces a card, and reads invoices. Everything else in this
 * change may refuse a Dodo-owned tenant; THIS MUST NOT. Trapping a church in a
 * subscription it cannot exit is worse than the double billing being fixed here.
 *
 * So it routes rather than blocks: a Dodo-owned tenant gets Dodo's hosted
 * customer portal, which carries the same four capabilities. The response shape
 * is `{ url }` either way, so all three existing callers are unchanged — no
 * client needs to learn which processor a tenant is on, and a stale browser tab
 * keeps working.
 *
 * ⚠️ The path is still spelled `/api/stripe/portal`. Renaming it would mean
 * shipping a client that stale tabs do not have, on the one route that must never
 * be unavailable. It gets its honest name when the Stripe path is retired.
 *
 * 🔴 A STRIPE-OWNED TENANT NOW GETS A NAMED REFUSAL INSTEAD OF A REAL CALL
 * (THE-353). "Must never be unavailable" was never a promise that the Stripe
 * branch itself always works — it is a promise that an admin is never left
 * with no way out. With the Stripe platform account closed
 * (`STRIPE_PLATFORM_ACCOUNT_OPERATIONAL`, billing-processor.ts), the real API
 * call this branch used to make would fail every time; replacing it with an
 * immediate, actionable "contact support" refusal keeps that promise better
 * than attempting a doomed call and surfacing whatever the Stripe SDK throws.
 * This is a STATEMENT ABOUT THE ACCOUNT, not the branch: it reverts to the
 * real call the moment the flag does.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Authenticate first so an anonymous caller gets 401 rather than the 400
    // below; the owner gate then runs once the body has named the tenant.
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const body = await request.json();
    const { tenantId } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    // 🔴 OWNER-ONLY, from THE-80. The hosted portal behind this route is where a
    // subscription is CANCELLED and where the card on file is replaced — the
    // single largest change anyone can make to what this church pays. It was
    // reachable by any authenticated member of the tenant.
    //
    // ⚠️ Owner-only is the tight direction, and the tight direction has its own
    // failure mode: this is the ONLY exit from a subscription, so refusing a
    // legitimate admin traps a church. That is why the gate admits the roster
    // admin (`tenant_private.adminEmails`, no `role: 'admin'` needed) and the
    // apex super admin as well as `ownerId` — the three identities that can
    // legitimately speak for the account. A volunteer admin who is none of them
    // cannot cancel the church's plan, which is the intended outcome.
    const ownerOrErr = await requireOwner(request, { tenantId });
    if (ownerOrErr instanceof NextResponse) return ownerOrErr;

    const privateData = await getTenantPrivate(tenantId);
    const ownership = resolveBillingOwnership(privateData);

    // On a conflict, fall back to what the stored field claims. This is the ONE
    // place allowed to do that: every other path refuses an ambiguous tenant
    // because acting could charge them, but refusing HERE would leave a church
    // that is already billed twice unable to cancel either subscription. Opening
    // a portal cannot create a charge.
    const processor = ownership.processor ?? ownership.declared;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

    if (processor === 'dodo') {
      const dodoCustomerId = privateData.dodoCustomerId;
      if (!dodoCustomerId) {
        // Dodo-owned but no customer id to open a portal against. Say so plainly
        // rather than falling through to Stripe, which would open some other
        // church's billing or none at all.
        captureMoneyPathError(
          new Error('[billing] Dodo-owned tenant has no dodoCustomerId; cannot open a portal to cancel'),
          { step: 'billing-portal-dodo-customer-missing', level: 'error', tenantId },
        );
        return NextResponse.json(
          { error: 'We could not open your billing portal. Please contact support so we can cancel or update your subscription for you.' },
          { status: 409 },
        );
      }

      const session = await dodoBillingProvider.createCustomerPortal({
        customerId: dodoCustomerId,
        returnUrl: `${baseUrl}/?dodo=portal_return`,
      });
      return NextResponse.json({ url: session.url });
    }

    // ── Stripe-owned (and the no-identifier default). ────────────────────────
    const customerId = privateData.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json({ error: 'No Stripe subscription found. Please subscribe first.' }, { status: 400 });
    }

    // 🔴 The Stripe platform account behind every Stripe-owned tenant is
    // closed (`STRIPE_PLATFORM_ACCOUNT_OPERATIONAL`, billing-processor.ts) —
    // a real call below would fail every time, deep inside the Stripe SDK,
    // with no actionable message. THIS ROUTE MAY NEVER MERELY FAIL: it is the
    // only way an admin cancels a subscription or replaces a card, so a
    // known-doomed call is replaced with the same honest, actionable refusal
    // every other blocked billing path already gives, rather than attempted
    // and left to surface whatever Stripe's SDK throws.
    if (!STRIPE_PLATFORM_ACCOUNT_OPERATIONAL) {
      captureMoneyPathError(
        new Error('[billing] Stripe-owned tenant attempted portal access while the Stripe platform account is inactive'),
        { step: 'billing-portal-stripe-account-inactive', level: 'error', tenantId },
      );
      return NextResponse.json(
        {
          error: 'Your subscription is billed through a Stripe account that is not currently active, so we could not open your billing portal. Please contact support and we will cancel or update your subscription for you.',
          code: 'billing-action-unavailable',
          processor: 'stripe',
          reason: ownership.reason,
        },
        { status: 409 },
      );
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/?stripe=portal_return`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Billing portal error:', error);
    // No portal means the admin cannot cancel, cannot replace a failing card and
    // cannot read an invoice. That is the exit being closed, not a cosmetic fault.
    captureMoneyPathError(error, { step: 'billing-portal', level: 'error' });
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
  }
}
