import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  DODO_DURABLE_EVENT_TYPES,
  DODO_EVENT_HANDLERS,
  isDurableDodoEventType,
  receiveDodoWebhookEvent,
  type DodoEventHandler,
  type SeenEventStore,
} from '../webhook-dispatch';
import { handleDodoSubscriptionActive } from '../provisioning';
import { handleDodoSubscriptionCancelled, handleDodoSubscriptionExpired } from '../lifecycle';
import {
  DODO_HANDLED_EVENT_TYPES,
  DODO_PAYMENT_EVENT_TYPES,
  DODO_SUBSCRIPTION_EVENT_TYPES,
  isHandledDodoEventType,
  type DodoEventType,
  type DodoWebhookEvent,
} from '../events';

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn() },
  adminAuth: { getUser: vi.fn(), setCustomUserClaims: vi.fn() },
}));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));

/**
 * Routing, idempotency and durability for verified Dodo events.
 *
 * The idempotency guard is the most important thing in REP-4, and as of PR 2 it
 * is no longer guarding something hypothetical. Dodo retries any non-2xx
 * response, so every event can arrive more than once; `webhook-id` is the only
 * thing that identifies a redelivery, and `subscription.active` now CREATES A
 * TENANT. Without the guard, one retry is one duplicate church — with duplicate
 * billing, a duplicate subdomain claim, and an owner attached to whichever of
 * the two won the race.
 *
 * The end-to-end version of that claim ("a retried webhook-id creates no second
 * tenant", asserted against real provisioning rather than a recording stub)
 * lives in `dodo-provisioning.test.ts`.
 */

/** In-memory `SeenEventStore` with the same atomic claim semantics as Firestore. */
function memoryStore(): SeenEventStore & { seen: Set<string>; released: string[] } {
  const seen = new Set<string>();
  const released: string[] = [];
  return {
    seen,
    released,
    async reserve(webhookId) {
      if (seen.has(webhookId)) return false;
      seen.add(webhookId);
      return true;
    },
    async release(webhookId) {
      seen.delete(webhookId);
      released.push(webhookId);
    },
  };
}

/** A handler map that records every call, keyed by event type. */
function recordingHandlers(): {
  handlers: Record<DodoEventType, DodoEventHandler>;
  calls: string[];
} {
  const calls: string[] = [];
  const handlers = DODO_HANDLED_EVENT_TYPES.reduce((acc, type) => {
    acc[type] = () => {
      calls.push(type);
    };
    return acc;
  }, {} as Record<DodoEventType, DodoEventHandler>);
  return { handlers, calls };
}

const event = (type: string): DodoWebhookEvent => ({
  business_id: 'bus_test',
  type,
  timestamp: '2026-08-11T12:00:00Z',
  data: { payload_type: 'Subscription', subscription_id: 'sub_1' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test 4: the idempotency guard ────────────────────────────────────────────

describe('a repeated webhook-id is a no-op', () => {
  it('runs the handler on first delivery and NOT on redelivery', async () => {
    const store = memoryStore();
    const { handlers, calls } = recordingHandlers();

    const first = await receiveDodoWebhookEvent('whk_1', event('subscription.active'), { store, handlers });
    const second = await receiveDodoWebhookEvent('whk_1', event('subscription.active'), { store, handlers });

    expect(first).toMatchObject({ outcome: 'routed', type: 'subscription.active' });
    expect(second).toMatchObject({ outcome: 'duplicate', type: 'subscription.active' });

    // The claim that matters: the work ran exactly once.
    expect(calls).toEqual(['subscription.active']);
  });

  it('no-ops on the third, fourth and fifth redelivery too', async () => {
    const store = memoryStore();
    const { handlers, calls } = recordingHandlers();

    for (let i = 0; i < 5; i++) {
      await receiveDodoWebhookEvent('whk_retry', event('subscription.renewed'), { store, handlers });
    }

    expect(calls).toHaveLength(1);
  });

  it('deduplicates on webhook-id ALONE, even if the body changed', async () => {
    // The id is the identity of the delivery. A retry carrying a body that
    // differs in any way is still the same event, and re-running on it would
    // defeat the guard exactly when it matters most.
    const store = memoryStore();
    const { handlers, calls } = recordingHandlers();

    await receiveDodoWebhookEvent('whk_same', event('subscription.active'), { store, handlers });
    await receiveDodoWebhookEvent('whk_same', event('subscription.cancelled'), { store, handlers });

    expect(calls).toEqual(['subscription.active']);
  });

  it('treats different webhook-ids as different events', async () => {
    const store = memoryStore();
    const { handlers, calls } = recordingHandlers();

    await receiveDodoWebhookEvent('whk_a', event('subscription.active'), { store, handlers });
    await receiveDodoWebhookEvent('whk_b', event('subscription.active'), { store, handlers });

    expect(calls).toEqual(['subscription.active', 'subscription.active']);
  });

  it('claims the id BEFORE running the handler, so a slow handler cannot be double-entered', async () => {
    // Two deliveries of the same id arriving concurrently — the real retry
    // pattern, not a sequential one. A read-then-write guard lets both past the
    // check before either writes; an atomic claim does not.
    const store = memoryStore();
    let running = 0;
    let maxConcurrent = 0;
    const calls: string[] = [];

    const handlers = DODO_HANDLED_EVENT_TYPES.reduce((acc, type) => {
      acc[type] = async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        calls.push(type);
        await new Promise((r) => setTimeout(r, 10));
        running -= 1;
      };
      return acc;
    }, {} as Record<DodoEventType, DodoEventHandler>);

    const results = await Promise.all([
      receiveDodoWebhookEvent('whk_race', event('subscription.active'), { store, handlers }),
      receiveDodoWebhookEvent('whk_race', event('subscription.active'), { store, handlers }),
    ]);

    expect(calls).toHaveLength(1);
    expect(maxConcurrent).toBe(1);
    expect(results.filter((r) => r.outcome === 'routed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(1);
  });

  it('fails CLOSED when the reservation itself errors — no handler runs', async () => {
    // If we cannot tell whether this event was already processed, running the
    // handler is the dangerous choice. Skipping loses at most one event; running
    // duplicates a tenant.
    const { handlers, calls } = recordingHandlers();
    const brokenStore: SeenEventStore = {
      async reserve() {
        throw new Error('firestore unavailable');
      },
      async release() { /* never reached: nothing was claimed */ },
    };

    const result = await receiveDodoWebhookEvent('whk_broken', event('subscription.active'), {
      store: brokenStore,
      handlers,
    });

    expect(result.outcome).toBe('duplicate');
    expect(calls).toEqual([]);
  });
});

// ── Test 6: every event type is recognised and routed ────────────────────────

describe('every event type in the table is recognised and routed', () => {
  it('covers the ten subscription events, by name', () => {
    expect([...DODO_SUBSCRIPTION_EVENT_TYPES]).toEqual([
      'subscription.active',
      'subscription.renewed',
      'subscription.on_hold',
      'subscription.cancelled',
      'subscription.expired',
      'subscription.failed',
      'subscription.paused',
      'subscription.plan_changed',
      'subscription.updated',
      'subscription.update_payment_method',
    ]);
  });

  it('covers the four payment events, by name', () => {
    expect([...DODO_PAYMENT_EVENT_TYPES]).toEqual([
      'payment.succeeded',
      'payment.failed',
      'payment.processing',
      'payment.cancelled',
    ]);
  });

  it('has one handler per recognised type and no orphans', () => {
    expect(Object.keys(DODO_EVENT_HANDLERS).sort()).toEqual([...DODO_HANDLED_EVENT_TYPES].sort());
  });

  it.each(DODO_HANDLED_EVENT_TYPES)('routes %s to its own handler', async (type) => {
    const store = memoryStore();
    const { handlers, calls } = recordingHandlers();

    const result = await receiveDodoWebhookEvent(`whk_${type}`, event(type), { store, handlers });

    expect(result).toMatchObject({ outcome: 'routed', type });
    expect(calls).toEqual([type]);
  });

  it('recognises exactly fourteen event types', () => {
    expect(DODO_HANDLED_EVENT_TYPES).toHaveLength(14);
    expect(new Set(DODO_HANDLED_EVENT_TYPES).size).toBe(14);
  });
});

describe('an unknown event type is logged and accepted, not thrown on', () => {
  it('returns "unrecognised" without throwing', async () => {
    const store = memoryStore();
    const { handlers, calls } = recordingHandlers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Dodo ships new event types, and an endpoint can be subscribed to more than
    // this build knows about. Throwing would turn a harmless new event into an
    // error — and, once the route stops answering first, into an endless retry.
    const result = await receiveDodoWebhookEvent('whk_unknown', event('dispute.opened'), {
      store,
      handlers,
    });

    expect(result).toMatchObject({ outcome: 'unrecognised', type: 'dispute.opened' });
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dispute.opened'));
    log.mockRestore();
  });

  it('classifies known and unknown types correctly', () => {
    expect(isHandledDodoEventType('subscription.on_hold')).toBe(true);
    expect(isHandledDodoEventType('payment.processing')).toBe(true);
    // Stripe's vocabulary is NOT Dodo's. Assuming parity is the mistake this
    // guards: there is no checkout.session.completed on this processor.
    expect(isHandledDodoEventType('checkout.session.completed')).toBe(false);
    expect(isHandledDodoEventType('invoice.payment_failed')).toBe(false);
    expect(isHandledDodoEventType('')).toBe(false);
  });
});

describe('a throwing handler does not take down the dispatcher', () => {
  it('reports a BEST-EFFORT event as routed and swallows the error', async () => {
    const store = memoryStore();
    const handlers = { ...DODO_EVENT_HANDLERS };
    handlers['subscription.renewed'] = () => {
      throw new Error('handler exploded');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    // The route has already answered 2xx by the time a best-effort handler runs,
    // so a rejection here would be an unhandled rejection in the serverless
    // runtime rather than an error anybody sees.
    await expect(
      receiveDodoWebhookEvent('whk_boom', event('subscription.renewed'), { store, handlers }),
    ).resolves.toMatchObject({ outcome: 'routed' });

    // Nothing is given back: there is no retry, and re-running a lifecycle event
    // is not worth re-opening the duplicate window for.
    expect(store.released).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('never rejects, whichever kind of event failed', async () => {
    const store = memoryStore();
    const handlers = { ...DODO_EVENT_HANDLERS };
    handlers['subscription.active'] = () => {
      throw new Error('provisioning exploded');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      receiveDodoWebhookEvent('whk_durable_boom', event('subscription.active'), { store, handlers }),
    ).resolves.toBeDefined();

    err.mockRestore();
  });
});

// ── Durability: the promise #290's module note made to this PR ───────────────

describe('a DURABLE event turns failure into a retry', () => {
  it('names subscription.active, and only subscription.active, as durable', () => {
    // Every entry here is an event the endpoint holds a connection open for, so
    // the list earns its members one at a time. Provisioning earns it because
    // the alternative is a church that paid and has no account.
    expect([...DODO_DURABLE_EVENT_TYPES]).toEqual(['subscription.active']);
    expect(isDurableDodoEventType('subscription.active')).toBe(true);
    expect(isDurableDodoEventType('subscription.renewed')).toBe(false);
    expect(isDurableDodoEventType('payment.succeeded')).toBe(false);
  });

  it('reports `failed` and RELEASES the reservation when provisioning throws', async () => {
    const store = memoryStore();
    const handlers = { ...DODO_EVENT_HANDLERS };
    handlers['subscription.active'] = () => {
      throw new Error('firestore batch failed');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await receiveDodoWebhookEvent('whk_prov_fail', event('subscription.active'), {
      store,
      handlers,
    });

    expect(result).toMatchObject({ outcome: 'failed', type: 'subscription.active' });
    // Without the release, Dodo's redelivery would be discarded as a duplicate
    // and the retry the 5xx bought would achieve exactly nothing.
    expect(store.released).toEqual(['whk_prov_fail']);
    expect(store.seen.has('whk_prov_fail')).toBe(false);
    err.mockRestore();
  });

  it("lets Dodo's redelivery actually re-run the handler after a failure", async () => {
    const store = memoryStore();
    const calls: string[] = [];
    const handlers = { ...DODO_EVENT_HANDLERS };
    let attempt = 0;
    handlers['subscription.active'] = () => {
      attempt += 1;
      calls.push(`attempt-${attempt}`);
      if (attempt === 1) throw new Error('transient firestore failure');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await receiveDodoWebhookEvent('whk_retry_me', event('subscription.active'), { store, handlers });
    const second = await receiveDodoWebhookEvent('whk_retry_me', event('subscription.active'), { store, handlers });

    expect(first.outcome).toBe('failed');
    expect(second.outcome).toBe('routed');
    expect(calls).toEqual(['attempt-1', 'attempt-2']);
    err.mockRestore();
  });

  it('still reports `failed` when the release itself fails', async () => {
    // A retry that gets skipped is no worse than no retry at all; reporting
    // success would lose the event outright.
    const store: SeenEventStore = {
      async reserve() { return true; },
      async release() { throw new Error('delete failed'); },
    };
    const handlers = { ...DODO_EVENT_HANDLERS };
    handlers['subscription.active'] = () => { throw new Error('boom'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await receiveDodoWebhookEvent('whk_release_fail', event('subscription.active'), {
      store,
      handlers,
    });

    expect(result.outcome).toBe('failed');
    err.mockRestore();
  });
});

describe('three handler slots are filled — provisioning and the two terminal events', () => {
  // REP-4 PR 3 filled `subscription.cancelled` and `subscription.expired`. This
  // list is what remains deliberately empty, and it is not a to-do list.
  const FILLED = ['subscription.active', 'subscription.cancelled', 'subscription.expired'];
  const EMPTY = DODO_HANDLED_EVENT_TYPES.filter((t) => !FILLED.includes(t));

  it.each(EMPTY)('%s still has a handler that does nothing', async (type) => {
    // ⚠️ `subscription.on_hold` is the one to look at twice. It stays empty
    // because Dodo runs its own retries and dunning there and then NEVER
    // cancels — the subscription sits in on_hold forever — so what it needs is a
    // TIMER Harvest owns, a reactive mechanism rather than an event handler, and
    // that is the remainder of PR 3. `paused` and the payment events are still
    // decisions nobody has made.
    await expect(Promise.resolve(DODO_EVENT_HANDLERS[type](event(type)))).resolves.toBeUndefined();
  });

  it('routes subscription.active to the provisioner', () => {
    expect(DODO_EVENT_HANDLERS['subscription.active']).toBe(handleDodoSubscriptionActive);
  });

  it('routes the two TERMINAL lifecycle events to the archiver', () => {
    // The gap this closes was "recognised, no handler": a church cancelled, Dodo
    // stopped billing, and Harvest left the tenant active with full entitlements
    // indefinitely. Behaviour is covered in `dodo-subscription-lifecycle.test.ts`;
    // what is pinned here is that the dispatcher actually reaches it.
    expect(DODO_EVENT_HANDLERS['subscription.cancelled']).toBe(handleDodoSubscriptionCancelled);
    expect(DODO_EVENT_HANDLERS['subscription.expired']).toBe(handleDodoSubscriptionExpired);
  });
});
