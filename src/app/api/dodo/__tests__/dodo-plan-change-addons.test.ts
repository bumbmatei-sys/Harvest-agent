import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-132 — add-ons across a plan change.
 *
 * 🔴 A DODO ADD-ON IS ATTACHED TO SPECIFIC PRODUCTS. "Contacts +500" is on
 * Small Team and Ministry and NOT on Individual, so a downgrade can land on a
 * plan that does not offer something the church is paying for. The decided rule
 * is that such an add-on is REMOVED and the church is told BEFORE it confirms —
 * which keeps tier availability enforced by Dodo structurally, instead of by a
 * Harvest gate that one bug could open.
 *
 * Driven through the REAL route, the REAL catalogue (`productIdFor`) and the
 * REAL provider functions. Only the Dodo SDK client and Firebase are mocked.
 *
 * ⚠️ Guarded by these tests ONLY. No subscription in either mode currently holds
 * an add-on, so none of this has been observed against a live plan change.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('testsecret').toString('base64');
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

const T = { tenant: 'grace-chapel', sub: 'sub_live_1' };

// ── In-memory Firestore (the parts requireOwner + the route read) ────────────

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
      where(field: string, _op: string, value: any) { filters.push([field, value]); return api; },
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

const { mockVerifyIdToken, mockCapture } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockCapture: vi.fn(),
}));

let currentDb = makeDb();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => currentDb.collection(name),
    batch: () => currentDb.batch(),
  },
  adminAuth: { verifyIdToken: (...args: any[]) => mockVerifyIdToken(...args) },
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: mockCapture,
  captureHandledError: vi.fn(),
}));

import { POST as dodoChangePlan } from '@/app/api/dodo/change-plan/route';
import { productIdFor } from '@/lib/dodo/catalogue';
import { __setDodoClientForTests } from '@/lib/dodo/dodo-provider';

// ── The add-on catalogue these tests reason about ────────────────────────────
//
// Shaped like the live one: three add-ons on every tier, "Contacts +500" only
// from Small Team up, "Unlimited Contacts" on Ministry alone. The ids are
// OPAQUE on purpose — every assertion below names an add-on through this table,
// never through a pattern over its id or its price.

const ADD_ON = {
  aiAssistant: { id: 'adn_7Qp2LmXaVd0Zt4Rk9', name: 'AI Assistant - Monthly' },
  adminSeat: { id: 'adn_3Hb8NcYwRe6Uj1Sm2', name: 'Admin Seat - Monthly' },
  contactsPlus500: { id: 'adn_5Kd4PfZbTg8Wn3Vq6', name: 'Contacts +500 - Monthly' },
  unlimitedContacts: { id: 'adn_9Mg6RhAcUk2Xp7Yr4', name: 'Unlimited Contacts - Monthly' },
} as const;

const INDIVIDUAL = productIdFor('plus', 'monthly');
const SMALL_TEAM = productIdFor('pro', 'monthly');
const MINISTRY = productIdFor('max', 'monthly');

/** Which product offers which add-ons — what `products.retrieve` reports. */
const OFFERED_BY_PRODUCT: Record<string, string[]> = {
  [INDIVIDUAL]: [ADD_ON.aiAssistant.id, ADD_ON.adminSeat.id],
  [SMALL_TEAM]: [ADD_ON.aiAssistant.id, ADD_ON.adminSeat.id, ADD_ON.contactsPlus500.id],
  [MINISTRY]: [
    ADD_ON.aiAssistant.id,
    ADD_ON.adminSeat.id,
    ADD_ON.contactsPlus500.id,
    ADD_ON.unlimitedContacts.id,
  ],
};

// ── The Dodo SDK stub — the one Dodo mock the brief allows ───────────────────

const dodoStub = {
  retrieve: vi.fn(),
  previewChangePlan: vi.fn(),
  changePlan: vi.fn(),
  paymentsList: vi.fn(),
  productsRetrieve: vi.fn(),
  addonsRetrieve: vi.fn(),
};

function installDodoStub() {
  __setDodoClientForTests({
    subscriptions: {
      retrieve: dodoStub.retrieve,
      previewChangePlan: dodoStub.previewChangePlan,
      changePlan: dodoStub.changePlan,
    },
    payments: { list: dodoStub.paymentsList },
    products: { retrieve: dodoStub.productsRetrieve },
    addons: { retrieve: dodoStub.addonsRetrieve },
  } as never);

  dodoStub.productsRetrieve.mockImplementation(async (productId: string) => ({
    product_id: productId,
    addons: OFFERED_BY_PRODUCT[productId] ?? [],
  }));
  dodoStub.addonsRetrieve.mockImplementation(async (addonId: string) => {
    const found = Object.values(ADD_ON).find((addOn) => addOn.id === addonId);
    if (!found) throw new Error(`no such add-on ${addonId}`);
    return { id: found.id, name: found.name, price: 1900, currency: 'USD' };
  });
  dodoStub.previewChangePlan.mockResolvedValue({
    immediate_charge: {
      summary: { total_amount: 0, customer_credits: 1500, currency: 'USD' },
    },
    new_plan: {},
  });
  dodoStub.changePlan.mockResolvedValue(undefined);
}

/**
 * A subscription past its trial, holding `held`.
 *
 * `addons` is always present, as it is on every real Dodo subscription — the
 * one test that omits it does so deliberately, to prove the refusal.
 */
function subscriptionHolding(
  currentProductId: string,
  held: Array<{ addon_id: string; quantity: number }>,
) {
  dodoStub.retrieve.mockResolvedValue({
    subscription_id: T.sub,
    status: 'active',
    product_id: currentProductId,
    trial_period_days: 14,
    created_at: '2025-01-01T00:00:00Z',
    addons: held,
  });
  // Past the trial: the $0 mandate plus a real renewal.
  dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }, { total_amount: 4900 }] });
}

// ── Tenant + auth ────────────────────────────────────────────────────────────

function seedDodoTenant(currentProductId: string, currentPlan: string) {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel', plan: currentPlan, status: 'active', ownerId: 'owner_1',
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    dodoCustomerId: 'cus_dodo_1',
    dodoProductId: currentProductId,
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: currentPlan });
}

function asOwner() {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'owner_1', email: 'pastor@grace.example', tenantId: T.tenant, admin: true, auth_time: 1,
  });
}

function post(body: Record<string, unknown>) {
  return dodoChangePlan(
    new NextRequest('https://theharvest.app/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify(body),
    }) as never,
  );
}

const upgradeToSmallTeam = { tenantId: T.tenant, plan: 'pro', billing: 'monthly' };
const downgradeToIndividual = { tenantId: T.tenant, plan: 'plus', billing: 'monthly' };

/** The `addons` argument of the single call made to a stubbed Dodo method. */
function addonsSentTo(stub: { mock: { calls: any[][] } }): unknown {
  expect(stub.mock.calls).toHaveLength(1);
  return stub.mock.calls[0][1].addons;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
  installDodoStub();
});

// ── Test 1 ───────────────────────────────────────────────────────────────────

describe('a plan change carries the add-ons the target plan offers', () => {
  it('sends both held add-ons through an upgrade that offers both', async () => {
    seedDodoTenant(INDIVIDUAL, 'plus');
    asOwner();
    subscriptionHolding(INDIVIDUAL, [
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
      { addon_id: ADD_ON.adminSeat.id, quantity: 1 },
    ]);

    const res = await post({ ...upgradeToSmallTeam, confirm: true });
    expect(res.status).toBe(200);

    expect(addonsSentTo(dodoStub.changePlan)).toEqual([
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
      { addon_id: ADD_ON.adminSeat.id, quantity: 1 },
    ]);
  });
});

// ── Test 2 ───────────────────────────────────────────────────────────────────

describe('a downgrade drops only the add-ons the target plan does not offer', () => {
  it('keeps AI Assistant and drops Contacts +500 and Unlimited Contacts', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
      { addon_id: ADD_ON.contactsPlus500.id, quantity: 1 },
      { addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 },
    ]);

    const res = await post({ ...downgradeToIndividual, confirm: true });
    expect(res.status).toBe(200);

    // Individual offers AI Assistant, so it survives; the other two do not
    // exist on that product and go.
    expect(addonsSentTo(dodoStub.changePlan)).toEqual([
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
    ]);
  });
});

// ── Test 3 ───────────────────────────────────────────────────────────────────

describe('the preview names every add-on that will be removed', () => {
  it('lists both losses, and the survivor separately, before anything is charged', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
      { addon_id: ADD_ON.contactsPlus500.id, quantity: 1 },
      { addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 },
    ]);

    const res = await post(downgradeToIndividual);
    expect(res.status).toBe(200);
    const { preview } = await res.json();

    expect(preview.addOnsRemoved).toEqual([
      { name: ADD_ON.contactsPlus500.name, quantity: 1 },
      { name: ADD_ON.unlimitedContacts.name, quantity: 1 },
    ]);
    expect(preview.addOnsCarried).toEqual([{ name: ADD_ON.aiAssistant.name, quantity: 1 }]);

    // 🔴 And it is a PREVIEW: the loss is stated before anything happens.
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── Test 4 ───────────────────────────────────────────────────────────────────

describe('the preview names them in words, not by addon id', () => {
  it('puts no add-on id anywhere in the response a church reads', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
      { addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 },
    ]);

    const res = await post(downgradeToIndividual);
    const body = JSON.stringify(await res.json());

    // Every add-on in play, named through the table above rather than matched
    // by a prefix — a regex for `adn_` would pass on a response that leaked a
    // different id entirely.
    for (const addOn of Object.values(ADD_ON)) {
      expect(body).not.toContain(addOn.id);
    }
    expect(body).toContain(ADD_ON.unlimitedContacts.name);
  });
});

// ── Test 5 — 🔴 THE INVARIANT ────────────────────────────────────────────────

describe('the confirm sends exactly the set the preview was computed from', () => {
  it('bills the same add-ons the quoted amount was calculated from', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [
      { addon_id: ADD_ON.aiAssistant.id, quantity: 2 },
      { addon_id: ADD_ON.contactsPlus500.id, quantity: 1 },
      { addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 },
    ]);

    const previewRes = await post(downgradeToIndividual);
    expect(previewRes.status).toBe(200);
    const confirmRes = await post({ ...downgradeToIndividual, confirm: true });
    expect(confirmRes.status).toBe(200);

    const previewed = addonsSentTo(dodoStub.previewChangePlan);
    const charged = addonsSentTo(dodoStub.changePlan);

    // 🔴 Add-ons are inside Dodo's proration calculation. If these two differ,
    // the amount the church agreed to is not the amount it pays.
    expect(charged).toEqual(previewed);
    expect(charged).toEqual([{ addon_id: ADD_ON.aiAssistant.id, quantity: 2 }]);
  });
});

// ── Test 6 ───────────────────────────────────────────────────────────────────

describe('a subscription with no add-ons sends an empty list, not nothing', () => {
  it('sends addons: [] explicitly on the preview and on the confirm', async () => {
    seedDodoTenant(INDIVIDUAL, 'plus');
    asOwner();
    subscriptionHolding(INDIVIDUAL, []);

    await post(upgradeToSmallTeam);
    await post({ ...upgradeToSmallTeam, confirm: true });

    // Dodo documents `[]` as "remove all" and documents omit-vs-empty for
    // discount_codes on this same endpoint — but says nothing about omitting
    // `addons`. Omission is unspecified, so it is never used.
    for (const stub of [dodoStub.previewChangePlan, dodoStub.changePlan]) {
      const body = stub.mock.calls[0][1];
      expect(Object.prototype.hasOwnProperty.call(body, 'addons')).toBe(true);
      expect(body.addons).toEqual([]);
    }
  });
});

// ── Test 7 ───────────────────────────────────────────────────────────────────

describe('a failure to read the current add-ons fails the request instead of sending an empty list', () => {
  it('refuses when the subscription payload does not report its add-ons at all', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    // No `addons` field — a payload this build does not understand. "None" and
    // "unknown" are different facts and must not converge on [].
    dodoStub.retrieve.mockResolvedValue({
      subscription_id: T.sub,
      status: 'active',
      product_id: MINISTRY,
      trial_period_days: 14,
      created_at: '2025-01-01T00:00:00Z',
    });
    dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }, { total_amount: 4900 }] });

    const res = await post({ ...downgradeToIndividual, confirm: true });

    expect(res.status).toBe(503);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
  });

  it('refuses when the target product will not say which add-ons it offers', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [{ addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 }]);
    dodoStub.productsRetrieve.mockRejectedValue(new Error('dodo unreachable'));

    const res = await post({ ...downgradeToIndividual, confirm: true });

    expect(res.status).toBe(503);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses the preview when an add-on cannot be named, rather than showing an id', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [{ addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 }]);
    dodoStub.addonsRetrieve.mockRejectedValue(new Error('dodo unreachable'));

    const res = await post(downgradeToIndividual);

    expect(res.status).toBe(503);
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
  });
});

// ── Test 8 ───────────────────────────────────────────────────────────────────

describe('add-on quantities carry through unchanged', () => {
  it('sends three Admin Seats as three, not as one', async () => {
    seedDodoTenant(INDIVIDUAL, 'plus');
    asOwner();
    subscriptionHolding(INDIVIDUAL, [
      { addon_id: ADD_ON.adminSeat.id, quantity: 3 },
      { addon_id: ADD_ON.aiAssistant.id, quantity: 2 },
    ]);

    await post({ ...upgradeToSmallTeam, confirm: true });

    expect(addonsSentTo(dodoStub.changePlan)).toEqual([
      { addon_id: ADD_ON.adminSeat.id, quantity: 3 },
      { addon_id: ADD_ON.aiAssistant.id, quantity: 2 },
    ]);
  });
});

// ── Test 9 ───────────────────────────────────────────────────────────────────

describe('the base product quantity is still 1', () => {
  it('is unmoved by add-on quantities — a different field entirely', async () => {
    seedDodoTenant(INDIVIDUAL, 'plus');
    asOwner();
    subscriptionHolding(INDIVIDUAL, [{ addon_id: ADD_ON.adminSeat.id, quantity: 5 }]);

    await post(upgradeToSmallTeam);
    await post({ ...upgradeToSmallTeam, confirm: true });

    for (const stub of [dodoStub.previewChangePlan, dodoStub.changePlan]) {
      expect(stub.mock.calls[0][1].quantity).toBe(1);
      expect(stub.mock.calls[0][1].product_id).toBe(SMALL_TEAM);
    }
  });
});

// ── Test 10 ──────────────────────────────────────────────────────────────────

describe('on_payment_failure is still prevent_change on both calls', () => {
  it('stays explicit on a change that carries add-ons', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
      { addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 },
    ]);

    await post(downgradeToIndividual);
    await post({ ...downgradeToIndividual, confirm: true });

    for (const call of [...dodoStub.previewChangePlan.mock.calls, ...dodoStub.changePlan.mock.calls]) {
      expect(call[1].on_payment_failure).toBe('prevent_change');
      expect(call[1].proration_billing_mode).toBe('prorated_immediately');
    }
  });
});

// ── Test 11 ──────────────────────────────────────────────────────────────────

describe('nothing in this path writes the tenant plan', () => {
  it('leaves Firestore byte-for-byte unchanged through a confirm that drops add-ons', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [
      { addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 },
    ]);

    const before = new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]));
    const res = await post({ ...downgradeToIndividual, confirm: true });
    expect(res.status).toBe(200);

    // The `subscription.plan_changed` webhook is the single writer of plan —
    // and nothing here records the add-on removal either.
    expect(new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]))).toEqual(before);
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('max');
  });
});

// ── Test 12 ──────────────────────────────────────────────────────────────────

describe('no invalid addon id is ever sent to Dodo', () => {
  it('sends only ids the target product itself lists, on both calls', async () => {
    seedDodoTenant(MINISTRY, 'max');
    asOwner();
    subscriptionHolding(MINISTRY, [
      { addon_id: ADD_ON.aiAssistant.id, quantity: 1 },
      { addon_id: ADD_ON.adminSeat.id, quantity: 1 },
      { addon_id: ADD_ON.contactsPlus500.id, quantity: 1 },
      { addon_id: ADD_ON.unlimitedContacts.id, quantity: 1 },
    ]);

    await post(downgradeToIndividual);
    await post({ ...downgradeToIndividual, confirm: true });

    const offeredByIndividual = OFFERED_BY_PRODUCT[INDIVIDUAL];
    const sent = [...dodoStub.previewChangePlan.mock.calls, ...dodoStub.changePlan.mock.calls]
      .flatMap((call) => call[1].addons as Array<{ addon_id: string }>)
      .map((addOn) => addOn.addon_id);

    expect(sent.length).toBeGreaterThan(0);
    for (const addonId of sent) {
      expect(offeredByIndividual).toContain(addonId);
    }
    // Named explicitly, so the assertion cannot pass by sending nothing at all:
    // Individual does not carry these two, and neither reaches Dodo.
    expect(sent).not.toContain(ADD_ON.contactsPlus500.id);
    expect(sent).not.toContain(ADD_ON.unlimitedContacts.id);
    expect(sent).toContain(ADD_ON.aiAssistant.id);
  });
});
