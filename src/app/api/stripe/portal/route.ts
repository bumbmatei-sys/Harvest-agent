import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { getTenantPrivate } from '@/lib/tenant-private';
import { resolveBillingOwnership } from '@/lib/billing-processor';
import { dodoBillingProvider } from '@/lib/dodo/dodo-provider';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { requireAuth } from '@/lib/api-auth';

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
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const body = await request.json();
    const { tenantId } = body;

    // Verify tenant membership
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

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

    // ── Stripe-owned (and the no-identifier default): unchanged. ─────────────
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const customerId = privateData.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json({ error: 'No Stripe subscription found. Please subscribe first.' }, { status: 400 });
    }

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
