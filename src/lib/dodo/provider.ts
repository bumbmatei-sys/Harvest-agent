import type { PricedPlan } from '@/types/tenant.types';
import type { BillingTerm } from '@/utils/plan-features';

/**
 * The subscription-billing seam: what Harvest needs from a payment processor,
 * expressed without naming one.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * Dodo Payments is a merchant of record founded in 2024 that holds Harvest's
 * subscription revenue between payouts (1st–15th pays on the 18th, 16th–EOM on
 * the 4th). That is a reasonable trade for pre-incorporation onboarding and 0%
 * rolling reserve, but it is not a relationship to make structurally
 * irreversible. The `stripe-connect.ts` / `billing.ts` split already keeps
 * donations away from this migration; this interface is the other half — it keeps
 * the processor swappable, so a second move is a new implementation of four
 * methods rather than a rewrite of the checkout and webhook paths.
 *
 * ─── Scope: subscriptions ONLY ───────────────────────────────────────────────
 *
 * ⚠️ This is NOT a general payments abstraction, and nothing here may ever grow a
 * donation or ticketing method. Giving runs on Stripe Connect direct charges
 * at a 0% platform fee, it is NOT moving, and it is NOT swappable — the whole
 * point of `stripe-connect.ts` is that it stays put. A second abstraction layer
 * over it would create exactly the coupling this split was made to prevent.
 *
 * ─── Provider-neutral vocabulary ─────────────────────────────────────────────
 *
 * Every type below is Harvest's, not Dodo's. Nothing in this file mentions a
 * product id, an `on_hold` state, a `product_cart`, or any other processor
 * spelling; the Dodo implementation translates at its own boundary. That is what
 * makes the seam real rather than decorative, and `dodo-provider-seam.test.ts`
 * proves it by satisfying this interface with a stub that knows nothing about
 * Dodo.
 */

/**
 * Billing cadence, in the app's own vocabulary. Dodo's catalogue says 'annual'
 * where this says 'yearly'; 'quarterly' is Dodo's
 * `payment_frequency_count: 3, interval: Month`.
 *
 * Aliased to `BillingTerm` (utils/plan-features) rather than restated: the set
 * of cadences a subscription can be sold on IS the set the price table prices,
 * and two hand-kept copies of it is how a term ends up purchasable on one side
 * and unresolvable on the other.
 */
export type BillingPeriod = BillingTerm;

/**
 * Subscription state, in Harvest's vocabulary.
 *
 * These are the states the APP reacts to, deliberately not a copy of any
 * processor's enum. `grace` is the important one: it is REP-4's own word for
 * "the renewal failed and the customer can still recover", and every processor
 * has some spelling of it.
 *
 *   Harvest      Dodo                        Stripe (for illustration)
 *   ──────────   ─────────────────────────   ──────────────────────────────
 *   pending      pending                     incomplete
 *   active       active                      active, trialing
 *   grace        on_hold                     past_due, unpaid
 *   paused       paused                      paused
 *   cancelled    cancelled                   canceled
 *   expired      expired                     canceled at period end, elapsed
 *   failed       failed  (terminal)          incomplete_expired
 *
 * ⚠️ `grace` and `failed` are not interchangeable and the difference is money.
 * `grace` is a RECOVERABLE state for a subscription that was already active and
 * whose renewal failed. `failed` is TERMINAL and only happens when the very first
 * mandate could not be created — there is nothing to recover, and the customer
 * must start again. Treating `failed` as recoverable means dunning someone who
 * never had a working subscription; treating `grace` as terminal means cutting
 * off a paying church over an expired card.
 */
export type BillingSubscriptionStatus =
  | 'pending'
  | 'active'
  | 'grace'
  | 'paused'
  | 'cancelled'
  | 'expired'
  | 'failed';

/** A subscription, as the app understands one. */
export interface BillingSubscription {
  /** The processor's id for this subscription. Opaque to the app. */
  readonly id: string;
  readonly status: BillingSubscriptionStatus;
  /** Null when the subscription is not selling a plan this build knows about. */
  /**
   * Null when the subscription is not selling a plan this build knows about.
   *
   * 🔴 `PricedPlan`, so this can never be `'free'`. A subscription exists
   * because money changes hands; the Forever Free tier has no subscription at
   * all (no product, no card, no trial, no webhook), so "a subscription selling
   * the free plan" is not a state that exists. Typing it on the full union
   * would invite a webhook handler to write `plan: 'free'` from a processor
   * payload, which is the one direction the free tier must never be reachable
   * from — the webhook stays the single writer of `plan`, and a free tenant
   * gets there by provisioning, not by billing.
   */
  readonly plan: PricedPlan | null;
  readonly period: BillingPeriod | null;
  /** True when it will end at the current period's end rather than renewing. */
  readonly cancelAtPeriodEnd: boolean;
  /** End of the current paid period, ISO 8601. The next renewal attempt. */
  readonly currentPeriodEndsAt: string | null;
  /** Trial length in days; 0 when there is no trial. */
  readonly trialDays: number;
  /** The processor's customer id. Opaque to the app. */
  readonly customerId: string | null;
  /** Whatever the app attached at checkout — tenantId, userId, referrerId. */
  readonly metadata: Readonly<Record<string, string>>;
}

/** What the app must supply to start a plan checkout. */
export interface PlanCheckoutRequest {
  /** 🔴 A checkout sells a PRICED tier. Free has no product to cart. */
  readonly plan: PricedPlan;
  readonly period: BillingPeriod;
  /** Where the customer lands after paying. */
  readonly returnUrl: string;
  /** Where the customer lands if they abandon checkout. */
  readonly cancelUrl: string;
  readonly customer: { readonly email: string; readonly name?: string };
  /**
   * Carried through the processor and handed back on every webhook for this
   * subscription. This is how a payment finds its tenant.
   */
  readonly metadata?: Readonly<Record<string, string>>;
  /**
   * Override the trial length configured on the plan. Omit to use the catalogue's
   * own trial, which is the normal case and the one signup uses.
   */
  readonly trialDays?: number;
}

/** A checkout the customer can be redirected to. */
export interface PlanCheckout {
  /** Single-use redirect URL. Never cache or share one of these. */
  readonly url: string;
  /** The processor's id for the checkout attempt, for correlation in logs. */
  readonly reference: string;
}

export interface CancelSubscriptionOptions {
  /**
   * True: keep serving the customer until the period they already paid for runs
   * out, then stop. False: end it now.
   *
   * REP-4's recorded decision is DOWNGRADE, NEVER LOCK OUT, so the app's callers
   * will pass true. The interface accepts both because the choice belongs to the
   * caller, not to whichever processor is plugged in underneath.
   */
  readonly atPeriodEnd: boolean;
}

/** What the app must supply to open a customer's self-service billing portal. */
export interface CustomerPortalRequest {
  /** The processor's customer id. Opaque to the app. */
  readonly customerId: string;
  /** Where the customer lands when they leave the portal. */
  readonly returnUrl: string;
}

/** A self-service billing portal the customer can be redirected to. */
export interface CustomerPortalSession {
  /** Single-use redirect URL. Never cache or share one of these. */
  readonly url: string;
}

/**
 * The five operations Harvest actually performs against a subscription
 * processor. Nothing speculative: every method here has a named caller in the
 * REP-4 plan, and anything a later PR turns out to need gets added then.
 *
 *   createPlanCheckout        → PR 2, ChurchOnboarding's signup redirect
 *   getSubscription           → PR 3, reading state for the lifecycle timer
 *   cancelSubscription        → PR 3, the end of Grace → Archived
 *   resolvePlanFromProductRef → PR 2, the subscription webhook naming a plan
 *   createCustomerPortal      → THE-79, /api/stripe/portal for a Dodo tenant
 */
export interface SubscriptionBillingProvider {
  /** Stable identifier for logs and Sentry context, e.g. 'dodo'. */
  readonly id: string;

  /** Create a checkout for a plan and return somewhere to send the customer. */
  createPlanCheckout(request: PlanCheckoutRequest): Promise<PlanCheckout>;

  /** Read a subscription's current state. */
  getSubscription(subscriptionId: string): Promise<BillingSubscription>;

  /** Cancel a subscription; returns its state after the change. */
  cancelSubscription(
    subscriptionId: string,
    options: CancelSubscriptionOptions,
  ): Promise<BillingSubscription>;

  /**
   * Open the customer's own self-service billing portal.
   *
   * 🔴 THIS IS THE CANCELLATION PATH. Harvest has no "cancel my plan" button of
   * its own: `/api/stripe/portal` — the "Manage subscription" button in Settings,
   * the upgrade page and the plan section — is the ONLY way an admin ends their
   * subscription, and it is also where they update a card and read invoices.
   * A processor plugged in here without a portal would leave churches unable to
   * leave, which is worse than any billing bug this migration is fixing.
   */
  createCustomerPortal(request: CustomerPortalRequest): Promise<CustomerPortalSession>;

  /**
   * Resolve the plan a processor-side product reference sells.
   *
   * `productRef` is deliberately vague: Dodo passes a product id (its price lives
   * on the product), Stripe would pass a price id. The app never constructs one —
   * it forwards whatever arrived on a webhook payload — so the ambiguity stays
   * inside the implementation where it belongs.
   *
   * Returns null for anything the running build does not sell. Callers must treat
   * null as "unknown, do nothing" and never as a default plan.
   */
  resolvePlanFromProductRef(productRef: string): { plan: PricedPlan; period: BillingPeriod } | null;
}
