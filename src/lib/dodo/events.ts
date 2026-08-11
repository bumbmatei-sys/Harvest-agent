/**
 * The Dodo webhook events Harvest recognises.
 *
 * Every entry is verified against Dodo's published webhook documentation, not
 * inferred from Stripe. The two processors do not have parallel event sets and
 * assuming they do is how a state transition goes unhandled: Dodo has no
 * `checkout.session.completed`, its `subscription.plan_changed` covers add-on
 * changes as well as up/downgrades, and `subscription.failed` means something
 * completely different from a failed payment (see below).
 *
 * ⚠️ RECOGNITION ONLY IN THIS PR. Nothing here acts on an event; the handlers in
 * `webhook-dispatch.ts` are deliberately empty. Tenant provisioning is REP-4
 * PR 2 and lifecycle is PR 3.
 */

/** Subscription lifecycle events. */
export const DODO_SUBSCRIPTION_EVENT_TYPES = [
  /** Active; recurring charges are scheduled. */
  'subscription.active',
  /** Renewed successfully for the next billing period. */
  'subscription.renewed',
  /**
   * 🔴 Temporarily on hold after a FAILED RENEWAL — recoverable.
   *
   * This is Dodo's native grace state and it is the event REP-4's 21-day grace
   * period has to be reconciled with. Dodo runs its own retries and dunning while
   * a subscription sits here. See the `on_hold` finding in the pull request body:
   * two systems both counting down would be a real bug.
   */
  'subscription.on_hold',
  /** Cancelled by the merchant or the customer. */
  'subscription.cancelled',
  /** Reached the end of its term. */
  'subscription.expired',
  /**
   * The MANDATE could not be created — subscription CREATION failed.
   *
   * ⚠️ Terminal, and not the same thing as `subscription.on_hold`. There is no
   * subscription to recover; the customer must start again.
   */
  'subscription.failed',
  /** Paused. */
  'subscription.paused',
  /** Upgrade, downgrade, or an ADD-ON CHANGE. */
  'subscription.plan_changed',
  /** Any field changed. Fires alongside the more specific events above. */
  'subscription.updated',
  /** The customer's payment method was updated. */
  'subscription.update_payment_method',
] as const;

/** Payment events. */
export const DODO_PAYMENT_EVENT_TYPES = [
  'payment.succeeded',
  'payment.failed',
  'payment.processing',
  'payment.cancelled',
] as const;

/** Every event type this build recognises. */
export const DODO_HANDLED_EVENT_TYPES = [
  ...DODO_SUBSCRIPTION_EVENT_TYPES,
  ...DODO_PAYMENT_EVENT_TYPES,
] as const;

export type DodoSubscriptionEventType = (typeof DODO_SUBSCRIPTION_EVENT_TYPES)[number];
export type DodoPaymentEventType = (typeof DODO_PAYMENT_EVENT_TYPES)[number];
export type DodoEventType = (typeof DODO_HANDLED_EVENT_TYPES)[number];

const HANDLED = new Set<string>(DODO_HANDLED_EVENT_TYPES);

/** True when `type` is an event this build routes. */
export function isHandledDodoEventType(type: string): type is DodoEventType {
  return HANDLED.has(type);
}

/**
 * A Dodo webhook envelope.
 *
 * Dodo wraps every event as `{ business_id, type, timestamp, data }`, where
 * `data.payload_type` names the resource ('Subscription', 'Payment', ...). Typed
 * loosely on purpose: this PR routes on `type` and reads nothing out of `data`,
 * and inventing a precise payload type before there is a handler to consume it
 * would be a guess dressed up as a contract.
 */
export interface DodoWebhookEvent {
  readonly business_id?: string;
  readonly type: string;
  readonly timestamp?: string;
  readonly data?: { readonly payload_type?: string; readonly [key: string]: unknown };
}
