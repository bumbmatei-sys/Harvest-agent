import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SeenEventStore } from '../webhook-dispatch';

// The plan-change/dispatch chain reaches the Dodo catalogue, which consumes the
// validated dodoConfig — so the three required variables must exist before those
// modules load. Hoisted above the imports by vitest.
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

/**
 * REP-5a, the webhook half: the add-on set a tenant OWNS is written by the one
 * writer that already owns `plan`.
 *
 * Driven through the REAL dispatcher (`receiveDodoWebhookEvent`), the REAL
 * add-on catalogue and the REAL `resolveBillingOwnership`, with only Firestore
 * and Sentry mocked — the same in-memory Firestore shape the sibling
 * plan-changed tests use.
 *
 * 🔴 `subscription.plan_changed` IS DODO'S ADD-ON-CHANGE EVENT as well as its
 * up/downgrade event (see `../events`). An add-on bought or dropped arrives
 * here and nowhere else, so a handler that only moved `plan` would take the
 * church's money and change nothing about what they can do.
 *
 * Add-ons are named through the catalogue by MEANING throughout — never by an
 * id pattern, which would match all ten and prove nothing about which one.
 */

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

import { applyDodoPlanChange } from '../plan-change';
import { receiveDodoWebhookEvent } from '../webhook-dispatch';
import { DODO_TEST_ADDONS, productIdFor } from '../catalogue';
import { NO_ADDONS } from '@/utils/plan-features';
import type { DodoWebhookEvent } from '../events';

const T = {
  tenant: 'grace-chapel',
  sub: 'sub_live_1',
  plusMonthly: productIdFor('plus', 'monthly'),
  proMonthly: productIdFor('pro', 'monthly'),
};

/**
 * The add-ons in play, named by MEANING and resolved through the real table.
 *
 * Reading the ids from `DODO_TEST_ADDONS` rather than retyping them is what
 * makes these tests about the mapping instead of about a fixture: transpose two
 * ids in the catalogue and `dodo-addon-catalogue.test.ts` fails, while these
 * keep testing the behaviour they are for.
 */
const ADDON = {
  aiAssistant: DODO_TEST_ADDONS.aiAssistant.monthly as string,
  adminSeat: DODO_TEST_ADDONS.adminSeat.monthly as string,
  campus: DODO_TEST_ADDONS.campus.monthly as string,
  contactPack: DODO_TEST_ADDONS.contactPack.monthly as string,
  unlimitedContacts: DODO_TEST_ADDONS.unlimitedContacts.monthly as string,
  unlimitedContactsAnnual: DODO_TEST_ADDONS.unlimitedContacts.yearly as string,
} as const;

/** Every add-on id this suite can name — the set test 14 proves stays private. */
const EVERY_ADDON_ID = Object.values(ADDON);

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

function planChangedEvent(
  productId: string,
  addons: Array<{ addon_id: string; quantity: number }> | undefined,
  subscriptionId = T.sub,
): DodoWebhookEvent {
  return {
    type: 'subscription.plan_changed',
    data: {
      payload_type: 'Subscription',
      subscription_id: subscriptionId,
      product_id: productId,
      // Present on every real Dodo subscription. `undefined` is used by exactly
      // one test below, deliberately, to prove the refusal to overwrite.
      ...(addons === undefined ? {} : { addons }),
    },
  };
}

/** A Dodo-owned tenant on Individual (plus) monthly, owning nothing extra. */
function seedDodoTenant(over: Record<string, any> = {}) {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel',
    plan: 'plus',
    status: 'active',
    ownerId: 'owner_1',
    addons: { ...NO_ADDONS },
    ...over,
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    dodoCustomerId: 'cus_1',
    dodoProductId: T.plusMonthly,
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
}

const tenantDoc = () => currentDb.store.get(`tenants/${T.tenant}`);

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
});

// ── Test 12 ──────────────────────────────────────────────────────────────────

describe('plan_changed writes the add-on set', () => {
  it('writes what the subscription holds, in meanings', async () => {
    seedDodoTenant();

    const result = await receiveDodoWebhookEvent(
      'whk_addons_1',
      planChangedEvent(T.proMonthly, [
        { addon_id: ADDON.contactPack, quantity: 2 },
        { addon_id: ADDON.adminSeat, quantity: 3 },
        { addon_id: ADDON.campus, quantity: 1 },
      ]),
      { store: memoryStore() },
    );
    expect(result.outcome).toBe('routed');

    expect(tenantDoc()?.addons).toEqual({
      aiAssistant: 0,
      adminSeats: 3,
      contactPacks: 2,
      unlimitedContacts: false,
      campuses: 1,
    });
    // The tier still moved: this is one event and one write.
    expect(tenantDoc()?.plan).toBe('pro');
  });

  it('writes the unlimited flag as a boolean, from either billing period', async () => {
    for (const unlimitedId of [ADDON.unlimitedContacts, ADDON.unlimitedContactsAnnual]) {
      currentDb = makeDb();
      seedDodoTenant();

      await applyDodoPlanChange({
        subscription_id: T.sub,
        product_id: T.proMonthly,
        addons: [{ addon_id: unlimitedId, quantity: 1 }],
      });

      expect(tenantDoc()?.addons.unlimitedContacts).toBe(true);
    }
  });

  it('writes the EMPTY set when the subscription holds nothing', async () => {
    // A downgrade that drops every add-on has to be recorded, or the church
    // keeps capacity it stopped paying for.
    seedDodoTenant({ addons: { ...NO_ADDONS, contactPacks: 4, unlimitedContacts: true } });

    await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      addons: [],
    });

    expect(tenantDoc()?.addons).toEqual(NO_ADDONS);
  });

  it('applies an add-on change even when the TIER did not move', async () => {
    // 🔴 The case a plan-only handler would silently swallow: Dodo fires
    // plan_changed for an add-on purchase, and the product id is unchanged.
    seedDodoTenant();

    const outcome = await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.plusMonthly,
      addons: [{ addon_id: ADDON.contactPack, quantity: 1 }],
    });

    expect(outcome.outcome).toBe('plan-moved');
    expect(tenantDoc()?.plan).toBe('plus');
    expect(tenantDoc()?.addons.contactPacks).toBe(1);
  });

  it('reports an unrecognised id and grants the rest of the set', async () => {
    seedDodoTenant();

    const outcome = await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      addons: [
        { addon_id: ADDON.adminSeat, quantity: 1 },
        { addon_id: 'adn_a_live_campus_id_this_build_lacks', quantity: 1 },
      ],
    });

    expect(outcome).toMatchObject({ outcome: 'plan-moved', unrecognisedAddons: 1 });
    // The seat was granted; the unknown one was NOT, and was reported.
    expect(tenantDoc()?.addons.adminSeats).toBe(1);
    expect(tenantDoc()?.addons.campuses).toBe(0);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        step: 'dodo-plan-changed-unrecognised-addon',
        level: 'error',
        tenantId: T.tenant,
      }),
    );
  });

  it('leaves the stored set ALONE when the payload does not report add-ons', async () => {
    // "None" and "could not read" must never converge: writing the empty set on
    // a payload that said nothing would strip capacity a church pays for.
    const owned = { ...NO_ADDONS, contactPacks: 3, unlimitedContacts: true };
    seedDodoTenant({ addons: owned });

    const outcome = await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      // No `addons` key at all.
    });

    expect(outcome).toMatchObject({ outcome: 'plan-moved', addons: null });
    expect(tenantDoc()?.addons).toEqual(owned);
    // The readable half of the event still applied.
    expect(tenantDoc()?.plan).toBe('pro');
  });

  it('is the same writer that moves the plan — one batch, both fields', async () => {
    seedDodoTenant();

    await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      addons: [{ addon_id: ADDON.campus, quantity: 2 }],
    });

    const doc = tenantDoc();
    expect(doc?.plan).toBe('pro');
    expect(doc?.addons.campuses).toBe(2);
    expect(doc?.updatedAt).toEqual(expect.any(String));
  });

  it('writes nothing at all for a tenant Dodo does not own', async () => {
    currentDb.store.set(`tenants/${T.tenant}`, { plan: 'plus', status: 'active', addons: { ...NO_ADDONS } });
    currentDb.store.set(`tenant_private/${T.tenant}`, {
      dodoSubscriptionId: T.sub,
      stripeSubscriptionId: 'sub_stripe_1',
      stripeCustomerId: 'cus_stripe_1',
      billingProcessor: 'stripe',
    });

    const outcome = await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      addons: [{ addon_id: ADDON.contactPack, quantity: 5 }],
    });

    expect(outcome.outcome).toBe('not-dodo-owned');
    expect(tenantDoc()?.addons).toEqual(NO_ADDONS);
  });

  it('writes no add-on set for a product this build does not sell', async () => {
    // An unknown product is refused BEFORE anything is written — the add-ons on
    // it are not granted on the way past.
    seedDodoTenant();

    const outcome = await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: 'pdt_not_in_this_build',
      addons: [{ addon_id: ADDON.unlimitedContacts, quantity: 1 }],
    });

    expect(outcome.outcome).toBe('unknown-product');
    expect(tenantDoc()?.addons).toEqual(NO_ADDONS);
  });
});

// ── Test 13 ──────────────────────────────────────────────────────────────────

describe('a redelivered plan_changed does not double a count', () => {
  it('is skipped entirely when the webhook-id repeats', async () => {
    seedDodoTenant();
    const store = memoryStore();
    const event = planChangedEvent(T.proMonthly, [{ addon_id: ADDON.contactPack, quantity: 2 }]);

    const first = await receiveDodoWebhookEvent('whk_dup', event, { store });
    expect(first.outcome).toBe('routed');
    expect(tenantDoc()?.addons.contactPacks).toBe(2);

    const second = await receiveDodoWebhookEvent('whk_dup', event, { store });
    expect(second.outcome).toBe('duplicate');
    expect(tenantDoc()?.addons.contactPacks).toBe(2);
  });

  it('applies ONCE under a FRESH webhook-id, which the reservation cannot cover', async () => {
    // A support redo in the dashboard is a new event with a new id. The handler
    // checks its own work: same plan, same product, same add-on set → nothing.
    seedDodoTenant();
    const store = memoryStore();
    const event = planChangedEvent(T.proMonthly, [
      { addon_id: ADDON.contactPack, quantity: 2 },
      { addon_id: ADDON.adminSeat, quantity: 1 },
    ]);

    await receiveDodoWebhookEvent('whk_a', event, { store });
    const after = { ...tenantDoc()! };
    expect(after.addons.contactPacks).toBe(2);

    const again = await receiveDodoWebhookEvent('whk_b', event, { store });
    expect(again.outcome).toBe('routed');

    // Byte for byte — `updatedAt` included, so this cannot pass by rewriting
    // the same numbers on a doc nobody compared.
    expect(tenantDoc()).toEqual(after);
    expect(tenantDoc()?.addons.contactPacks).toBe(2);
    expect(tenantDoc()?.addons.adminSeats).toBe(1);
  });

  it('is a REPLACEMENT, not an increment — ten redeliveries are still two packs', async () => {
    seedDodoTenant();
    const store = memoryStore();

    for (let i = 0; i < 10; i++) {
      await receiveDodoWebhookEvent(
        `whk_${i}`,
        planChangedEvent(T.proMonthly, [{ addon_id: ADDON.contactPack, quantity: 2 }]),
        { store },
      );
    }

    expect(tenantDoc()?.addons.contactPacks).toBe(2);
  });

  it('still applies a REAL later change after a redelivery', async () => {
    // Idempotency must not become inertness: the third pack is a purchase.
    seedDodoTenant();
    const store = memoryStore();

    await receiveDodoWebhookEvent('whk_1', planChangedEvent(T.proMonthly, [
      { addon_id: ADDON.contactPack, quantity: 2 },
    ]), { store });
    await receiveDodoWebhookEvent('whk_2', planChangedEvent(T.proMonthly, [
      { addon_id: ADDON.contactPack, quantity: 2 },
    ]), { store });
    await receiveDodoWebhookEvent('whk_3', planChangedEvent(T.proMonthly, [
      { addon_id: ADDON.contactPack, quantity: 3 },
    ]), { store });

    expect(tenantDoc()?.addons.contactPacks).toBe(3);
  });

  it('does not double the unlimited flag into something other than true', async () => {
    seedDodoTenant();
    const store = memoryStore();
    const event = planChangedEvent(T.proMonthly, [
      { addon_id: ADDON.unlimitedContacts, quantity: 1 },
    ]);

    await receiveDodoWebhookEvent('whk_u1', event, { store });
    await receiveDodoWebhookEvent('whk_u2', event, { store });

    expect(tenantDoc()?.addons.unlimitedContacts).toBe(true);
  });
});

// ── Test 14 — 🔴 NO DODO ID ON THE WORLD-READABLE DOC ────────────────────────

describe('no addon id is written to the tenant doc', () => {
  it('stores meanings, and not one of the ten ids, anywhere on the doc', async () => {
    seedDodoTenant();

    await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      addons: [
        { addon_id: ADDON.aiAssistant, quantity: 1 },
        { addon_id: ADDON.adminSeat, quantity: 2 },
        { addon_id: ADDON.campus, quantity: 1 },
        { addon_id: ADDON.contactPack, quantity: 3 },
        { addon_id: ADDON.unlimitedContacts, quantity: 1 },
      ],
    });

    const serialised = JSON.stringify(tenantDoc());

    // Every id in play, named through the catalogue rather than matched by a
    // prefix — a regex for `adn_` would pass on a doc that leaked a different
    // id entirely, and would fail on a harmless field that happened to match.
    for (const id of EVERY_ADDON_ID) {
      expect(serialised).not.toContain(id);
    }
    // And the meanings really are there, so this cannot pass by writing nothing.
    expect(tenantDoc()?.addons).toEqual({
      aiAssistant: 1,
      adminSeats: 2,
      contactPacks: 3,
      unlimitedContacts: true,
      campuses: 1,
    });
  });

  it('keeps an UNRECOGNISED id off the doc too', async () => {
    // The id this build cannot map is the one most tempting to store "for
    // later". It is reported instead — the tenant doc stays free of ids.
    seedDodoTenant();
    const unknown = 'adn_a_live_campus_id_this_build_lacks';

    await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      addons: [{ addon_id: unknown, quantity: 1 }],
    });

    expect(JSON.stringify(tenantDoc())).not.toContain(unknown);
  });

  it('writes only the five known keys under addons', async () => {
    seedDodoTenant();

    await applyDodoPlanChange({
      subscription_id: T.sub,
      product_id: T.proMonthly,
      addons: [{ addon_id: ADDON.campus, quantity: 1 }],
    });

    expect(Object.keys(tenantDoc()!.addons).sort()).toEqual(
      ['adminSeats', 'aiAssistant', 'campuses', 'contactPacks', 'unlimitedContacts'],
    );
  });
});
