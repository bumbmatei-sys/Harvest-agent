import { adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import {
  DODO_HANDLED_EVENT_TYPES,
  isHandledDodoEventType,
  type DodoEventType,
  type DodoWebhookEvent,
} from './events';

/**
 * Idempotent routing for verified Dodo webhook events.
 *
 * ⚠️ SKELETON. Every handler below is empty and every one of them is meant to be.
 * This PR proves that an event arrives once, is recognised, and reaches the right
 * slot; what those slots DO is REP-4 PR 2 (tenant provisioning) and PR 3
 * (lifecycle). Putting a body in one of them here would move the riskiest change
 * in the project into a PR that is supposed to change nothing a user experiences.
 *
 * ─── Idempotency is the load-bearing part ────────────────────────────────────
 *
 * 🔴 Dodo retries any non-2xx response, so EVERY event can arrive more than once,
 * and the `webhook-id` header is the only thing that identifies a redelivery.
 * The tenant-provisioning PR that follows creates a tenant on a subscription
 * event — without this guard, one retry is one duplicate church. The guard is
 * built and tested now, before there is anything for it to protect, precisely so
 * that PR can rely on it rather than invent it under pressure.
 *
 * The reservation uses Firestore `create()`, which fails if the document already
 * exists. That is an atomic compare-and-set: two concurrent redeliveries of the
 * same id race on the write and exactly one wins. A read-then-write would let
 * both pass the check before either wrote.
 */

/** Where reservations live. Separate from the Stripe handler's `webhook_events`. */
export const DODO_WEBHOOK_EVENTS_COLLECTION = 'dodo_webhook_events';

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
};

/** What `receiveDodoWebhookEvent` decided to do with an event. */
export type DodoDispatchOutcome =
  /** A `webhook-id` already seen. Nothing ran. */
  | { readonly outcome: 'duplicate'; readonly type: string; readonly webhookId: string }
  /** Recognised and routed to its handler. */
  | { readonly outcome: 'routed'; readonly type: DodoEventType; readonly webhookId: string }
  /** Not an event this build knows. Logged, not thrown on. */
  | { readonly outcome: 'unrecognised'; readonly type: string; readonly webhookId: string };

export type DodoEventHandler = (event: DodoWebhookEvent) => void | Promise<void>;

/**
 * One empty handler per recognised event type.
 *
 * DERIVED from `DODO_HANDLED_EVENT_TYPES` rather than written out, so the map is
 * exhaustive by construction: an event type cannot be added to the table and left
 * without a route, and a handler cannot exist for an event that is not in the
 * table. `dodo-webhook-dispatch.test.ts` pins that the two agree exactly.
 */
export const DODO_EVENT_HANDLERS: Record<DodoEventType, DodoEventHandler> =
  DODO_HANDLED_EVENT_TYPES.reduce((handlers, type) => {
    // Intentionally empty: see the module note. PR 2 fills the subscription and
    // payment slots; until then, recognising the event and doing nothing is the
    // correct and complete behaviour.
    handlers[type] = () => {};
    return handlers;
  }, {} as Record<DodoEventType, DodoEventHandler>);

export interface ReceiveOptions {
  readonly store?: SeenEventStore;
  readonly handlers?: Record<DodoEventType, DodoEventHandler>;
}

/**
 * Process one verified event, exactly once.
 *
 * Called WITHOUT `await` by the route — Dodo requires a 2xx before processing —
 * so this function must never reject: a rejected promise here would be an
 * unhandled rejection in the serverless runtime, not an error anyone sees. Every
 * failure is captured and returned instead.
 *
 * ⚠️ Because the route has already answered 2xx by the time this runs, Dodo will
 * NOT retry a failure in here. That is acceptable while the handlers are empty
 * and there is nothing to lose. PR 2 must not put provisioning behind this
 * without a durable retry (an outbox row, or a queued job) — a dropped
 * provisioning event is a church that paid and has no account.
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
    // turn a harmless new event into noise, and (once the route stops answering
    // first) into an infinite retry.
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
  }

  return { outcome: 'routed', type, webhookId };
}
