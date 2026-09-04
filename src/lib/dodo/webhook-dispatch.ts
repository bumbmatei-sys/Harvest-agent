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
import { handleDodoSubscriptionPlanChanged } from './plan-change';

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

/**
 * THE-302 — how long a reservation write may take before it is UNREACHABLE.
 *
 * ⚠️ Sized against the FUNCTION, not against Firestore. Sentry
 * `JAVASCRIPT-NEXTJS-B` recorded `4 DEADLINE_EXCEEDED: Deadline exceeded after
 * 627.959s, name resolution: 627.944s, Waiting for LB pick` out of
 * `WriteBatch.commit()` — a `DocumentReference.create()` commits through one, so
 * that stack is this module's `reserve`. 627 seconds is a gRPC name-resolution
 * failure, not slow application code, and it is longer than any Vercel function
 * lifetime: the invocation was killed long before the promise settled, so the
 * `catch` below could not even run. There was no timeout to hit because the
 * client library has no default one.
 *
 * 🔴 The number has to leave room for the RESPONSE inside the same invocation.
 * A bound that expires after the platform has already killed the function
 * changes nothing; the point is to fail fast, answer non-2xx, and let the
 * redelivery happen. Five seconds is ~100x the healthy latency of a single
 * document create and still leaves the smallest default function budget with
 * time to serialise a 500.
 *
 * ⚠️ It bounds the STORE operations only, never a handler. Provisioning is a
 * sequence of dependent writes and cutting it off part-way would leave a
 * half-built tenant, which is worse than the wait; a durable handler that
 * overruns is already answered by the invocation dying, which Dodo reads as a
 * failure and retries. The reservation is the one call where a bound converts a
 * silent loss into a retry.
 */
export const DODO_STORE_TIMEOUT_MS = 5_000;

/**
 * Reject if `op` has not settled within `ms`.
 *
 * ⚠️ Does NOT cancel the underlying gRPC call — nothing can, the Firestore
 * client exposes no cancellation. What it bounds is how long THIS function
 * waits, which is the thing that decides whether a redelivery is asked for
 * inside the invocation's own lifetime.
 */
async function withTimeout<T>(op: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`[dodo] ${what} did not answer within ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  /**
   * THE-302 — the reservation write itself failed or timed out. Nothing ran, and
   * NO claim was recorded, so the caller must answer non-2xx and let Dodo
   * redeliver.
   *
   * 🔴 DISTINCT FROM `duplicate` ON PURPOSE, and the distinction is the whole
   * fix. This case used to be reported AS `duplicate` — "already handled" — so
   * the route answered 200 to an event that had not been handled at all and Dodo
   * never sent it again.
   */
  | { readonly outcome: 'unreserved'; readonly type: string; readonly webhookId: string; readonly error: unknown }
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
 * Six slots are filled: `subscription.active` (provisioning, the reactivation
 * of an archived tenant, and clearing a grace hold), the two TERMINAL lifecycle
 * events `subscription.cancelled` and `subscription.expired`, the two halves
 * of the grace timer below, and `subscription.plan_changed` (THE-89), which
 * moves the tenant's plan after an up/downgrade — the single writer of that
 * field on the Dodo path; see `./plan-change`.
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
DODO_EVENT_HANDLERS['subscription.plan_changed'] = handleDodoSubscriptionPlanChanged;

export interface ReceiveOptions {
  readonly store?: SeenEventStore;
  readonly handlers?: Record<DodoEventType, DodoEventHandler>;
  /**
   * Return as soon as the RESERVATION is settled, leaving the handler running.
   *
   * THE-302. The route passes this for every BEST-EFFORT event, so it still
   * acknowledges before the handler does any work — but it now waits for the one
   * write that decides whether the event was accepted at all, and can answer
   * non-2xx when that write fails. Defaults to false, so every existing caller
   * (and every existing test) keeps the await-the-handler behaviour it was
   * written against.
   */
  readonly deferHandler?: boolean;
  /** Bound on each store call. Defaults to {@link DODO_STORE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * Process one verified event, exactly once.
 *
 * Never rejects. For a BEST-EFFORT event the route has already answered 2xx by
 * the time the HANDLER runs, so a rejected promise would be an unhandled
 * rejection in the serverless runtime rather than an error anyone sees. For a
 * DURABLE event the route is still waiting, and the failure is reported through
 * the return value (`outcome: 'failed'`) so the caller can answer 5xx
 * deliberately.
 *
 * ─── THE-302: a failed RESERVATION is not a duplicate ────────────────────────
 *
 * 🔴 The reservation failure below used to return `outcome: 'duplicate'`, and
 * that one word lost events in production for three weeks. `duplicate` means
 * "already handled, nothing to do", and the route answers 200 to it — correctly,
 * for a real redelivery. When Firestore was unreachable the same 200 went back
 * for an event that had not been handled at all, and because Dodo only retries a
 * non-2xx, the event was never sent again. The reservation write was the FIRST
 * Firestore call in the request, so under a Firestore outage EVERY event type
 * took this path, provisioning included: a church could pay, have its
 * `subscription.active` acknowledged, and end up with no account and no retry.
 *
 * ⚠️ THE SILENT-FAILURE RULE ASKS FOR THIS, it does not forbid it. Its own
 * wording names `catch { console.error }` as one of the shapes that "converts a
 * loud failure into a quiet lie", and it closes: "keep the distinction between
 * 'empty' and 'could not load', and let the write throw rather than resolve into
 * a default nobody will question." `duplicate` was that default. `unreserved` is
 * that distinction.
 *
 * The fail-CLOSED half is unchanged and still right: no handler runs. Nothing
 * was claimed, so the redelivery is a clean first delivery rather than a second
 * run — which is what makes answering non-2xx safe rather than merely loud.
 */
export async function receiveDodoWebhookEvent(
  webhookId: string,
  event: DodoWebhookEvent,
  options: ReceiveOptions = {},
): Promise<DodoDispatchOutcome> {
  const store = options.store ?? firestoreSeenEventStore;
  const handlers = options.handlers ?? DODO_EVENT_HANDLERS;
  const timeoutMs = options.timeoutMs ?? DODO_STORE_TIMEOUT_MS;
  const type = event.type;

  let claimed: boolean;
  try {
    claimed = await withTimeout(store.reserve(webhookId, { type }), timeoutMs, `reserving ${webhookId}`);
  } catch (err) {
    // The reservation itself failed. Fail CLOSED — do not run the handler. A
    // handler that runs without a reservation is a handler that can run twice,
    // and for provisioning that is a duplicate tenant.
    //
    // 🔴 But say WHICH failure this was. See the note above the function.
    console.error(`[dodo] Could not reserve webhook ${webhookId} (${type}); asking Dodo to retry:`, err);
    captureMoneyPathError(err, {
      step: 'dodo-webhook-reserve',
      // Deliberately still `error` and not `warning`, even though the route now
      // makes Dodo redeliver. `warning` is for a retry we have watched work; the
      // 24 events behind THE-302 are the first evidence this path fails at all,
      // and a human should keep seeing them until a redelivery is observed
      // landing.
      level: 'error',
      ids: { webhookId, eventType: type },
    });
    return { outcome: 'unreserved', type, webhookId, error: err };
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

  // The claim is recorded. From here the route may acknowledge: whatever the
  // handler does or fails to do, a redelivery would be discarded as a duplicate,
  // so holding the connection open buys nothing except on the durable path.
  if (options.deferHandler) {
    // `runDodoHandler` is documented never to reject; the `.catch` is the same
    // belt-and-braces guard the route used to carry, kept where the handoff now
    // happens so a future change breaking that promise cannot produce an
    // unhandled rejection in the serverless runtime.
    void runDodoHandler(webhookId, event, handlers, store, timeoutMs).catch((err) => {
      console.error(`[dodo] Deferred handler for ${type} (${webhookId}) rejected:`, err);
    });
    return { outcome: 'routed', type, webhookId };
  }

  return runDodoHandler(webhookId, event, handlers, store, timeoutMs);
}

/**
 * Run one reserved event's handler and classify the result.
 *
 * Split out of {@link receiveDodoWebhookEvent} by THE-302 so the same body
 * serves both the awaited (durable) call and the deferred (best-effort) one.
 * Never rejects, on either.
 */
async function runDodoHandler(
  webhookId: string,
  event: DodoWebhookEvent,
  handlers: Record<DodoEventType, DodoEventHandler>,
  store: SeenEventStore,
  timeoutMs: number,
): Promise<DodoDispatchOutcome> {
  const type = event.type as DodoEventType;
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
        await withTimeout(store.release(webhookId), timeoutMs, `releasing ${webhookId}`);
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
