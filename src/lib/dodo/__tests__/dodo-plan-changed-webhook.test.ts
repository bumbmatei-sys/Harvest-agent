import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SeenEventStore } from '../webhook-dispatch';

/**
 * THE-89, the webhook half: `subscription.plan_changed` moves the tenant's plan.
 *
 * Driven through the REAL dispatcher (`receiveDodoWebhookEvent`) and the REAL
 * `resolveBillingOwnership`, with only Firestore mocked — the same in-memory
 * Firestore shape the lifecycle tests use. What is under test:
 *
 *   • the plan actually moves (tenant doc, private product record, member
 *     copies) — test 7 of the brief;
 *   • a redelivery applies ONCE, both by webhook-id and by content — test 8;
 *   • a subscription the tenant does not own (Stripe-owned, or the conflicted
 *     double-billed fingerprint) is refused — test 9;
 *   • the webhook is the ONLY writer of the plan on the Dodo path — test 10's
 *     webhook half; the route half lives in `dodo-change-plan-route.test.ts`.
 */

const T = {
  tenant: 'grace-chapel',
  sub: 'sub_live_1',
  proMonthly: 'pdt_0NlAMMhi90q5Ovk6QBzcf',
  plusMonthly: 'pdt_0NlAMMZk44L0tL8lcLX6M',
};

// ── An in-memory Firestore, faithful to the parts the handler uses ───────────

function makeDb() {
  const store = new Map<string, Record<string, any>>();
  const key = (coll: string, id: string) => `${coll}/${id}`;

  const docRef = (coll: string, id: string) => ({
    __coll: coll,
    __id: id,
    async get() {
      const data = store.get(key(coll, id));
      return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
    },
    async update(patch: Record<string, any>) {
      const existing = store.get(key(coll, id));
      if (!existing) throw new Error(`update on missing doc ${key(coll, id)}`);
      store.set(key(coll, id), { ...existing, ...patch });
    },
    async set(data: Record<string, any>, options?: { merge?: boolean }) {
      const existing = options?.merge ? store.get(key(coll, id)) : undefined;
      store.set(key(coll, id), { ...(existing || {}), ...data });
    },
  });

  const collection = (coll: string) => {
    const filters: [string, any][] = [];
    const api: any = {
      doc: (id: string) => docRef(coll, id),
      where(field: string, _op: string, value: any) {
        filters.push([field, value]);
        return api;
      },
      limit() { return api; },
      async get() {
        const docs = [...store.entries()]
          .filter(([k]) => k.startsWith(`${coll}/`))
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
          .map(([k, data]) => ({
            id: k.slice(coll.length + 1),
            ref: docRef(coll, k.slice(coll.length + 1)),
            data: () => ({ ...data }),
          }));
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    };
    return api;
  };

  return {
    store,
    collection: vi.fn(collection),
    batch() {
      const writes: Array<() => void> = [];
      return {
        set(ref: any, data: Record<string, any>, options?: { merge?: boolean }) {
          writes.push(() => {
            const existing = options?.merge ? store.get(key(ref.__coll, ref.__id)) : undefined;
            store.set(key(ref.__coll, ref.__id), { ...(existing || {}), ...data });
          });
        },
        update(ref: any, patch: Record<string, any>) {
          writes.push(() => {
            const existing = store.get(key(ref.__coll, ref.__id));
            if (!existing) throw new Error(`update on missing doc ${key(ref.__coll, ref.__id)}`);
            store.set(key(ref.__coll, ref.__id), { ...existing, ...patch });
          });
        },
        async commit() { for (const write of writes) write(); },
      };
    },
  };
}

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

let currentDb = makeDb();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => currentDb.collection(name),
    batch: () => currentDb.batch(),
  },
  adminAuth: { getUser: vi.fn() },
}));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: mockCapture }));

import { applyDodoPlanChange, handleDodoSubscriptionPlanChanged } from '../plan-change';
import { receiveDodoWebhookEvent } from '../webhook-dispatch';
import type { DodoWebhookEvent } from '../events';

/** An in-memory reservation store, so redelivery is exercised for real. */
function memoryStore(): SeenEventStore {
  const seen = new Set<string>();
  return {
    async reserve(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    async release(id) { seen.delete(id); },
  };
}

function planChangedEvent(productId: string, subscriptionId = T.sub): DodoWebhookEvent {
  return {
    type: 'subscription.plan_changed',
    data: { payload_type: 'Subscription', subscription_id: subscriptionId, product_id: productId },
  };
}

/** A Dodo-owned tenant on Individual (plus) monthly, with two members. */
function seedDodoTenant() {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel', plan: 'plus', status: 'active', ownerId: 'owner_1',
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    dodoCustomerId: 'cus_1',
    dodoProductId: T.plusMonthly,
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
  currentDb.store.set('users/member_1', { tenantId: T.tenant, plan: 'plus' });
  currentDb.store.set('users/unrelated', { tenantId: 'other-church', plan: 'max' });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
});

// ── Test 7: plan_changed moves the tenant plan ───────────────────────────────

describe('plan_changed moves the tenant plan', () => {
  it('moves the tenant, its private product record, and every member copy', async () => {
    seedDodoTenant();

    const result = await receiveDodoWebhookEvent('whk_pc_1', planChangedEvent(T.proMonthly), {
      store: memoryStore(),
    });
    expect(result.outcome).toBe('routed');

    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('pro');
    expect(currentDb.store.get(`tenant_private/${T.tenant}`)?.dodoProductId).toBe(T.proMonthly);
    // The per-user copies move with the church — same fanout as the Stripe path.
    expect(currentDb.store.get('users/owner_1')?.plan).toBe('pro');
    expect(currentDb.store.get('users/member_1')?.plan).toBe('pro');
    // Another church's members are untouched.
    expect(currentDb.store.get('users/unrelated')?.plan).toBe('max');
  });

  it('does NOT touch status — a plan change is not a lifecycle event', async () => {
    seedDodoTenant();
    currentDb.store.get(`tenants/${T.tenant}`)!.status = 'archived';

    await applyDodoPlanChange({ subscription_id: T.sub, product_id: T.proMonthly });

    expect(currentDb.store.get(`tenants/${T.tenant}`)?.status).toBe('archived');
  });

  it('never defaults an unknown product to a tier', async () => {
    seedDodoTenant();

    const outcome = await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: 'pdt_not_in_this_build',
    });

    expect(outcome.outcome).toBe('unknown-product');
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('plus');
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'dodo-plan-changed-unknown-product' }),
    );
  });
});

// ── Test 8: plan_changed is idempotent on redelivery ─────────────────────────

describe('plan_changed is idempotent on redelivery', () => {
  it('a redelivered webhook-id is skipped by the dispatcher entirely', async () => {
    seedDodoTenant();
    const store = memoryStore();

    const first = await receiveDodoWebhookEvent('whk_pc_dup', planChangedEvent(T.proMonthly), { store });
    expect(first.outcome).toBe('routed');
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('pro');

    // Simulate drift between deliveries so a second APPLY would be visible.
    currentDb.store.get(`tenants/${T.tenant}`)!.plan = 'canary';

    const second = await receiveDodoWebhookEvent('whk_pc_dup', planChangedEvent(T.proMonthly), { store });
    expect(second.outcome).toBe('duplicate');
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('canary');
  });

  it('the same change under a FRESH webhook-id applies once and only once', async () => {
    // The webhook-id guard does not cover this: a support redo in the dashboard
    // is a new event with a new id. The handler checks its own work instead.
    seedDodoTenant();
    const store = memoryStore();

    await receiveDodoWebhookEvent('whk_pc_a', planChangedEvent(T.proMonthly), { store });
    const before = { ...currentDb.store.get(`tenants/${T.tenant}`)! };

    const again = await handleDodoSubscriptionPlanChanged(planChangedEvent(T.proMonthly));
    expect(again.outcome).toBe('already-applied');
    // Nothing rewritten — updatedAt included.
    expect(currentDb.store.get(`tenants/${T.tenant}`)).toEqual(before);
  });
});

// ── Test 9: plan_changed refuses a subscription this tenant does not own ─────

describe('plan_changed refuses a subscription this tenant does not own', () => {
  it('refuses a Stripe-owned tenant that somehow matches the subscription id', async () => {
    currentDb.store.set(`tenants/${T.tenant}`, { plan: 'plus', status: 'active', ownerId: 'owner_1' });
    currentDb.store.set(`tenant_private/${T.tenant}`, {
      // Carries the Dodo subscription id (so the lookup matches) but the stored
      // processor says Stripe and there are Stripe identifiers: not Dodo's.
      dodoSubscriptionId: T.sub,
      stripeSubscriptionId: 'sub_stripe_1',
      stripeCustomerId: 'cus_stripe_1',
      billingProcessor: 'stripe',
    });

    const outcome = await applyDodoPlanChange({ subscription_id: T.sub, product_id: T.proMonthly });

    expect(outcome.outcome).toBe('not-dodo-owned');
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('plus');
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'dodo-plan-changed-ownership-refused' }),
    );
  });

  it('refuses the conflicted tenant — the double-billed fingerprint', async () => {
    currentDb.store.set(`tenants/${T.tenant}`, { plan: 'plus', status: 'active', ownerId: 'owner_1' });
    currentDb.store.set(`tenant_private/${T.tenant}`, {
      dodoSubscriptionId: T.sub,
      dodoCustomerId: 'cus_1',
      stripeCustomerId: 'cus_stripe_1',
      billingProcessor: 'dodo',
    });

    const outcome = await applyDodoPlanChange({ subscription_id: T.sub, product_id: T.proMonthly });

    expect(outcome.outcome).toBe('not-dodo-owned');
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('plus');
  });

  it('does nothing for a subscription no tenant carries', async () => {
    const outcome = await applyDodoPlanChange({
      subscription_id: 'sub_orphan',
      product_id: T.proMonthly,
    });
    expect(outcome.outcome).toBe('no-tenant');
  });
});
