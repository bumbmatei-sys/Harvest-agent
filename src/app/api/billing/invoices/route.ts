import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { requireOwner } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/invoices — owner-only.
 *
 * Lists the tenant's Stripe invoices (each subscription charge), newest first,
 * plus a subscription summary (plan, status, next billing date + amount) so the
 * Billing & Payments page can render the whole picture from one call.
 *
 * Response:
 *   {
 *     subscription: { plan, status, currentPeriodEnd, nextAmount, currency,
 *                     cancelAtPeriodEnd } | null,
 *     invoices: [{ id, date, amount, currency, status, invoicePdf, hostedUrl }]
 *   }
 *
 * Amounts are in the currency's minor unit (cents); dates are Unix seconds.
 * The owner gate (requireOwner) resolves the tenant from the caller's own token
 * and 403s any non-owner — hiding the UI is not enough.
 */
export async function GET(request: NextRequest) {
  try {
    const ownerOrResponse = await requireOwner(request);
    if (ownerOrResponse instanceof NextResponse) return ownerOrResponse;
    const { tenantData } = ownerOrResponse;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const customerId: string | undefined = tenantData.stripeCustomerId;
    const subscriptionId: string | undefined = tenantData.stripeSubscriptionId;

    // No customer yet (e.g. a legacy/free tenant) — nothing to bill against.
    if (!customerId) {
      return NextResponse.json({ subscription: null, invoices: [] });
    }

    // Subscription summary: plan/status come from the tenant doc (kept in sync by
    // the Stripe webhook); the billing date + amount come from Stripe directly.
    let subscription: {
      plan: string | null;
      status: string | null;
      currentPeriodEnd: number | null;
      nextAmount: number | null;
      currency: string;
      cancelAtPeriodEnd: boolean;
    } | null = null;

    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        // In the current Stripe API version (dahlia) current_period_end lives on
        // the subscription item, not the top-level subscription.
        const item = sub.items?.data?.[0];
        const nextAmount = item?.price?.unit_amount != null
          ? item.price.unit_amount * (item.quantity || 1)
          : null;
        subscription = {
          plan: tenantData.plan ?? null,
          status: tenantData.status ?? sub.status ?? null,
          currentPeriodEnd: item?.current_period_end ?? null,
          nextAmount,
          currency: item?.price?.currency || 'usd',
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        };
      } catch (subErr) {
        console.warn('billing/invoices: failed to load subscription:', subErr);
        subscription = {
          plan: tenantData.plan ?? null,
          status: tenantData.status ?? null,
          currentPeriodEnd: null,
          nextAmount: null,
          currency: 'usd',
          cancelAtPeriodEnd: false,
        };
      }
    } else {
      subscription = {
        plan: tenantData.plan ?? null,
        status: tenantData.status ?? null,
        currentPeriodEnd: null,
        nextAmount: null,
        currency: 'usd',
        cancelAtPeriodEnd: false,
      };
    }

    const list = await stripe.invoices.list({ customer: customerId, limit: 100 });
    const invoices = list.data.map((inv) => ({
      id: inv.id,
      date: inv.created,
      amount: inv.amount_paid || inv.total,
      currency: inv.currency,
      status: inv.status,
      invoicePdf: inv.invoice_pdf,
      hostedUrl: inv.hosted_invoice_url,
    }));

    return NextResponse.json({ subscription, invoices });
  } catch (error) {
    console.error('billing/invoices error:', error);
    return NextResponse.json({ error: 'Failed to load billing history' }, { status: 500 });
  }
}
