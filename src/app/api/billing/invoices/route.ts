import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { requireOwner } from '@/lib/api-auth';
import { getTenantPrivate } from '@/lib/tenant-private';
import { resolveBillingOwnership } from '@/lib/billing-processor';
import { getDodoRenewalSummary } from '@/lib/dodo/renewal';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

/** ISO 8601 → Unix seconds, the unit this route's `currentPeriodEnd` is in. */
function toUnixSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * The renewal schedule for a Dodo-owned tenant, or nulls when it cannot be read.
 *
 * 🔴 DEGRADES, NEVER THROWS. A Dodo outage must cost this church its renewal
 * DATE, not its billing screen — the same trade the Stripe branch below makes
 * when `subscriptions.retrieve` fails. The plan and status come from the tenant
 * doc either way and stay accurate.
 *
 * No subscription id is the other degrade path, and it is not an error: a Dodo
 * tenant carrying only `dodoCustomerId` (the field `resolveBillingOwnership`
 * also accepts as proof of Dodo ownership) has nothing to look up.
 */
async function dodoRenewal(subscriptionId: unknown): Promise<{
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}> {
  if (typeof subscriptionId !== 'string' || !subscriptionId) {
    return { currentPeriodEnd: null, cancelAtPeriodEnd: false };
  }
  try {
    const renewal = await getDodoRenewalSummary(subscriptionId);
    return {
      currentPeriodEnd: toUnixSeconds(renewal.nextBillingDate),
      cancelAtPeriodEnd: renewal.cancelAtPeriodEnd,
    };
  } catch (err) {
    console.warn('billing/invoices: failed to load Dodo subscription:', err);
    captureHandledError(err, { step: 'billing-dodo-renewal-load', level: 'warning' });
    return { currentPeriodEnd: null, cancelAtPeriodEnd: false };
  }
}

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

    const privData = await getTenantPrivate(ownerOrResponse.tenantId);
    const ownership = resolveBillingOwnership(privData);

    // ── Not Stripe's tenant: say so, do not answer for Stripe. ───────────────
    //
    // This route is a READ, so it cannot double-charge anyone — but answering a
    // Dodo-billed church out of Stripe's ledger reports "No payments yet" and an
    // em-dash where their renewal date should be, to an owner who is being
    // charged every month. That is not a blank screen, it is a wrong one, and it
    // is the screen a treasurer would check first when reconciling.
    //
    // The plan and status below come from the tenant doc and ARE accurate for a
    // Dodo tenant; only the Stripe-sourced fields are withheld. `historySource`
    // tells the client where the real history lives — the Dodo customer portal,
    // reachable from the same page's "Manage subscription" button.
    //
    // ─── The renewal date, for a tenant Dodo owns (THE-131) ──────────────────
    //
    // `currentPeriodEnd` used to be a hard null here, so a Dodo-billed church saw
    // "No active subscription" under Next Billing while its card was being
    // charged every month. A church that cannot see its renewal date cannot
    // budget for it, and a surprise charge is the most common trigger for a
    // chargeback — so the date is read from Dodo, which is the only authority on
    // it, through the one read-only function in `@/lib/dodo/renewal`.
    //
    // ⚠️ `reason === 'conflict'` is deliberately NOT given the same read. A
    // conflicted tenant carries live identifiers from BOTH processors, so there
    // is no single subscription whose date would be the true one, and showing
    // either would tell a church already being billed twice which of its two
    // charges to expect. It keeps exactly the treatment it has today.
    //
    // 🔴 STILL NO AMOUNT, and that is a decision rather than an omission. Dodo
    // reports the catalogue price (`recurring_pre_tax_amount` / `currency`) but
    // applies ADAPTIVE CURRENCY at charge time: the live subscription verified on
    // 2026-08-13 says 4900 USD while its own payment settled in RON. Nothing on
    // the subscription says which currency the card will see, so an amount here
    // would be an assertion about money this route cannot stand behind. See the
    // note in `@/lib/dodo/renewal`.
    if (ownership.processor === 'dodo' || ownership.reason === 'conflict') {
      const renewal =
        ownership.processor === 'dodo'
          ? await dodoRenewal(privData.dodoSubscriptionId)
          : { currentPeriodEnd: null, cancelAtPeriodEnd: false };

      return NextResponse.json({
        processor: ownership.processor,
        subscription: {
          plan: tenantData.plan ?? null,
          status: tenantData.status ?? null,
          currentPeriodEnd: renewal.currentPeriodEnd,
          nextAmount: null,
          currency: 'usd',
          cancelAtPeriodEnd: renewal.cancelAtPeriodEnd,
        },
        invoices: [],
        historySource: 'portal',
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const customerId: string | undefined = privData.stripeCustomerId;
    const subscriptionId: string | undefined = privData.stripeSubscriptionId;

    // No customer yet (e.g. a legacy/free tenant) — nothing to bill against.
    if (!customerId) {
      return NextResponse.json({ processor: 'stripe', subscription: null, invoices: [] });
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
        // Degrades to a null-filled summary that renders as an em-dash next to
        // "Next billing" — the owner reads that as "nothing due", not as "we
        // couldn't reach Stripe". Their real renewal date and amount are unchanged.
        console.warn('billing/invoices: failed to load subscription:', subErr);
        captureHandledError(subErr, { step: 'billing-subscription-load', level: 'warning' });
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

    return NextResponse.json({ processor: 'stripe', subscription, invoices });
  } catch (error) {
    console.error('billing/invoices error:', error);
    return NextResponse.json({ error: 'Failed to load billing history' }, { status: 500 });
  }
}
