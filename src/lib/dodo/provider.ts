/**
 * The Dodo Payments implementation of `BillingProvider`.
 *
 * ENV-FREE BY DESIGN. Everything this module needs arrives as an argument to
 * `createDodoBillingProvider`, so the provider can be exercised against a fake
 * `fetch` with no environment set. `config.ts` is the one place that reads env,
 * and `dodoProviderConfig()` there assembles the argument.
 *
 * NO SDK DEPENDENCY. Dodo's REST surface for the four operations Harvest needs
 * is four endpoints, and this file calls them with `fetch`. Adding
 * `dodopayments` would put a vendor's types one import away from the app, which
 * is exactly what the seam exists to prevent, and would drag a transitive
 * dependency into the money path for four requests. The request and response
 * shapes below were taken from Dodo's published SDK types (v2.45.1) — the same
 * source of truth the SDK itself compiles against.
 *
 * ⚠️ EVERY DODO TYPE IN THIS FILE IS LOCAL AND PRIVATE. Nothing declared here is
 * exported into the app; callers only ever see `billing-provider.ts` types.
 */

import {
  BillingProviderError,
  type BillingInterval,
  type BillingProvider,
  type BillingSubscription,
  type BillingSubscriptionStatus,
  type CancelSubscriptionOptions,
  type CreateSubscriptionCheckoutInput,
  type PlanRef,
  type SubscriptionCheckout,
} from '@/lib/billing-provider';
import type { TenantPlan } from '@/types/tenant.types';

const PROVIDER_ID = 'dodo';

/** Everything the provider needs to talk to one Dodo environment. */
export interface DodoProviderConfig {
  /** `https://test.dodopayments.com` or `https://live.dodopayments.com`. */
  apiBaseUrl: string;
  apiKey: string;
  /** Dodo product id for a plan at a cadence. */
  productId: (plan: TenantPlan, interval: BillingInterval) => string;
  /** Dodo product id → plan, or `null` when it is not one of Harvest's. */
  resolvePlan: (productId: string) => PlanRef | null;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/* ── Dodo wire shapes (private) ───────────────────────────────────────────── */

/** Dodo's own subscription status vocabulary. */
type DodoSubscriptionStatus = 'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired';

interface DodoSubscription {
  subscription_id: string;
  status: DodoSubscriptionStatus;
  product_id: string;
  cancel_at_next_billing_date: boolean;
  next_billing_date: string | null;
  created_at: string;
  trial_period_days: number;
  customer?: { email?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}

interface DodoCheckoutSessionResponse {
  session_id: string;
  checkout_url?: string | null;
}

/**
 * Dodo status → canonical status.
 *
 * `on_hold` is Dodo's dunning state (a charge failed and it is retrying), which
 * is what `past_due` means here. `active` covers a card-up-front trial: Dodo has
 * NO separate trialing status, and the trial is visible only as
 * `trial_period_days` on the subscription.
 *
 * An unknown status is NOT mapped to a neighbour. See `toCanonicalStatus`.
 */
const STATUS_MAP: Record<DodoSubscriptionStatus, BillingSubscriptionStatus> = {
  pending: 'pending',
  active: 'active',
  on_hold: 'past_due',
  cancelled: 'canceled',
  failed: 'failed',
  expired: 'expired',
};

function toCanonicalStatus(raw: string, operation: string): BillingSubscriptionStatus {
  const mapped = STATUS_MAP[raw as DodoSubscriptionStatus];
  if (!mapped) {
    // Deliberately fatal. A status Dodo added and this map has not learned yet
    // would otherwise fall to whichever default looked harmless — and every
    // default here is wrong in one direction: 'active' bills nobody's card while
    // granting access, 'canceled' takes a paying church's account away.
    throw new BillingProviderError(
      PROVIDER_ID,
      operation,
      `Unrecognised subscription status "${raw}" — refusing to guess an entitlement`,
    );
  }
  return mapped;
}

/** Metadata comes back loosely typed; keep only the string values it was sent as. */
function toStringMetadata(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

/**
 * Trial end, computed from the subscription's start and its trial length.
 *
 * Dodo reports the trial as a DURATION, not an end date, so this is arithmetic
 * on values Dodo gave us rather than an inference — and it returns `null` rather
 * than a guess when there is no trial or the start date will not parse.
 */
function trialEndsAt(sub: DodoSubscription): string | null {
  if (!sub.trial_period_days || sub.trial_period_days <= 0) return null;
  const startedMs = Date.parse(sub.created_at);
  if (Number.isNaN(startedMs)) return null;
  return new Date(startedMs + sub.trial_period_days * 24 * 60 * 60 * 1000).toISOString();
}

export function createDodoBillingProvider(config: DodoProviderConfig): BillingProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');

  async function request<T>(
    operation: string,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new BillingProviderError(PROVIDER_ID, operation, 'Request to Dodo failed', { cause });
    }

    const text = await response.text();
    if (!response.ok) {
      throw new BillingProviderError(
        PROVIDER_ID,
        operation,
        `Dodo returned ${response.status}: ${text.slice(0, 500)}`,
        { status: response.status },
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new BillingProviderError(PROVIDER_ID, operation, 'Dodo returned a non-JSON body', {
        status: response.status,
        cause,
      });
    }
  }

  function toBillingSubscription(sub: DodoSubscription, operation: string): BillingSubscription {
    return {
      id: sub.subscription_id,
      status: toCanonicalStatus(sub.status, operation),
      plan: config.resolvePlan(sub.product_id),
      productRef: sub.product_id,
      cancelAtPeriodEnd: sub.cancel_at_next_billing_date === true,
      currentPeriodEnd: sub.next_billing_date ?? null,
      trialPeriodDays: sub.trial_period_days ?? 0,
      trialEndsAt: trialEndsAt(sub),
      customerEmail: sub.customer?.email ?? null,
      metadata: toStringMetadata(sub.metadata),
    };
  }

  return {
    id: PROVIDER_ID,

    async createSubscriptionCheckout(
      input: CreateSubscriptionCheckoutInput,
    ): Promise<SubscriptionCheckout> {
      const operation = 'createSubscriptionCheckout';
      const productId = config.productId(input.plan, input.interval);

      const session = await request<DodoCheckoutSessionResponse>(operation, 'POST', '/checkouts', {
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email: input.customer.email, ...(input.customer.name ? { name: input.customer.name } : {}) },
        return_url: input.returnUrl,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        // Omitted entirely when the caller does not pass one, so the product's
        // own trial applies. `0` is a real value meaning "no trial" and must
        // survive the check below.
        ...(input.trialDays === undefined ? {} : { subscription_data: { trial_period_days: input.trialDays } }),
      });

      if (!session.checkout_url) {
        // Without a URL the buyer cannot pay. Returning a session with nowhere
        // to send them would surface as a dead button, not as an error.
        throw new BillingProviderError(
          PROVIDER_ID,
          operation,
          `Dodo created session ${session.session_id} with no checkout_url`,
        );
      }

      return { url: session.checkout_url, sessionId: session.session_id };
    },

    async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
      const operation = 'getSubscription';
      const sub = await request<DodoSubscription>(
        operation,
        'GET',
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      );
      return toBillingSubscription(sub, operation);
    },

    async cancelSubscription(
      subscriptionId: string,
      options?: CancelSubscriptionOptions,
    ): Promise<BillingSubscription> {
      const operation = 'cancelSubscription';
      const atPeriodEnd = options?.atPeriodEnd ?? true;

      const sub = await request<DodoSubscription>(
        operation,
        'PATCH',
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
        {
          // Ending at the period end is a flag; ending now is a status change.
          ...(atPeriodEnd ? { cancel_at_next_billing_date: true } : { status: 'cancelled' }),
          cancel_reason: 'cancelled_by_merchant',
          ...(options?.comment ? { cancellation_comment: options.comment } : {}),
        },
      );
      return toBillingSubscription(sub, operation);
    },

    resolvePlan(productRef: string): PlanRef | null {
      return config.resolvePlan(productRef);
    },
  };
}
