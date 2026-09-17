import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-370, live mode — 🔴 CAMPUS AND CONTACTS +500 CANNOT BE SOLD, AND THE
 * REMAINING THREE STILL CAN.
 *
 * This file used to pin the opposite. REP-5a mapped Campus in TEST mode only;
 * then its two live ids were recorded and every assertion here flipped from a
 * refusal to a sale ("live Campus is now offerable"). THE-370 retires the
 * product outright: the founder said "remove the campus addon. let them add as
 * many as they want", Dodo has Campus and Contacts +500 DETACHED from all nine
 * plan products, and both meanings are gone from `DODO_ADDON_MEANINGS`.
 *
 * So the subject is unchanged — what LIVE mode will and will not sell — and only
 * the answer moved. Keeping the file is what makes the reversal legible: the
 * same harness, the same route, the same live table, and a purchase that used to
 * succeed now has no meaning to name.
 *
 * 🔴 THE REFUSAL IS STRUCTURAL, NOT A DENY-LIST. Nothing here or in the route
 * says "campus is retired". The meaning left the union, so the request body
 * fails validation before any money path is reached — which is why the guard
 * below asserts the route's own 400 rather than a hand-written check.
 *
 * 🔴 THE WHOLE FILE RUNS IN LIVE MODE. `catalogue.ts` selects its active table
 * from `dodoConfig.environment` at module load, so this cannot share a file with
 * the test-mode route tests — hence its own `DODO_PAYMENTS_ENVIRONMENT`, hoisted
 * above every import.
 */
vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_live_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('livesecret').toString('base64');
  // 🔴 LIVE. The mode whose table THE-370 removed Campus from.
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
  requireProductId,
} from '@/lib/dodo/catalogue';
import { __setDodoClientForTests } from '@/lib/dodo/dodo-provider';

const PLUS_MONTHLY = requireProductId('plus', 'monthly');

/**
 * 🔴 WHAT THE LIVE INDIVIDUAL PRODUCT CARRIES, as Dodo reports it (THE-160).
 *
 * Read from the live `pdt_…` behind `requireProductId('plus', 'monthly')`:
 * AI Assistant and Admin Seat — and NOT Unlimited Contacts, which is attached to
 * the Ministry products only and is the attachment THE-160 exists to respect.
 *
 * 🔴 CAMPUS WAS ON THIS LIST AND IS NOT ANY MORE — THE-370. The founder detached
 * it (and Contacts +500) from all nine plan products, so the live Individual
 * product now carries exactly two add-ons.
 */
const LIVE_PLUS_MEANINGS = ['aiAssistant', 'adminSeat'] as const;

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

  // Plain id STRINGS, as the live API returns them — resolved through the real
  // live table rather than retyped.
  dodoStub.productsRetrieve.mockImplementation(async (productId: string) => ({
    product_id: productId,
    addons: LIVE_PLUS_MEANINGS.map((meaning) => addonIdFor(meaning, 'monthly') as string),
  }));

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

// ── THE-370 — 🔴 THE SALE BECOMES A REFUSAL, AND NO LOGIC CHANGED ───────────

describe('THE-370 — live Campus and Contacts +500 are retired and unsellable', () => {
  it('the live catalogue no longer lists campus or contactPack for this tenant', async () => {
    seedDodoTenant();
    asOwner();

    const res = await get();
    expect(res.status).toBe(200);
    const offered: string[] = (await res.json()).addons.map((a: { addon: string }) => a.addon);

    // 🔴 THE TWO RETIRED MEANINGS ARE ABSENT. `addonIdFor('campus', …)` cannot
    // resolve because `campus` is not a meaning any more.
    expect(offered).not.toContain('campus');
    expect(offered).not.toContain('contactPack');
    expect(offered.sort()).toEqual([...LIVE_PLUS_MEANINGS].sort());

    // ⚠️ AND IT IS STILL NOT ALL THREE (THE-160). This tenant is on the
    // Individual plan, whose products Dodo does not attach Unlimited Contacts
    // to. Asserting every meaning here is what the old defect looked like.
    expect(offered).not.toContain('unlimitedContacts');
    expect(offered.length).toBeLessThan(DODO_ADDON_MEANINGS.length);
  });

  it('🔴 buying a live campus is REFUSED — the meaning no longer exists', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'campus', quantity: 1 }],
      confirm: true,
    });

    // 400, not 200: the body fails validation because `campus` is not in the
    // meaning union, so the request never reaches a money path.
    expect(res.status).toBe(400);
    // 🔴 NOTHING WAS CHARGED AND NOTHING WAS PREVIEWED.
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
  });

  it('🔴 buying a live contactPack is REFUSED for the same reason', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'contactPack', quantity: 2 }],
      confirm: true,
    });

    expect(res.status).toBe(400);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('🔴 a retired meaning POISONS THE WHOLE REQUEST — no partial purchase', async () => {
    seedDodoTenant();
    asOwner();

    // An admin seat is still perfectly sellable. Asking for it alongside a
    // retired meaning must buy NEITHER: a request that half-succeeds would
    // charge for something the church did not agree to in the shape it asked.
    const res = await post({
      tenantId: T.tenant,
      addons: [
        { addon: 'adminSeat', quantity: 1 },
        { addon: 'campus', quantity: 1 },
      ],
      confirm: true,
    });

    expect(res.status).toBe(400);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('🔴 the THREE remaining live add-ons still sell normally', async () => {
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
    // A normal purchase reports nothing.
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('availability is still DERIVED from the table — removing the rows was the only change', () => {
    // The claim this whole file rests on, unchanged in mechanism and reversed in
    // answer: nothing anywhere states "campus is unavailable". Availability is a
    // lookup, and there is no longer anything to look up.
    expect(DODO_ADDON_MEANINGS).not.toContain('campus' as never);
    expect(DODO_ADDON_MEANINGS).not.toContain('contactPack' as never);
    expect(Object.keys(DODO_LIVE_ADDONS).sort()).toEqual(
      ['adminSeat', 'aiAssistant', 'unlimitedContacts'],
    );

    for (const period of ['monthly', 'yearly'] as const) {
      const offerable = offerableAddonMeanings(period);
      // 🔴 EVERY REMAINING MEANING IS MAPPED IN LIVE. No gap survives.
      for (const meaning of DODO_ADDON_MEANINGS) {
        expect(addonIdFor(meaning, period)).not.toBeNull();
        expect(offerable.includes(meaning)).toBe(true);
      }
    }
  });
});
