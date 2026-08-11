/**
 * The subscription-billing SEAM: what Harvest needs from a payment processor to
 * sell a plan, expressed without naming one.
 *
 * WHY THIS EXISTS. Subscription billing is moving from Stripe to Dodo Payments,
 * a merchant of record founded in 2024 that holds Harvest's subscription revenue
 * between its twice-monthly payouts. Concentrating every processor call behind
 * one small interface means a second move — or a fallback during an outage —
 * changes one implementation file and a factory, not the signup flow, the
 * webhook, and the admin billing screens.
 *
 * ⚠️ THIS IS NOT A GENERAL PAYMENTS ABSTRACTION. It covers SUBSCRIPTIONS ONLY.
 * Donations and paid event tickets run through Stripe Connect
 * (`stripe-connect.ts`) as destination charges into each church's OWN account at
 * a 0% platform fee. That relationship is not swappable — it is a per-tenant
 * onboarding into a specific processor — and nothing in this file should ever
 * grow to cover it. The two money paths stay split.
 *
 * WHAT IT DELIBERATELY OMITS. Only the four operations the app actually
 * performs today are here: start a checkout for a plan, read a subscription's
 * state, cancel, and map a processor-side product back to a plan. Trials,
 * proration, add-on line items, dunning, invoices and the customer portal are
 * all things Dodo supports and Harvest does NOT yet call — adding them now would
 * mean designing an abstraction against one processor's shape with no second
 * caller to check it against, which is how a "provider-agnostic" interface ends
 * up being a rename of one vendor's SDK.
 *
 * NO PROCESSOR TYPES CROSS THIS BOUNDARY. Nothing in this file imports from a
 * processor SDK, and no implementation may return a raw processor object through
 * it. Provider-specific identifiers travel as opaque strings.
 */

import type { TenantPlan } from '@/types/tenant.types';

/** Billing cadence, using the same two words the app has always used. */
export type BillingInterval = 'monthly' | 'yearly';

/** A plan at a cadence — the pair that identifies one purchasable thing. */
export interface PlanRef {
  plan: TenantPlan;
  interval: BillingInterval;
}

/**
 * Canonical subscription status.
 *
 * Deliberately NOT either processor's vocabulary: implementations translate into
 * this set, and an unrecognised processor status MUST throw rather than map to a
 * neighbouring value. A status that quietly becomes `active` grants entitlement
 * nobody paid for; one that quietly becomes `canceled` takes a church's account
 * away. Both are the silent-failure class this codebase keeps getting bitten by.
 *
 * `active` covers a card-up-front trial. There is intentionally no `trialing`
 * member: Dodo does not report one (a trialing subscription is `active` with a
 * trial period recorded on it), so a `trialing` status could only ever be
 * inferred from arithmetic on dates. `trialPeriodDays` and `trialEndsAt` carry
 * that information as data instead of hiding a derivation inside a status.
 */
export type BillingSubscriptionStatus =
  /** Created; the first payment has not settled yet. */
  | 'pending'
  /** Entitled and paying — includes an in-progress card-up-front trial. */
  | 'active'
  /** A payment failed and the processor is retrying. Entitlement decisions
   *  during this window belong to the lifecycle rules (REP-4), not here. */
  | 'past_due'
  /** Ended by customer or merchant. */
  | 'canceled'
  /** Never started — the processor could not collect at all. */
  | 'failed'
  /** Ran to its end and was not renewed. */
  | 'expired';

/** A subscription, flattened to the fields Harvest reads. */
export interface BillingSubscription {
  /** Processor-side subscription id. Opaque; never parsed. */
  id: string;
  status: BillingSubscriptionStatus;
  /**
   * The plan this subscription bills for, or `null` when its product is not in
   * Harvest's catalogue (a legacy or hand-made subscription). `null` is a real
   * answer callers must handle — it is NOT a default standing in for "plus".
   */
  plan: PlanRef | null;
  /** Opaque processor-side product/price id backing the subscription. */
  productRef: string;
  /** True when the subscription is set to end at the end of the paid period. */
  cancelAtPeriodEnd: boolean;
  /** ISO 8601 timestamp of the next scheduled charge, if the processor gives one. */
  currentPeriodEnd: string | null;
  /** Trial length in days as recorded by the processor; 0 when there is no trial. */
  trialPeriodDays: number;
  /** ISO 8601 end of the trial, or `null` when there is no trial. */
  trialEndsAt: string | null;
  customerEmail: string | null;
  /** Metadata round-tripped through checkout. Values are strings only. */
  metadata: Record<string, string>;
}

/** Everything needed to send a buyer to a hosted checkout for one plan. */
export interface CreateSubscriptionCheckoutInput {
  plan: TenantPlan;
  interval: BillingInterval;
  customer: { email: string; name?: string };
  /** Where the processor returns the buyer after a completed payment. */
  returnUrl: string;
  /**
   * Trial length in days. Omit to use whatever the catalogue product carries.
   * Passing `0` means "no trial" and is NOT the same as omitting it.
   */
  trialDays?: number;
  /**
   * Carried through to the subscription and echoed on webhook events. This is
   * how provisioning learns which user/tenant a payment belongs to, so callers
   * must treat it as load-bearing, not as a debugging aid.
   */
  metadata?: Record<string, string>;
}

/** A hosted checkout the buyer can be redirected to. */
export interface SubscriptionCheckout {
  /** Absolute URL to redirect the buyer to. */
  url: string;
  /** Processor-side checkout/session id, for reconciliation. Opaque. */
  sessionId: string;
}

export interface CancelSubscriptionOptions {
  /**
   * `true` (the default) ends the subscription when the paid period runs out;
   * `false` ends it immediately. Defaulted deliberately to the non-destructive
   * option: REP-4's recorded decision is downgrade, never lock out.
   */
  atPeriodEnd?: boolean;
  /** Optional free-text reason recorded with the processor. */
  comment?: string;
}

/**
 * The operations Harvest performs against a subscription processor.
 *
 * Implementations must THROW (see `BillingProviderError`) on any failure rather
 * than returning a partial or defaulted value — an unreadable subscription must
 * never be indistinguishable from a cancelled one.
 */
export interface BillingProvider {
  /** Short identifier for logs and errors, e.g. `'dodo'`. */
  readonly id: string;

  /** Start a hosted checkout for one plan at one cadence. */
  createSubscriptionCheckout(input: CreateSubscriptionCheckoutInput): Promise<SubscriptionCheckout>;

  /** Read a subscription's current state. */
  getSubscription(subscriptionId: string): Promise<BillingSubscription>;

  /** Cancel a subscription; returns its state after the change. */
  cancelSubscription(
    subscriptionId: string,
    options?: CancelSubscriptionOptions,
  ): Promise<BillingSubscription>;

  /**
   * Map a processor-side product/price id back to a plan, or `null` when the id
   * is not in Harvest's catalogue.
   *
   * Separate from `getSubscription` on purpose: a webhook payload arrives with a
   * product id already in hand, and re-fetching the whole subscription to learn
   * the plan turns every event into an extra round trip on the money path. This
   * is the replacement for `getPlanFromPriceId` in `billing.ts`.
   */
  resolvePlan(productRef: string): PlanRef | null;
}

/**
 * Thrown by every implementation when a processor call fails or answers with
 * something that cannot be translated. Carries enough to triage without a
 * processor SDK's error type escaping the seam.
 */
export class BillingProviderError extends Error {
  readonly provider: string;
  readonly operation: string;
  /** HTTP status when the failure came from a response, otherwise `undefined`. */
  readonly status?: number;

  constructor(
    provider: string,
    operation: string,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(`[${provider}:${operation}] ${message}`, { cause: options?.cause });
    this.name = 'BillingProviderError';
    this.provider = provider;
    this.operation = operation;
    this.status = options?.status;
  }
}
