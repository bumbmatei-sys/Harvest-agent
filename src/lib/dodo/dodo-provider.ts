import DodoPayments from 'dodopayments';
import type { TenantPlan } from '@/types/tenant.types';
import { dodoConfig } from './config';
import { catalogueEntry, resolvePlanFromProductId } from './catalogue';
import type {
  BillingPeriod,
  BillingSubscription,
  BillingSubscriptionStatus,
  CancelSubscriptionOptions,
  CustomerPortalRequest,
  CustomerPortalSession,
  PlanCheckout,
  PlanCheckoutRequest,
  SubscriptionBillingProvider,
} from './provider';

/**
 * The Dodo Payments implementation of `SubscriptionBillingProvider`.
 *
 * Everything Dodo-shaped stops here. Product ids, `product_cart`, `on_hold`,
 * `cancel_at_next_billing_date` — none of those words appear on the far side of
 * this file, which is what makes the seam in `provider.ts` worth having.
 *
 * ⚠️ NOTHING IN THE APP CALLS THIS YET. Signup goes through Stripe until REP-4
 * PR 2 deliberately switches it.
 */

/**
 * Dodo subscription status → Harvest status.
 *
 * Exhaustive over Dodo's documented state machine, and an unknown value maps to
 * `pending` rather than `active`: a state this build has never heard of must not
 * be read as "keep serving them", and must not be read as "cut them off" either.
 */
const DODO_STATUS_TO_BILLING_STATUS: Record<string, BillingSubscriptionStatus> = {
  pending: 'pending',
  active: 'active',
  on_hold: 'grace',
  paused: 'paused',
  cancelled: 'cancelled',
  expired: 'expired',
  failed: 'failed',
};

export function toBillingStatus(dodoStatus: string): BillingSubscriptionStatus {
  return DODO_STATUS_TO_BILLING_STATUS[dodoStatus] ?? 'pending';
}

/** Dodo's metadata values are strings; anything else is dropped rather than coerced. */
function toStringMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * A Dodo subscription payload, narrowed to the fields this module reads.
 *
 * Declared locally rather than imported from the SDK so that the mapping below
 * is a stated expectation about Dodo's response, checked in one place, instead of
 * an SDK type change silently altering what the app believes.
 */
export interface DodoSubscriptionLike {
  subscription_id: string;
  status: string;
  product_id: string;
  cancel_at_next_billing_date?: boolean | null;
  next_billing_date?: string | null;
  trial_period_days?: number | null;
  /** ISO 8601. When the subscription was created — the trial's own start. */
  created_at?: string | null;
  customer?: { customer_id?: string | null } | null;
  metadata?: unknown;
}

/** Dodo subscription payload → the app's `BillingSubscription`. */
export function toBillingSubscription(sub: DodoSubscriptionLike): BillingSubscription {
  const resolved = resolvePlanFromProductId(sub.product_id);
  return {
    id: sub.subscription_id,
    status: toBillingStatus(sub.status),
    plan: resolved?.plan ?? null,
    period: resolved?.period ?? null,
    cancelAtPeriodEnd: sub.cancel_at_next_billing_date === true,
    currentPeriodEndsAt: sub.next_billing_date ?? null,
    trialDays: sub.trial_period_days ?? 0,
    customerId: sub.customer?.customer_id ?? null,
    metadata: toStringMetadata(sub.metadata),
  };
}

/**
 * The proration mode for every Harvest plan change, chosen once, here.
 *
 * `prorated_immediately`: an upgrade charges only the difference for the days
 * left in the current cycle, and a downgrade turns the unused value into a
 * subscription-scoped CREDIT that Dodo applies to future renewals. The credit
 * direction matters: Harvest issues no refunds, and credit-on-downgrade is the
 * one behaviour consistent with that — nothing here may ever grow a refund.
 *
 * The other modes were considered and rejected:
 *   - `difference_immediately` charges the FULL tier difference regardless of
 *     how far into the cycle the church is — a day-29 upgrade pays a whole
 *     month's difference for one day of service.
 *   - `full_immediately` charges the whole new price with no credit at all.
 *   - `do_not_bill` grants the higher tier free until the next renewal, which
 *     is an abuse hole (upgrade on day 1, downgrade on day 29, repeat).
 *
 * ⚠️ Like the three other immediate modes, this RESETS the billing cycle to the
 * change date. The affiliate commission window is NOT affected: its anchor is
 * the subscription's own creation instant (`created_at`), which a plan change
 * does not move — the subscription is modified in place, same id, same
 * creation timestamp.
 */
export const DODO_PLAN_CHANGE_PRORATION_MODE = 'prorated_immediately' as const;

/**
 * 🔴 ALWAYS SENT EXPLICITLY, on the preview and on the real call.
 *
 * Dodo's dashboard default is `apply_change`, which grants the higher tier even
 * when the payment for it FAILS. The dashboard setting is currently
 * `prevent_change`, but a dashboard setting can be edited without a code
 * review; an explicit parameter cannot. A failed upgrade payment must leave the
 * church exactly where it was.
 */
export const DODO_PLAN_CHANGE_ON_PAYMENT_FAILURE = 'prevent_change' as const;

/** What a plan change would do to the customer's money, before it is real. */
export interface DodoPlanChangePreview {
  /**
   * Charged NOW if the change is confirmed, in the currency's minor units.
   * 0 for a downgrade (nothing is charged; unused value becomes credit).
   */
  readonly amountDueNow: number;
  /**
   * Credit movement in minor units, as Dodo reports it: POSITIVE when credit is
   * added to the subscription (a downgrade), NEGATIVE when existing credit was
   * consumed to offset the charge, 0 when no credit moved.
   */
  readonly creditMovement: number;
  readonly currency: string;
}

let cachedClient: DodoPayments | null = null;

/** The SDK client, built from the validated config on first use. */
function client(): DodoPayments {
  if (!cachedClient) {
    cachedClient = new DodoPayments({
      bearerToken: dodoConfig.apiKey,
      environment: dodoConfig.environment,
    });
  }
  return cachedClient;
}

/** Test seam: replace or reset the SDK client. Not used by production code. */
export function __setDodoClientForTests(stub: DodoPayments | null): void {
  cachedClient = stub;
}

export const dodoBillingProvider: SubscriptionBillingProvider = {
  id: 'dodo',

  async createPlanCheckout(request: PlanCheckoutRequest): Promise<PlanCheckout> {
    const entry = catalogueEntry(request.plan, request.period);

    const session = await (client().checkoutSessions.create as (body: unknown) => Promise<{
      session_id: string;
      checkout_url: string;
    }>)({
      product_cart: [{ product_id: entry.productId, quantity: 1 }],
      customer: { email: request.customer.email, name: request.customer.name },
      return_url: request.returnUrl,
      cancel_url: request.cancelUrl,
      metadata: request.metadata,
      // Omitted entirely when the caller does not override, so the product's own
      // configured trial applies. Sending `undefined` explicitly would be a
      // request to change the trial to nothing on some API shapes.
      ...(request.trialDays === undefined
        ? {}
        : { subscription_data: { trial_period_days: request.trialDays } }),
    });

    return { url: session.checkout_url, reference: session.session_id };
  },

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    const sub = (await client().subscriptions.retrieve(subscriptionId)) as unknown as DodoSubscriptionLike;
    return toBillingSubscription(sub);
  },

  async cancelSubscription(
    subscriptionId: string,
    options: CancelSubscriptionOptions,
  ): Promise<BillingSubscription> {
    if (options.atPeriodEnd) {
      // Keep serving the period they already paid for, then stop renewing.
      await client().subscriptions.update(subscriptionId, {
        cancel_at_next_billing_date: true,
      });
    } else {
      await (client().subscriptions.update as (id: string, body: unknown) => Promise<unknown>)(
        subscriptionId,
        { status: 'cancelled' },
      );
    }
    return this.getSubscription(subscriptionId);
  },

  async createCustomerPortal(request: CustomerPortalRequest): Promise<CustomerPortalSession> {
    // Dodo's hosted portal covers cancel (immediately or at the next billing
    // date), payment-method update, on-hold reactivation, and invoice/receipt
    // download — the same surface the Stripe billing portal gives a Stripe
    // tenant, which is why routing `/api/stripe/portal` here is a real
    // equivalent rather than a placeholder.
    //
    // `send_email` is deliberately not set: the app redirects the admin who is
    // standing in front of it, and mailing a billing link to the customer record
    // would be a second, unrequested delivery of a single-use credential.
    const session = await client().customers.customerPortal.create(request.customerId, {
      return_url: request.returnUrl,
    });
    return { url: session.link };
  },

  resolvePlanFromProductRef(
    productRef: string,
  ): { plan: TenantPlan; period: BillingPeriod } | null {
    // Dodo puts the price on the product, so the app's "product reference" IS a
    // Dodo product id. A Stripe implementation would resolve a price id here.
    return resolvePlanFromProductId(productRef);
  },
};

// ─── Plan change (THE-89) ────────────────────────────────────────────────────
//
// Standalone functions rather than new `SubscriptionBillingProvider` methods,
// deliberately: THE-126 (the full processor-neutral seam) is its own issue, and
// widening the interface here would force every implementation — including the
// seam test's Ledger stub — to grow a plan-change story before that design is
// had. The one caller is `/api/dodo/change-plan`, which is a Dodo route and may
// import the Dodo module directly, same as `/api/dodo/checkout` does.

/**
 * What confirming a plan change would charge, before anything is charged.
 *
 * A church committing to a proration it cannot see is the statement-PDF bug in
 * a different shape, so the route shows this to the owner before it will accept
 * a confirm.
 */
export async function previewDodoPlanChange(
  subscriptionId: string,
  plan: TenantPlan,
  period: BillingPeriod,
): Promise<DodoPlanChangePreview> {
  const entry = catalogueEntry(plan, period);
  const preview = await client().subscriptions.previewChangePlan(subscriptionId, {
    product_id: entry.productId,
    quantity: 1,
    proration_billing_mode: DODO_PLAN_CHANGE_PRORATION_MODE,
    // Sent on the preview too, so what is previewed is exactly what will run.
    on_payment_failure: DODO_PLAN_CHANGE_ON_PAYMENT_FAILURE,
  });
  const summary = preview?.immediate_charge?.summary;
  return {
    amountDueNow: typeof summary?.total_amount === 'number' ? summary.total_amount : 0,
    creditMovement: typeof summary?.customer_credits === 'number' ? summary.customer_credits : 0,
    currency: typeof summary?.currency === 'string' ? summary.currency : 'USD',
  };
}

/**
 * Move a subscription to a new plan. Charges (or credits) per the proration
 * mode above; the tenant's own `plan` field is NOT written here — that is the
 * `subscription.plan_changed` webhook's job (see `./plan-change`), the single
 * writer, because a plan change can also originate outside this app entirely
 * (Dodo's dashboard, or its customer portal once the products join a
 * collection) and only the webhook sees those.
 */
export async function executeDodoPlanChange(
  subscriptionId: string,
  plan: TenantPlan,
  period: BillingPeriod,
): Promise<void> {
  const entry = catalogueEntry(plan, period);
  await client().subscriptions.changePlan(subscriptionId, {
    product_id: entry.productId,
    quantity: 1,
    proration_billing_mode: DODO_PLAN_CHANGE_PRORATION_MODE,
    // 🔴 Explicit, always. See the constant's note: the dashboard default is
    // `apply_change`, which grants the tier even when the payment fails.
    on_payment_failure: DODO_PLAN_CHANGE_ON_PAYMENT_FAILURE,
  });
}

/**
 * Is this subscription still inside its free trial?
 *
 * 🔴 Dodo has no trial status: EVERY proration mode ends a trial (the three
 * immediate modes charge right away; even `do_not_bill` ends it), so a plan
 * change during the 14-day card-up-front trial would silently charge a church
 * days 4–14 it was promised for free. The route refuses the change instead,
 * and this is the check it refuses on.
 *
 * Two detections, EITHER of which counts as in-trial, because each covers the
 * other's blind spot:
 *
 *  1. Date arithmetic — `created_at + trial_period_days` is still ahead of now.
 *     Covers the moments right after signup when Dodo's payment list may not
 *     yet show the $0 mandate payment.
 *  2. Dodo's own documented workaround for free trials — exactly one payment,
 *     for exactly $0. Covers a trial that was EXTENDED in the dashboard past
 *     its original arithmetic end (no real charge has landed yet).
 *
 * The union errs toward refusing, which is the recoverable direction: a
 * refused change can be retried after the trial; an early charge cannot be
 * unmade (Harvest issues no refunds).
 */
export async function isDodoSubscriptionInTrial(subscriptionId: string): Promise<boolean> {
  const sub = (await client().subscriptions.retrieve(subscriptionId)) as unknown as DodoSubscriptionLike;

  const trialDays = sub.trial_period_days ?? 0;
  if (trialDays > 0 && typeof sub.created_at === 'string') {
    const createdMs = Date.parse(sub.created_at);
    if (Number.isFinite(createdMs) && Date.now() < createdMs + trialDays * 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  const payments = await client().payments.list({ subscription_id: subscriptionId });
  const items: Array<{ total_amount?: number }> = (payments as unknown as { items?: Array<{ total_amount?: number }> })?.items ?? [];
  return items.length === 1 && items[0]?.total_amount === 0;
}
