import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REP-5b, test 7 — 🔴 THE LIVE CAMPUS GUARD, now the live Campus SALE.
 *
 * REP-5a originally mapped Campus in TEST mode only: both live Campus add-ons
 * existed in Dodo — created, priced, attached — but their ids were never
 * recorded, and guessing one would have been worse than the gap. This file
 * pinned the purchase-side half of that gap's safety property: a live Campus
 * could not be SOLD while its ids were unknown.
 *
 * The two live ids are now recorded in `catalogue.ts`, exactly as this file's
 * own docstring anticipated: "recording the two live ids turns the refusals
 * below into sales with no logic change anywhere." That is exactly what
 * happened — `route.ts` is untouched, and every assertion below flips from a
 * refusal to a success because `addonIdFor`/`offerableAddonMeanings` now
 * resolve Campus like any other live meaning.
 *
 * 🔴 THE WHOLE FILE RUNS IN LIVE MODE. `catalogue.ts` selects its active table
 * from `dodoConfig.environment` at module load, so this cannot share a file with
 * the test-mode route tests — hence its own `DODO_PAYMENTS_ENVIRONMENT`, hoisted
 * above every import.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_live_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('livesecret').toString('base64');
  // 🔴 LIVE. The mode where Campus has no id.
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
});

const T = { tenant: 'grace-chapel', sub: 'sub_live_1' };

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
    async update() { /* unused */ },
    async set() { /* unused */ },
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

  return { store, collection: vi.fn(collection), batch: () => ({ set() {}, update() {}, async commit() {} }) };
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

import { GET as addonCatalogue, POST as addonChange } from '@/app/api/dodo/addons/route';
import {
  DODO_ADDON_MEANINGS,
  DODO_LIVE_ADDONS,
  addonIdFor,
  offerableAddonMeanings,
  productIdFor,
} from '@/lib/dodo/catalogue';
import { __setDodoClientForTests } from '@/lib/dodo/dodo-provider';

const PLUS_MONTHLY = productIdFor('plus', 'monthly');

const dodoStub = {
  retrieve: vi.fn(),
  previewChangePlan: vi.fn(),
  changePlan: vi.fn(),
  paymentsList: vi.fn(),
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
    addons: { retrieve: dodoStub.addonsRetrieve },
  } as never);

  // Every LIVE add-on has an id now, Campus included, so every one of them can
  // be named and priced through this stub.
  dodoStub.addonsRetrieve.mockImplementation(async (addonId: string) => ({
    id: addonId,
    name: `Add-on ${addonId.slice(-4)}`,
    price: 1234,
    currency: 'USD',
  }));
  dodoStub.previewChangePlan.mockResolvedValue({
    immediate_charge: { summary: { total_amount: 0, customer_credits: 0, currency: 'USD' } },
    new_plan: {},
  });
  dodoStub.changePlan.mockResolvedValue(undefined);
  dodoStub.retrieve.mockResolvedValue({
    subscription_id: T.sub,
    status: 'active',
    product_id: PLUS_MONTHLY,
    trial_period_days: 14,
    created_at: '2025-01-01T00:00:00Z',
    addons: [],
  });
  dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }, { total_amount: 4900 }] });
}

function seedDodoTenant() {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel', plan: 'plus', status: 'active', ownerId: 'owner_1',
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    dodoCustomerId: 'cus_dodo_1',
    dodoProductId: PLUS_MONTHLY,
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
}

function asOwner() {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'owner_1', email: 'pastor@grace.example', tenantId: T.tenant, admin: true, auth_time: 1,
  });
}

function post(body: Record<string, unknown>) {
  return addonChange(
    new NextRequest('https://theharvest.app/api/dodo/addons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify(body),
    }) as never,
  );
}

function get() {
  return addonCatalogue(
    new NextRequest(`https://theharvest.app/api/dodo/addons?tenantId=${T.tenant}`, {
      headers: { authorization: 'Bearer test-token' },
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
  installDodoStub();
});

// ── Test 7 — 🔴 THE GAP IS CLOSED: refusals become sales, no logic changed ───

describe('live Campus is now offerable — the ids close the gap with no route change', () => {
  it('the live catalogue now lists Campus alongside the other four', async () => {
    seedDodoTenant();
    asOwner();

    const res = await get();
    expect(res.status).toBe(200);
    const offered: string[] = (await res.json()).addons.map((a: { addon: string }) => a.addon);

    // Named by MEANING, from the real table. Campus is present because
    // `addonIdFor('campus', …)` now resolves in live, not because this test
    // says so.
    expect(offered).toContain('campus');
    expect(offered.sort()).toEqual([...DODO_ADDON_MEANINGS].sort());
    expect(offered).toHaveLength(DODO_ADDON_MEANINGS.length);
  });

  it('🔴 buying a live Campus now SUCCEEDS — the ids close the gap with no logic change', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'campus', quantity: 1 }],
      confirm: true,
    });

    expect(res.status).toBe(200);
    expect(dodoStub.changePlan).toHaveBeenCalledTimes(1);
    // The LIVE campus id, read from the real table rather than retyped.
    expect(dodoStub.changePlan.mock.calls[0][1].addons).toEqual([
      { addon_id: DODO_LIVE_ADDONS.campus.monthly as string, quantity: 1 },
    ]);
  });

  it('quotes a preview for it too, now that it is offerable', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({ tenantId: T.tenant, addons: [{ addon: 'campus', quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(dodoStub.previewChangePlan).toHaveBeenCalledTimes(1);
  });

  it('reports nothing — a normal purchase, not a drifted offer surface', async () => {
    seedDodoTenant();
    asOwner();

    await post({ tenantId: T.tenant, addons: [{ addon: 'campus', quantity: 1 }] });

    // The catalogue can render Campus now, so a request for one is no longer a
    // sign that something drifted.
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('buys a live Campus alongside another add-on in the same request', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({
      tenantId: T.tenant,
      addons: [
        { addon: 'adminSeat', quantity: 1 },
        { addon: 'campus', quantity: 1 },
      ],
      confirm: true,
    });

    expect(res.status).toBe(200);
    expect(dodoStub.changePlan).toHaveBeenCalledTimes(1);
    const addons = dodoStub.changePlan.mock.calls[0][1].addons;
    expect(addons).toEqual(
      expect.arrayContaining([
        { addon_id: DODO_LIVE_ADDONS.adminSeat.monthly as string, quantity: 1 },
        { addon_id: DODO_LIVE_ADDONS.campus.monthly as string, quantity: 1 },
      ]),
    );
    expect(addons).toHaveLength(2);
  });

  it('🔴 the OTHER four live add-ons still sell normally too', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 2 }],
      confirm: true,
    });

    expect(res.status).toBe(200);
    expect(dodoStub.changePlan).toHaveBeenCalledTimes(1);
    // The LIVE admin-seat id, read from the real table rather than retyped.
    expect(dodoStub.changePlan.mock.calls[0][1].addons).toEqual([
      { addon_id: DODO_LIVE_ADDONS.adminSeat.monthly as string, quantity: 2 },
    ]);
  });

  it('availability is DERIVED from the table — filling the ids was the only change needed', () => {
    // The claim this whole file rests on: nothing anywhere states "campus is
    // available". Availability is a lookup, and the lookup now resolves.
    expect(addonIdFor('campus', 'monthly')).toBe(DODO_LIVE_ADDONS.campus.monthly);
    expect(addonIdFor('campus', 'yearly')).toBe(DODO_LIVE_ADDONS.campus.yearly);

    for (const period of ['monthly', 'yearly'] as const) {
      const offerable = offerableAddonMeanings(period);
      expect(offerable).toContain('campus');
      // Every meaning WITH an id is offerable, with no second condition applied.
      for (const meaning of DODO_ADDON_MEANINGS) {
        expect(offerable.includes(meaning)).toBe(addonIdFor(meaning, period) !== null);
      }
    }
  });
});
