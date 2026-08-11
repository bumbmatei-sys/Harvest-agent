import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  DODO_EVENT_HANDLERS,
  receiveDodoWebhookEvent,
  type DodoEventHandler,
  type SeenEventStore,
} from '../webhook-dispatch';
import {
  DODO_HANDLED_EVENT_TYPES,
  DODO_PAYMENT_EVENT_TYPES,
  DODO_SUBSCRIPTION_EVENT_TYPES,
  isHandledDodoEventType,
  type DodoEventType,
  type DodoWebhookEvent,
} from '../events';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: vi.fn() }));

/**
 * Tests 4 and 6 — process each event exactly once, and route every type we know.
 *
 * Test 4 is the most important test in this pull request, and it guards
 * something that does not exist yet. Dodo retries any non-2xx response, so every
 * event can arrive more than once; `webhook-id` is the only thing that identifies
 * a redelivery. REP-4 PR 2 creates a TENANT on a subscription event. Without this
 * guard, one retry is one duplicate church — with duplicate billing, a duplicate
 * subdomain claim, and an owner attached to whichever of the two won the race.
 * The guard is built and proven now so that PR can rely on it.
 */

/** In-memory `SeenEventStore` with the same atomic claim semantics as Firestore. */
function memoryStore(): SeenEventStore & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    seen,
    async reserve(webhookId) {
      if (seen.has(webhookId)) return false;
      seen.add(webhookId);
      return true;
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
  it('reports the event as routed and swallows the error', async () => {
    const store = memoryStore();
    const handlers = { ...DODO_EVENT_HANDLERS };
    handlers['subscription.active'] = () => {
      throw new Error('handler exploded');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    // The route has already answered 2xx by the time this runs, so a rejection
    // here would be an unhandled rejection in the serverless runtime rather than
    // an error anybody sees.
    await expect(
      receiveDodoWebhookEvent('whk_boom', event('subscription.active'), { store, handlers }),
    ).resolves.toMatchObject({ outcome: 'routed' });

    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('the handlers are empty — this PR routes, it does not act', () => {
  it.each(DODO_HANDLED_EVENT_TYPES)('%s has a handler that does nothing', async (type) => {
    // Business logic here would be REP-4 PR 2 or PR 3 arriving early, in a change
    // whose whole premise is that a real user experiences nothing different.
    await expect(Promise.resolve(DODO_EVENT_HANDLERS[type](event(type)))).resolves.toBeUndefined();
  });
});
