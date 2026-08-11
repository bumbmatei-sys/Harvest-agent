import DodoPayments from 'dodopayments';
import type { TenantPlan } from '@/types/tenant.types';
import { dodoConfig } from './config';
import { catalogueEntry, resolvePlanFromProductId } from './catalogue';
import type {
  BillingPeriod,
  BillingSubscription,
  BillingSubscriptionStatus,
  CancelSubscriptionOptions,
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

  resolvePlanFromProductRef(
    productRef: string,
  ): { plan: TenantPlan; period: BillingPeriod } | null {
    // Dodo puts the price on the product, so the app's "product reference" IS a
    // Dodo product id. A Stripe implementation would resolve a price id here.
    return resolvePlanFromProductId(productRef);
  },
};
