import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REP-5b, test 7 — 🔴 THE LIVE CAMPUS GUARD.
 *
 * REP-5a mapped Campus in TEST mode only: both live Campus add-ons exist in
 * Dodo — created, priced, attached — but their ids were never recorded, and
 * guessing one would be worse than the gap. `DODO_LIVE_ADDONS.campus` is
 * therefore `DODO_ADDON_UNMAPPED` on both periods, on purpose.
 *
 * That gap already had one half of its safety property: a live Campus arriving
 * on a webhook is REPORTED rather than dropped, so nobody pays for nothing in
 * silence. This file pins the OTHER half, which is what REP-5b owes it: a live
 * Campus cannot be SOLD in the first place. Charging a church $15 a month for
 * something no code path can grant them is the failure; refusing to offer it is
 * how that failure stops being reachable.
 *
 * 🔴 THE WHOLE FILE RUNS IN LIVE MODE. `catalogue.ts` selects its active table
 * from `dodoConfig.environment` at module load, so this cannot share a file with
 * the test-mode route tests — hence its own `DODO_PAYMENTS_ENVIRONMENT`, hoisted
 * above every import.
 *
 * ⚠️ THIS FILE MUST START PASSING DIFFERENTLY WHEN THE IDS ARE FILLED. It drives
 * availability through the real catalogue rather than restating "campus is
 * missing", so recording the two live ids turns the refusals below into sales
 * with no logic change anywhere — and the assertions that pin the OTHER four
 * add-ons as offerable go on holding throughout.
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
  DODO_ADDON_UNMAPPED,
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

  // Every LIVE add-on that has an id can be named and priced. Campus has no id,
  // so it never reaches this stub — which is the point.
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

// ── Test 7 ───────────────────────────────────────────────────────────────────

describe('an add-on with no mapping in the active environment cannot be offered', () => {
  it('🔴 the live catalogue does not list Campus — the gap, restated as availability', async () => {
    seedDodoTenant();
    asOwner();

    const res = await get();
    expect(res.status).toBe(200);
    const offered: string[] = (await res.json()).addons.map((a: { addon: string }) => a.addon);

    // Named by MEANING, from the real table. Campus is absent because
    // `addonIdFor('campus', …)` is null in live, not because this test says so.
    expect(offered).not.toContain('campus');

    // 🔴 And it is the ONLY thing missing. A guard that hid everything would
    // also pass "campus is absent" — this pins that the other four are still
    // sellable, so the refusal is precise rather than a blanket outage.
    expect(offered.sort()).toEqual(
      DODO_ADDON_MEANINGS.filter((m) => m !== 'campus').slice().sort(),
    );
    expect(offered).toHaveLength(DODO_ADDON_MEANINGS.length - 1);
  });

  it('🔴 buying a live Campus is REFUSED before any charge', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'campus', quantity: 1 }],
      confirm: true,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('addon-not-available');

    // The whole point: Dodo was never asked to charge for something this build
    // could not have granted afterwards.
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses the PREVIEW too, so no price is ever quoted for it', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({ tenantId: T.tenant, addons: [{ addon: 'campus', quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
  });

  it('reports the attempt — an offer surface that produced it has drifted', async () => {
    seedDodoTenant();
    asOwner();

    await post({ tenantId: T.tenant, addons: [{ addon: 'campus', quantity: 1 }] });

    // The catalogue above cannot render Campus, so a request for one means
    // something is out of step. Refusing silently would hide that.
    expect(mockCapture).toHaveBeenCalled();
  });

  it('refuses the whole request when an unmapped add-on rides along with a valid one', async () => {
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

    // 🔴 ALL OR NOTHING. Quietly dropping the campus and selling the seat would
    // leave a church believing it bought two things and paying for one — the
    // silent partial success this codebase refuses everywhere else.
    expect(res.status).toBe(400);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('🔴 the OTHER four live add-ons sell normally — the gap is Campus alone', async () => {
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

  it('availability is DERIVED from the table, so filling the ids is the only change needed', () => {
    // The claim this whole file rests on: nothing anywhere states "campus is
    // unavailable". Availability is a lookup, and the lookup is what is missing.
    expect(addonIdFor('campus', 'monthly')).toBe(DODO_ADDON_UNMAPPED);
    expect(addonIdFor('campus', 'yearly')).toBe(DODO_ADDON_UNMAPPED);

    for (const period of ['monthly', 'yearly'] as const) {
      const offerable = offerableAddonMeanings(period);
      expect(offerable).not.toContain('campus');
      // Every meaning WITH an id is offerable, with no second condition applied
      // — so the day the two ids are recorded, Campus joins this list and the
      // route sells it with no other edit.
      for (const meaning of DODO_ADDON_MEANINGS) {
        expect(offerable.includes(meaning)).toBe(addonIdFor(meaning, period) !== null);
      }
    }
  });
});
