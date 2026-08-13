import { adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import {
  DODO_HANDLED_EVENT_TYPES,
  isHandledDodoEventType,
  type DodoEventType,
  type DodoWebhookEvent,
} from './events';
import { handleDodoSubscriptionActive } from './provisioning';
import {
  handleDodoSubscriptionCancelled,
  handleDodoSubscriptionExpired,
  handleDodoSubscriptionOnHold,
  handleDodoSubscriptionRenewed,
} from './lifecycle';

/**
 * Idempotent routing for verified Dodo webhook events.
 *
 * ─── Idempotency is the load-bearing part, and THIS is the PR where it bites ──
 *
 * 🔴 Dodo retries any non-2xx response, so EVERY event can arrive more than once,
 * and the `webhook-id` header is the only thing that identifies a redelivery.
 * From this PR on, `subscription.active` CREATES A TENANT — so without this guard
 * one retry is one duplicate church, with duplicate billing, a duplicate
 * subdomain claim, and an owner attached to whichever of the two won the race.
 *
 * The reservation uses Firestore `create()`, which fails if the document already
 * exists. That is an atomic compare-and-set: two concurrent redeliveries of the
 * same id race on the write and exactly one wins. A read-then-write would let
 * both pass the check before either wrote.
 *
 * ─── Durable events: the promise #290 made, kept here ────────────────────────
 *
 * #290's note said, in as many words, that PR 2 must not put provisioning behind
 * a fire-and-forget handoff without a durable retry, because a dropped
 * provisioning event is a church that paid and has no account. That is honoured
 * by splitting the event table in two:
 *
 *   DURABLE      `subscription.active` — the route AWAITS it and answers 5xx on
 *                failure, so Dodo redelivers. The reservation is RELEASED on
 *                failure, or the redelivery would be discarded as a duplicate and
 *                the retry would achieve nothing.
 *   BEST-EFFORT  everything else — unchanged: the route acknowledges 2xx first
 *                and the handler runs after, because nothing is lost if it fails.
 *
 * ⚠️ Releasing a reservation is only safe because provisioning is idempotent by
 * two further guards of its own (`dodoSubscriptionId` already on a tenant, and
 * the user already having a tenant). Without those, a release would re-open
 * exactly the duplicate-tenant window the reservation exists to close.
 */

/** Where reservations live. Separate from the Stripe handler's `webhook_events`. */
export const DODO_WEBHOOK_EVENTS_COLLECTION = 'dodo_webhook_events';

/**
 * Event types whose failure must reach Dodo as a retryable error.
 *
 * Exactly one member, and it should stay small: every entry here is an event the
 * webhook endpoint holds the connection open for. Provisioning earns it because
 * the alternative is a paying customer with no account.
 */
export const DODO_DURABLE_EVENT_TYPES = ['subscription.active'] as const;

const DURABLE = new Set<string>(DODO_DURABLE_EVENT_TYPES);

/** True when the route must await this event and surface failure as a non-2xx. */
export function isDurableDodoEventType(type: string): boolean {
  return DURABLE.has(type);
}

/**
 * Records which `webhook-id`s have been seen.
 *
 * An interface only so tests can substitute an in-memory store; this is NOT a
 * provider abstraction and should not grow into one.
 */
export interface SeenEventStore {
  /**
   * Atomically claim `webhookId`.
   *
   * @returns true when this caller claimed it (first delivery), false when it was
   *   already claimed (a redelivery).
   */
  reserve(webhookId: string, meta: { type: string }): Promise<boolean>;
  /**
   * Give a claim back, so a redelivery of the same id is processed rather than
   * skipped. Called ONLY when a durable handler failed and Dodo is going to be
   * asked to retry.
   */
  release(webhookId: string): Promise<void>;
}

/** Firestore-backed store. The default in production. */
export const firestoreSeenEventStore: SeenEventStore = {
  async reserve(webhookId, meta) {
    try {
      await adminDb.collection(DODO_WEBHOOK_EVENTS_COLLECTION).doc(webhookId).create({
        type: meta.type,
        receivedAt: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      // Firestore raises ALREADY_EXISTS (gRPC code 6) when the document is
      // present. Anything else is a real Firestore failure and must NOT be read
      // as "already processed" — that would silently drop a first delivery.
      if ((err as { code?: number })?.code === 6) return false;
      throw err;
    }
  },

  async release(webhookId) {
    await adminDb.collection(DODO_WEBHOOK_EVENTS_COLLECTION).doc(webhookId).delete();
  },
};

/** What `receiveDodoWebhookEvent` decided to do with an event. */
export type DodoDispatchOutcome =
  /** A `webhook-id` already seen. Nothing ran. */
  | { readonly outcome: 'duplicate'; readonly type: string; readonly webhookId: string }
  /** Recognised and routed to its handler. */
  | { readonly outcome: 'routed'; readonly type: DodoEventType; readonly webhookId: string }
  /** A DURABLE handler threw. The reservation was released; the caller must 5xx. */
  | { readonly outcome: 'failed'; readonly type: DodoEventType; readonly webhookId: string; readonly error: unknown }
  /** Not an event this build knows. Logged, not thrown on. */
  | { readonly outcome: 'unrecognised'; readonly type: string; readonly webhookId: string };

export type DodoEventHandler = (event: DodoWebhookEvent) => void | Promise<void> | Promise<unknown>;

/**
 * One handler per recognised event type.
 *
 * DERIVED from `DODO_HANDLED_EVENT_TYPES` rather than written out, so the map is
 * exhaustive by construction: an event type cannot be added to the table and left
 * without a route, and a handler cannot exist for an event that is not in the
 * table. `dodo-webhook-dispatch.test.ts` pins that the two agree exactly.
 *
 * Five slots are filled: `subscription.active` (provisioning, the reactivation
 * of an archived tenant, and clearing a grace hold), the two TERMINAL lifecycle
 * events `subscription.cancelled` and `subscription.expired`, and the two halves
 * of the grace timer below.
 *
 * ─── The `on_hold` timer, which used to be the empty slot here ───────────────
 *
 * Dodo runs its own retries and dunning while a subscription sits in `on_hold`,
 * and then NEVER CANCELS — at the end of the recovery window the retries simply
 * stop and the subscription sits there forever, so nothing would ever end the
 * state and a church whose card failed would keep full entitlements
 * indefinitely. Harvest owns that timer now:
 *
 *   `subscription.on_hold`   STARTS the clock — one timestamp on the private
 *                            doc, ONCE. A second `on_hold` must not restart it.
 *   `subscription.renewed`   CLEARS it. 🔴 Paired with `subscription.active`
 *                            below, which clears it too. Both, because clearing
 *                            on too few events archives a church that PAID —
 *                            see the recovery note in `./lifecycle`.
 *
 * ⚠️ Neither is DURABLE, so a handler that throws is an unhandled rejection
 * nobody sees rather than a retry. Both are written to report through their
 * return value instead of throwing, which is why neither is added to
 * `DODO_DURABLE_EVENT_TYPES`: holding the webhook connection open is reserved
 * for events whose loss costs a customer their account, and a missed `on_hold`
 * costs at most one grace window's revenue.
 *
 * `paused` and the payment events remain empty for their own reasons.
 */
export const DODO_EVENT_HANDLERS: Record<DodoEventType, DodoEventHandler> =
  DODO_HANDLED_EVENT_TYPES.reduce((handlers, type) => {
    handlers[type] = () => {};
    return handlers;
  }, {} as Record<DodoEventType, DodoEventHandler>);

// The filled slots. Assigned after the map is built so the exhaustiveness above
// still comes from the table rather than from a hand-written literal.
DODO_EVENT_HANDLERS['subscription.active'] = handleDodoSubscriptionActive;
DODO_EVENT_HANDLERS['subscription.cancelled'] = handleDodoSubscriptionCancelled;
DODO_EVENT_HANDLERS['subscription.expired'] = handleDodoSubscriptionExpired;
DODO_EVENT_HANDLERS['subscription.on_hold'] = handleDodoSubscriptionOnHold;
DODO_EVENT_HANDLERS['subscription.renewed'] = handleDodoSubscriptionRenewed;

export interface ReceiveOptions {
  readonly store?: SeenEventStore;
  readonly handlers?: Record<DodoEventType, DodoEventHandler>;
}

/**
 * Process one verified event, exactly once.
 *
 * Never rejects. For a BEST-EFFORT event the route has already answered 2xx by
 * the time this runs, so a rejected promise would be an unhandled rejection in
 * the serverless runtime rather than an error anyone sees. For a DURABLE event
 * the route is still waiting, and the failure is reported through the return
 * value (`outcome: 'failed'`) so the caller can answer 5xx deliberately.
 */
export async function receiveDodoWebhookEvent(
  webhookId: string,
  event: DodoWebhookEvent,
  options: ReceiveOptions = {},
): Promise<DodoDispatchOutcome> {
  const store = options.store ?? firestoreSeenEventStore;
  const handlers = options.handlers ?? DODO_EVENT_HANDLERS;
  const type = event.type;

  let claimed: boolean;
  try {
    claimed = await store.reserve(webhookId, { type });
  } catch (err) {
    // The reservation itself failed. Fail CLOSED — do not run the handler. A
    // handler that runs without a reservation is a handler that can run twice,
    // and for provisioning that is a duplicate tenant.
    console.error(`[dodo] Could not reserve webhook ${webhookId} (${type}); skipping:`, err);
    captureMoneyPathError(err, {
      step: 'dodo-webhook-reserve',
      level: 'error',
      ids: { webhookId, eventType: type },
    });
    return { outcome: 'duplicate', type, webhookId };
  }

  if (!claimed) {
    console.log(`⏭️ [dodo] Skipping duplicate webhook ${webhookId} (${type})`);
    return { outcome: 'duplicate', type, webhookId };
  }

  if (!isHandledDodoEventType(type)) {
    // Unknown event types are normal: Dodo ships new ones, and an endpoint can be
    // subscribed to more than this build knows. Log and move on — throwing would
    // turn a harmless new event into noise and, on the durable path, an infinite
    // retry.
    console.log(`[dodo] Unhandled webhook event type: ${type}`);
    return { outcome: 'unrecognised', type, webhookId };
  }

  try {
    await handlers[type](event);
  } catch (err) {
    console.error(`[dodo] Handler for ${type} (${webhookId}) threw:`, err);
    captureMoneyPathError(err, {
      step: 'dodo-webhook-handler',
      level: 'error',
      ids: { webhookId, eventType: type },
    });

    if (isDurableDodoEventType(type)) {
      // Hand the claim back so Dodo's redelivery is processed rather than
      // discarded as a duplicate, then tell the caller to answer 5xx. If the
      // release ITSELF fails we still report failure: a retry that gets skipped
      // is no worse than no retry at all, and the alternative — reporting
      // success — loses the event outright.
      try {
        await store.release(webhookId);
      } catch (releaseErr) {
        console.error(`[dodo] Could not release reservation ${webhookId} for retry:`, releaseErr);
        captureMoneyPathError(releaseErr, {
          step: 'dodo-webhook-release',
          level: 'error',
          ids: { webhookId, eventType: type },
        });
      }
      return { outcome: 'failed', type, webhookId, error: err };
    }

    return { outcome: 'routed', type, webhookId };
  }

  return { outcome: 'routed', type, webhookId };
}
