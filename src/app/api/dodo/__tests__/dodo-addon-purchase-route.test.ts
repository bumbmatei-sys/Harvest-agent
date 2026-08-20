import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REP-5b, the route half: `/api/dodo/addons` — the one way to buy an add-on.
 *
 * Driven through the REAL route, the REAL `requireOwner`, the REAL add-on
 * catalogue (`DODO_TEST_ADDONS` / `resolveAddonMeaning`), the REAL
 * `resolveBillingOwnership` and the REAL provider functions. Only the Dodo SDK
 * client (via the provider's own test seam) and Firebase are mocked, per the
 * brief.
 *
 * 🔴 EVERY TARGET IS NAMED BY ITS LABEL. Add-on ids are read out of the real
 * catalogue table rather than retyped, and never matched by a pattern: a regex
 * over `adn_` matches all ten ids and would pass on the wrong one, and a regex
 * over `500` matches a price, a pack size AND a plan's contact allowance.
 *
 * Test 7 — the live Campus guard — needs the LIVE catalogue and therefore a
 * different `DODO_PAYMENTS_ENVIRONMENT` at module load, so it lives in its own
 * file: `dodo-addon-live-campus.test.ts`.
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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GET as addonCatalogue, POST as addonChange } from '@/app/api/dodo/addons/route';
import {
  DODO_ADDON_MEANINGS,
  DODO_TEST_ADDONS,
  addonIdFor,
  requireProductId,
  type DodoAddonMeaning,
} from '@/lib/dodo/catalogue';
import type { BillingPeriod } from '@/lib/dodo/provider';
import type { TenantPlan } from '@/types/tenant.types';
import { __setDodoClientForTests } from '@/lib/dodo/dodo-provider';

// ── The add-ons in play, named through the REAL catalogue ────────────────────
//
// The ids are read out of the shipped table, never retyped here: a transposed
// id in a fixture is a test that passes while the route sells the wrong thing.

const ADMIN_SEAT_MONTHLY = DODO_TEST_ADDONS.adminSeat.monthly as string;
const ADMIN_SEAT_YEARLY = DODO_TEST_ADDONS.adminSeat.yearly as string;
const CONTACT_PACK_MONTHLY = DODO_TEST_ADDONS.contactPack.monthly as string;
const UNLIMITED_MONTHLY = DODO_TEST_ADDONS.unlimitedContacts.monthly as string;
const CAMPUS_MONTHLY = DODO_TEST_ADDONS.campus.monthly as string;

/** Dodo's own display names, as `addons.retrieve` reports them. */
const ADDON_NAMES: Record<string, string> = {
  [ADMIN_SEAT_MONTHLY]: 'Admin Seat - Monthly',
  [ADMIN_SEAT_YEARLY]: 'Admin Seat - Annual',
  [CONTACT_PACK_MONTHLY]: 'Contacts +500 - Monthly',
  [UNLIMITED_MONTHLY]: 'Unlimited Contacts - Monthly',
  [CAMPUS_MONTHLY]: 'Campus - Monthly',
  [DODO_TEST_ADDONS.aiAssistant.monthly as string]: 'AI Assistant - Monthly',
  [DODO_TEST_ADDONS.aiAssistant.yearly as string]: 'AI Assistant - Annual',
  [DODO_TEST_ADDONS.campus.yearly as string]: 'Campus - Annual',
  [DODO_TEST_ADDONS.contactPack.yearly as string]: 'Contacts +500 - Annual',
  [DODO_TEST_ADDONS.unlimitedContacts.yearly as string]: 'Unlimited Contacts - Annual',
};

const PLUS_MONTHLY = requireProductId('plus', 'monthly');
const PLUS_YEARLY = requireProductId('plus', 'yearly');
const PRO_MONTHLY = requireProductId('pro', 'monthly');
const MAX_MONTHLY = requireProductId('max', 'monthly');

// ── 🔴 THE TIER LADDER, AS DODO HOLDS IT (THE-160) ───────────────────────────
//
// ⚠️ THIS IS A MOCK OF DODO, NOT A TABLE THE APP MAY CONSULT. Availability is
// attachment, and attachment lives on the product in the payment processor
// (THE-133) — so the only way to test what Harvest does with it is to state what
// the processor would answer. That is this fixture, and it belongs here in the
// Dodo stub for the same reason add-on names and prices do.
//
// Mirrors the attachment read from the six LIVE products on 2026-08-16, which is
// what makes tests 1–4 statements about the real ladder rather than invented
// ones: Individual carries AI Assistant, Admin Seat and Campus; Small Team adds
// Contacts +500; Ministry adds Unlimited Contacts. Named by MEANING and resolved
// to ids through the real catalogue, never retyped.
const ATTACHED_MEANINGS: Readonly<Record<TenantPlan, readonly DodoAddonMeaning[]>> = {
  plus: ['aiAssistant', 'adminSeat', 'campus'],
  pro: ['aiAssistant', 'adminSeat', 'campus', 'contactPack'],
  max: ['aiAssistant', 'adminSeat', 'campus', 'contactPack', 'unlimitedContacts'],
};

/** productId → the add-on ids Dodo reports on it, for all six products. */
function attachmentByProduct(): Map<string, string[]> {
  const byProduct = new Map<string, string[]>();
  for (const plan of Object.keys(ATTACHED_MEANINGS) as TenantPlan[]) {
    for (const period of ['monthly', 'yearly'] as BillingPeriod[]) {
      byProduct.set(
        requireProductId(plan, period),
        ATTACHED_MEANINGS[plan].map((meaning) => addonIdFor(meaning, period) as string),
      );
    }
  }
  return byProduct;
}

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

  // Priced by DODO, which is where add-on prices live. The number here is a
  // stub's number and deliberately not any real add-on's price — this file must
  // not become a second place a price is written down.
  dodoStub.addonsRetrieve.mockImplementation(async (addonId: string) => {
    const name = ADDON_NAMES[addonId];
    if (!name) throw new Error(`no such add-on ${addonId}`);
    return { id: addonId, name, price: 1234, currency: 'USD' };
  });
  dodoStub.previewChangePlan.mockResolvedValue({
    immediate_charge: { summary: { total_amount: 0, customer_credits: 0, currency: 'USD' } },
    new_plan: {},
  });
  dodoStub.changePlan.mockResolvedValue(undefined);

  // 🔴 A PRODUCT'S `addons` IS AN ARRAY OF PLAIN ID STRINGS, which is what the
  // live API returns and what PR 307 established. Objects here would make every
  // intersection empty and offer nothing at all, so the shape is part of the
  // fixture rather than an incidental detail of it — test 8 pins the other half.
  const attachment = attachmentByProduct();
  dodoStub.productsRetrieve.mockImplementation(async (productId: string) => {
    const addons = attachment.get(productId);
    if (!addons) throw new Error(`no such product ${productId}`);
    return { product_id: productId, addons: [...addons] };
  });
}

/** Dodo reports `productId` carrying exactly `meanings`, for this one test. */
function productCarries(
  productId: string,
  period: BillingPeriod,
  meanings: readonly DodoAddonMeaning[],
) {
  dodoStub.productsRetrieve.mockImplementation(async (asked: string) => {
    if (asked !== productId) throw new Error(`no such product ${asked}`);
    return {
      product_id: productId,
      addons: meanings.map((meaning) => addonIdFor(meaning, period) as string),
    };
  });
}

/** A subscription past its trial, on `productId`, holding `held`. */
function subscriptionHolding(
  productId: string,
  held: Array<{ addon_id: string; quantity: number }>,
) {
  dodoStub.retrieve.mockResolvedValue({
    subscription_id: T.sub,
    status: 'active',
    product_id: productId,
    trial_period_days: 14,
    created_at: '2025-01-01T00:00:00Z',
    addons: held,
  });
  // Past the trial: the $0 mandate plus a real renewal.
  dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }, { total_amount: 4900 }] });
}

/** The same subscription, but on day 3 of its 14-day trial. */
function subscriptionInTrial(productId: string, held: Array<{ addon_id: string; quantity: number }>) {
  dodoStub.retrieve.mockResolvedValue({
    subscription_id: T.sub,
    status: 'active',
    product_id: productId,
    trial_period_days: 14,
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    addons: held,
  });
  // Exactly one $0 payment — Dodo's own documented in-trial fingerprint.
  dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }] });
}

// ── Tenant + auth ────────────────────────────────────────────────────────────

function seedDodoTenant(productId: string, plan: string, addons?: Record<string, unknown>) {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel',
    plan,
    status: 'active',
    ownerId: 'owner_1',
    ...(addons ? { addons } : {}),
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    dodoCustomerId: 'cus_dodo_1',
    dodoProductId: productId,
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan });
}

function asOwner() {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'owner_1', email: 'pastor@grace.example', tenantId: T.tenant, admin: true, auth_time: 1,
  });
}

function asMember() {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'member_9', email: 'member@grace.example', tenantId: T.tenant, admin: false, auth_time: 1,
  });
  currentDb.store.set('users/member_9', { tenantId: T.tenant, role: 'member', plan: 'plus' });
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

function get(tenantId: string) {
  return addonCatalogue(
    new NextRequest(`https://theharvest.app/api/dodo/addons?tenantId=${tenantId}`, {
      headers: { authorization: 'Bearer test-token' },
    }) as never,
  );
}

/** The `addons` argument of the single call made to a stubbed Dodo method. */
function addonsSentTo(stub: { mock: { calls: any[][] } }): unknown {
  expect(stub.mock.calls).toHaveLength(1);
  return stub.mock.calls[0][1].addons;
}

const buyOneSeat = {
  tenantId: T.tenant,
  addons: [{ addon: 'adminSeat', quantity: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
  installDodoStub();
});

// ── Test 4 ───────────────────────────────────────────────────────────────────

describe('an add-on purchase previews the real charge before confirming', () => {
  it('quotes what Dodo would take now, and charges nothing to do it', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);
    dodoStub.previewChangePlan.mockResolvedValue({
      immediate_charge: { summary: { total_amount: 640, customer_credits: 0, currency: 'USD' } },
      new_plan: {},
    });

    const res = await post(buyOneSeat);
    expect(res.status).toBe(200);
    const { preview } = await res.json();

    // 🔴 The number is DODO'S, for this exact change — a prorated part-month, not
    // the add-on's sticker price. The route reports what it was told.
    expect(preview.amountDueNow).toBe(640);
    expect(preview.currency).toBe('USD');

    // Named in words, never by id — an `adn_` string is not something a church
    // can weigh a decision against.
    expect(preview.addOnsAfter).toEqual([
      { name: ADDON_NAMES[ADMIN_SEAT_MONTHLY], quantity: 1 },
    ]);

    // 🔴 And it is a PREVIEW: nothing was charged and nothing was changed.
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('puts no add-on id in the response a church reads', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: UNLIMITED_MONTHLY, quantity: 1 }]);

    const body = JSON.stringify(await (await post(buyOneSeat)).json());

    // Every id in play, named through the real catalogue rather than matched by
    // a prefix — a regex for `adn_` would pass on a response that leaked a
    // different id entirely.
    for (const id of Object.keys(ADDON_NAMES)) {
      expect(body, `response leaked ${id}`).not.toContain(id);
    }
    expect(body).toContain(ADDON_NAMES[ADMIN_SEAT_MONTHLY]);
  });
});

// ── Test 5 — 🔴 THE INVARIANT ────────────────────────────────────────────────

describe('the preview and the confirm send an identical add-on list', () => {
  it('bills exactly the set the quoted amount was calculated from', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    // Holds two things already; the request touches only one of them.
    subscriptionHolding(PLUS_MONTHLY, [
      { addon_id: CONTACT_PACK_MONTHLY, quantity: 2 },
      { addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 },
    ]);

    const previewRes = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 3 }],
    });
    expect(previewRes.status).toBe(200);
    const confirmRes = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 3 }],
      confirm: true,
    });
    expect(confirmRes.status).toBe(200);

    const previewed = addonsSentTo(dodoStub.previewChangePlan);
    const charged = addonsSentTo(dodoStub.changePlan);

    // 🔴 Add-ons are inside Dodo's proration calculation. If these two differ,
    // the amount the church agreed to is not the amount it pays.
    expect(charged).toEqual(previewed);
    // The untouched add-on carried through at its own quantity; the requested
    // one moved to exactly what was asked for.
    expect(charged).toEqual([
      { addon_id: CONTACT_PACK_MONTHLY, quantity: 2 },
      { addon_id: ADMIN_SEAT_MONTHLY, quantity: 3 },
    ]);
  });

  it('carries through a held add-on this build cannot even name', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    // 🔴 An id the active table does not map — a live-Campus-shaped hole, or an
    // add-on attached by hand in the Dodo dashboard. The client cannot name it,
    // so a client-supplied complete set would silently DELETE it and stop
    // billing for something the church holds. The fold preserves it.
    const UNMAPPABLE = 'adn_attached_in_the_dashboard_by_hand';
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: UNMAPPABLE, quantity: 1 }]);

    const res = await post({ ...buyOneSeat, confirm: true });
    expect(res.status).toBe(200);

    expect(addonsSentTo(dodoStub.changePlan)).toEqual([
      { addon_id: UNMAPPABLE, quantity: 1 },
      { addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 },
    ]);
  });
});

// ── Test 6 ───────────────────────────────────────────────────────────────────

describe("buying an add-on sends the tenant's current period, never a different one", () => {
  it('uses the annual product and the annual add-on id for an annual tenant', async () => {
    seedDodoTenant(PLUS_YEARLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_YEARLY, []);

    await post(buyOneSeat);
    await post({ ...buyOneSeat, confirm: true });

    for (const stub of [dodoStub.previewChangePlan, dodoStub.changePlan]) {
      // 🔴 The SAME product the tenant is already on. Monthly and annual are
      // DIFFERENT Dodo products, so sending the other one would switch the
      // church's billing period as a side effect of buying a seat.
      expect(stub.mock.calls[0][1].product_id).toBe(PLUS_YEARLY);
      expect(stub.mock.calls[0][1].addons).toEqual([
        { addon_id: ADMIN_SEAT_YEARLY, quantity: 1 },
      ]);
    }
  });

  it('ignores a period supplied in the request body — the period is read from the tenant', async () => {
    seedDodoTenant(PLUS_YEARLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_YEARLY, []);

    // A client (or a crafted request) asking for the other period. The route has
    // no period input at all, so this cannot move it.
    await post({ ...buyOneSeat, billing: 'monthly', plan: 'max', confirm: true });

    const sent = dodoStub.changePlan.mock.calls[0][1];
    expect(sent.product_id).toBe(PLUS_YEARLY);
    expect(sent.product_id).not.toBe(PLUS_MONTHLY);
    expect(sent.addons).toEqual([{ addon_id: ADMIN_SEAT_YEARLY, quantity: 1 }]);
    expect(sent.addons).not.toContainEqual({ addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 });
  });

  it('never forms the cross-period request `change-plan` would refuse with a 400', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    await post({ ...buyOneSeat, confirm: true });

    // The monthly tenant's call names the monthly product. The cross-period
    // refusal in `change-plan` exists because that route TAKES a period; this
    // one derives it, so the refusal has nothing to fire on.
    expect(dodoStub.changePlan.mock.calls[0][1].product_id).toBe(PLUS_MONTHLY);
  });
});

// ── Test 8 ───────────────────────────────────────────────────────────────────

describe('removing an add-on previews and confirms like a purchase', () => {
  it('quotes the credit first, then drops it on confirm', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 }]);
    dodoStub.previewChangePlan.mockResolvedValue({
      immediate_charge: { summary: { total_amount: 0, customer_credits: 500, currency: 'USD' } },
      new_plan: {},
    });

    const dropIt = { tenantId: T.tenant, addons: [{ addon: 'adminSeat', quantity: 0 }] };

    const previewRes = await post(dropIt);
    expect(previewRes.status).toBe(200);
    const { preview } = await previewRes.json();

    // The loss is stated in words BEFORE the confirm, the same as a downgrade's
    // add-on loss is (THE-132) — and the credit movement is shown too.
    expect(preview.addOnsRemoved).toEqual([
      { name: ADDON_NAMES[ADMIN_SEAT_MONTHLY], quantity: 1 },
    ]);
    expect(preview.creditMovement).toBe(500);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();

    const confirmRes = await post({ ...dropIt, confirm: true });
    expect(confirmRes.status).toBe(200);

    // 🔴 Removal goes through the SAME two-phase exchange and the SAME single
    // computation: an empty list, sent explicitly.
    expect(addonsSentTo(dodoStub.changePlan)).toEqual([]);
    expect(addonsSentTo(dodoStub.previewChangePlan)).toEqual([]);
  });

  it('sends addons explicitly rather than omitting the field', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 }]);

    await post({ tenantId: T.tenant, addons: [{ addon: 'adminSeat', quantity: 0 }], confirm: true });

    // Dodo documents `[]` as "remove all" and documents omit-vs-empty for
    // discount_codes on this same endpoint — but says nothing about omitting
    // `addons`. Omission is unspecified, so it is never used.
    const body = dodoStub.changePlan.mock.calls[0][1];
    expect(Object.prototype.hasOwnProperty.call(body, 'addons')).toBe(true);
  });
});

// ── Test 9 ───────────────────────────────────────────────────────────────────

describe('on_payment_failure is still prevent_change', () => {
  it('is explicit on the preview AND on the real call for an add-on purchase', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    await post(buyOneSeat);
    await post({ ...buyOneSeat, confirm: true });

    const calls = [...dodoStub.previewChangePlan.mock.calls, ...dodoStub.changePlan.mock.calls];
    expect(calls.length).toBe(2);
    for (const call of calls) {
      // 🔴 The dashboard default is `apply_change`, which grants the add-on even
      // when the payment for it fails. A dashboard setting can be edited without
      // a review; an explicit parameter cannot.
      expect(call[1].on_payment_failure).toBe('prevent_change');
      expect(call[1].proration_billing_mode).toBe('prorated_immediately');
      // The base product's count, never an add-on's.
      expect(call[1].quantity).toBe(1);
    }
  });
});

// ── Test 10 — 🔴 THE TRIAL DECISION: REFUSE, AND SAY WHEN THEY CAN RETURN ────

describe('an add-on purchase during trial behaves as decided, and says so', () => {
  /**
   * 🔴 THE DECISION IS: REFUSED.
   *
   * Not inherited from `change-plan` but reached again for add-ons, because the
   * tempting answer is to allow it. `prorated_immediately` ENDS a trial, so
   * confirming a $10 admin seat on day 3 of 14 charges the FULL plan price
   * immediately — the $49–$199 tier, not the $10 the button said — and forfeits
   * the eleven remaining days. Harvest issues no refunds, so that is
   * unrecoverable; the refusal is entirely recoverable, since the same purchase
   * is one click away the day the trial ends at the price advertised.
   */
  it('refuses on the preview AND the confirm, charging nothing either way', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionInTrial(PLUS_MONTHLY, []);

    const previewRes = await post(buyOneSeat);
    expect(previewRes.status).toBe(409);
    expect((await previewRes.json()).code).toBe('addon-change-unavailable-during-trial');

    const confirmRes = await post({ ...buyOneSeat, confirm: true });
    expect(confirmRes.status).toBe(409);
    expect((await confirmRes.json()).code).toBe('addon-change-unavailable-during-trial');

    // 🔴 Nothing was quoted and nothing was charged. A preview that priced a
    // change which cannot happen would be its own small lie.
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('says the trial would end early and that the whole plan would be charged, not just the add-on', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionInTrial(PLUS_MONTHLY, []);

    const data = await (await post(buyOneSeat)).json();

    // The reason, in the church's terms — the cost being avoided is not the
    // add-on's price, and saying so is the whole point of refusing.
    expect(data.error).toMatch(/end the trial early/i);
    expect(data.error).toMatch(/whole plan/i);
    expect(data.error).toMatch(/not just the add-on/i);
  });

  it('🔴 names the DAY they can come back, computed from the subscription', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionInTrial(PLUS_MONTHLY, []);

    const data = await (await post(buyOneSeat)).json();

    // A refusal that does not say when the door opens is an obstruction. The
    // date is DERIVED from the subscription's own created_at + trial_period_days
    // rather than restated here, so a changed trial length moves it.
    const created = Date.parse(await dodoStub.retrieve.mock.results[0].value.then((s: any) => s.created_at));
    const expected = new Date(created + 14 * 24 * 60 * 60 * 1000);
    expect(data.trialEndsAt).toBe(expected.toISOString());
    expect(data.error).toContain(
      expected.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }),
    );
  });

  it('still refuses when the trial end cannot be dated, without inventing one', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    // Date arithmetic says the trial is over, but no real charge has ever landed
    // — a trial extended by hand in the dashboard. In-trial by the payments
    // fingerprint, which knows THAT but never WHEN.
    dodoStub.retrieve.mockResolvedValue({
      subscription_id: T.sub,
      status: 'active',
      product_id: PLUS_MONTHLY,
      trial_period_days: 14,
      created_at: '2025-01-01T00:00:00Z',
      addons: [],
    });
    dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }] });

    const res = await post({ ...buyOneSeat, confirm: true });
    expect(res.status).toBe(409);
    const data = await res.json();

    // 🔴 No date is offered rather than a guessed one — a promised day a church
    // would hold Harvest to. The copy still says the trial is what is in the way.
    expect(data.trialEndsAt).toBeUndefined();
    expect(data.error).toMatch(/as soon as your free trial ends/i);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses a REMOVAL during the trial too, for the same reason', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionInTrial(PLUS_MONTHLY, [{ addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 }]);

    // Dropping an add-on is also a changePlan call and also ends the trial, so
    // allowing it would charge a church for its whole plan as a consequence of
    // trying to spend LESS.
    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 0 }],
      confirm: true,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('addon-change-unavailable-during-trial');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses when trial status cannot be determined at all — uncertainty never charges', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    dodoStub.retrieve.mockRejectedValue(new Error('dodo unreachable'));

    const res = await post({ ...buyOneSeat, confirm: true });
    expect(res.status).toBe(503);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('🔴 lets a tenant PAST its trial buy normally — the no-regression half', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post({ ...buyOneSeat, confirm: true });
    expect(res.status).toBe(200);
    expect(dodoStub.changePlan).toHaveBeenCalledTimes(1);
  });
});

// ── Test 11 ──────────────────────────────────────────────────────────────────

describe('an ordinary tenant member cannot buy an add-on', () => {
  it('403s before any Dodo call, on both the preview and the confirm', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asMember();

    for (const body of [buyOneSeat, { ...buyOneSeat, confirm: true }]) {
      const res = await post(body);
      expect(res.status).toBe(403);
    }

    // 🔴 The gate is `requireOwner`, and it runs first: nothing about the
    // subscription was even read, let alone changed.
    expect(dodoStub.retrieve).not.toHaveBeenCalled();
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('403s a member on the catalogue read too — what is for sale is owner-visible', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asMember();

    const res = await get(T.tenant);
    expect(res.status).toBe(403);
    expect(dodoStub.addonsRetrieve).not.toHaveBeenCalled();
  });

  it('admits an owner-by-roster with no user-doc role — the THE-64 identity', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    // On the tenant_private adminEmails roster, but no role and no tenantId of
    // their own — requireAuth's user-doc fallback finds nothing.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'roster_1', email: 'pastor@grace.example', auth_time: 1,
    });
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post(buyOneSeat);
    expect(res.status).toBe(200);
    expect((await res.json()).preview).toBeDefined();
  });
});

// ── Test 12 ──────────────────────────────────────────────────────────────────

describe('nothing in this path writes the tenant plan or the add-on set', () => {
  it('leaves Firestore byte-for-byte unchanged through a confirmed purchase', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus', {
      aiAssistant: 0, adminSeats: 1, contactPacks: 0, unlimitedContacts: false, campuses: 0,
    });
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 }]);

    const before = new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]));
    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 4 }],
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(dodoStub.changePlan).toHaveBeenCalledTimes(1);

    // 🔴 The `subscription.plan_changed` webhook is the single writer of BOTH
    // `plan` and the add-on set — and #319 taught its already-applied
    // short-circuit to compare the add-on set, so a purchase with no tier change
    // is no longer swallowed as a duplicate. This route records nothing.
    expect(new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]))).toEqual(before);
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('plus');
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.addons).toEqual({
      aiAssistant: 0, adminSeats: 1, contactPacks: 0, unlimitedContacts: false, campuses: 0,
    });
  });

  it('leaves Firestore unchanged through a REMOVAL too', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus', {
      aiAssistant: 0, adminSeats: 2, contactPacks: 0, unlimitedContacts: false, campuses: 0,
    });
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: ADMIN_SEAT_MONTHLY, quantity: 2 }]);

    const before = new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]));
    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 0 }],
      confirm: true,
    });
    expect(res.status).toBe(200);

    expect(new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]))).toEqual(before);
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.addons?.adminSeats).toBe(2);
  });
});

// ── The shared guards, still guarding on this route ──────────────────────────

describe('the guards `change-plan` earned apply to this route too', () => {
  it('refuses a Stripe-owned tenant, with the same code', async () => {
    currentDb.store.set(`tenants/${T.tenant}`, {
      name: 'Grace Chapel', plan: 'plus', status: 'active', ownerId: 'owner_1',
    });
    currentDb.store.set(`tenant_private/${T.tenant}`, {
      stripeCustomerId: 'cus_stripe_1',
      stripeSubscriptionId: 'sub_stripe_1',
      adminEmails: ['pastor@grace.example'],
    });
    currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
    asOwner();

    const res = await post(buyOneSeat);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('billing-action-unavailable');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses a church whose renewal failed, naming the card (THE-128)', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    currentDb.store.set(`tenant_private/${T.tenant}`, {
      ...currentDb.store.get(`tenant_private/${T.tenant}`),
      dodoOnHoldAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    asOwner();

    const res = await post(buyOneSeat);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('plan-change-unavailable-payment-failed');
    expect(data.error).toMatch(/payment did not go through/i);
    expect(data.error).toMatch(/update the card on file/i);
    // 🔴 The same absence THE-128 pins on `change-plan`: no retry affordance, and
    // no payment surface — the way out is the existing portal path.
    expect(data.error).not.toMatch(/retry|try again/i);
    expect(data.manageBillingPath).toBe('/api/stripe/portal');
    expect(dodoStub.retrieve).not.toHaveBeenCalled();
  });

  it('refuses when what the subscription holds cannot be read, rather than sending an empty list', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    // No `addons` field at all — a payload this build does not understand.
    // "None" and "unknown" are different facts and must not converge on [].
    dodoStub.retrieve.mockResolvedValue({
      subscription_id: T.sub,
      status: 'active',
      product_id: PLUS_MONTHLY,
      trial_period_days: 14,
      created_at: '2025-01-01T00:00:00Z',
    });
    dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }, { total_amount: 4900 }] });

    const res = await post({ ...buyOneSeat, confirm: true });
    expect(res.status).toBe(503);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── Input handling ───────────────────────────────────────────────────────────

describe('the request body is validated before anything is billed', () => {
  it('refuses an add-on name this build does not sell', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post({ tenantId: T.tenant, addons: [{ addon: 'freePonies', quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('🔴 caps Unlimited Contacts at one — holding it at all is the whole fact', async () => {
    // ⚠️ ON MINISTRY, because that is the only tier whose product Dodo attaches
    // Unlimited Contacts to (THE-160). This test is about the QUANTITY cap, and
    // running it on Individual would now be refused for a different reason
    // entirely — passing or failing for nothing to do with what it asserts.
    seedDodoTenant(MAX_MONTHLY, 'max');
    asOwner();
    subscriptionHolding(MAX_MONTHLY, []);

    await post({
      tenantId: T.tenant,
      addons: [{ addon: 'unlimitedContacts', quantity: 3 }],
      confirm: true,
    });

    // Three of them grants precisely what one grants, and Dodo would bill for
    // three. There is no reading of "three unlimiteds" that is worth money.
    expect(addonsSentTo(dodoStub.changePlan)).toEqual([
      { addon_id: UNLIMITED_MONTHLY, quantity: 1 },
    ]);
  });

  it('refuses an absurd quantity rather than silently clamping it', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 5000 }],
      confirm: true,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('addon-quantity-too-large');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses one add-on listed twice, which has no single answer', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'adminSeat', quantity: 1 }, { addon: 'adminSeat', quantity: 5 }],
    });
    expect(res.status).toBe(400);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── The catalogue read ───────────────────────────────────────────────────────

describe('the catalogue lists what can be sold, priced by Dodo', () => {
  it("offers what the tenant's OWN product carries, named and priced", async () => {
    seedDodoTenant(MAX_MONTHLY, 'max');
    asOwner();
    subscriptionHolding(MAX_MONTHLY, []);

    const res = await get(T.tenant);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.billing).toBe('monthly');
    // A Ministry tenant, whose product carries all five. Named by meaning,
    // never by id — and the set is the product's, not the period's.
    expect(data.addons.map((a: { addon: string }) => a.addon).sort()).toEqual(
      ['adminSeat', 'aiAssistant', 'campus', 'contactPack', 'unlimitedContacts'],
    );
    // Prices came from Dodo. The route reports what it was told.
    for (const offered of data.addons) {
      expect(typeof offered.priceMinorUnits).toBe('number');
      expect(offered.currency).toBe('USD');
      expect(offered.name).not.toBe('');
    }
    // 🔴 No id reaches the browser, in either direction.
    const body = JSON.stringify(data);
    for (const id of Object.keys(ADDON_NAMES)) {
      expect(body, `catalogue leaked ${id}`).not.toContain(id);
    }
  });

  it('lists the ANNUAL add-ons for an annual tenant', async () => {
    seedDodoTenant(PLUS_YEARLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_YEARLY, []);

    const res = await get(T.tenant);
    expect(res.status).toBe(200);
    expect((await res.json()).billing).toBe('yearly');

    // The ids actually read are the annual ones — the period is a billing fact
    // the tenant already has, not something the browser chooses.
    const asked = dodoStub.addonsRetrieve.mock.calls.map((call) => call[0]);
    expect(asked).toContain(ADMIN_SEAT_YEARLY);
    expect(asked).not.toContain(ADMIN_SEAT_MONTHLY);
  });
});

// ── THE-160 — 🔴 A TIER IS ONLY OFFERED WHAT ITS PRODUCT ACTUALLY CARRIES ────

/** The meanings this tenant is offered, sorted. Names, never ids. */
async function offeredMeanings(): Promise<string[]> {
  const res = await get(T.tenant);
  expect(res.status).toBe(200);
  return ((await res.json()).addons as { addon: string }[]).map((a) => a.addon).sort();
}

const SRC = resolve(__dirname, '../../../..');
/** A source file with its comments stripped — stating a rule is not breaking it. */
const readSource = (rel: string) =>
  readFileSync(resolve(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

describe('the add-ons offered follow the tenant’s own product, not its billing period', () => {
  // ── Tests 1 and 2 — 🔴 THE REGRESSION ──────────────────────────────────────

  it('an Individual tenant is not offered Contacts +500', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();

    const offered = await offeredMeanings();

    // 🔴 THE DEFECT, in one line. The offered set was filtered by billing period
    // alone, so every monthly-mapped add-on reached every monthly tenant —
    // including a pack Dodo does not attach to the Individual products.
    expect(offered).not.toContain('contactPack');
    // And the three the Individual products DO carry are still there: this is a
    // filter, not an outage.
    expect(offered).toEqual(['adminSeat', 'aiAssistant', 'campus']);
  });

  it('an Individual tenant is not offered Unlimited Contacts', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();

    const offered = await offeredMeanings();

    // 🔴 THE MONEY HALF. Unlimited Contacts is attached to Ministry alone, so
    // offering it on a $49 plan inverts the tier ladder — which is the exact
    // thing THE-133 put availability in Dodo to prevent.
    expect(offered).not.toContain('unlimitedContacts');

    // Nothing was even priced for it: the intersection is taken before the
    // per-add-on reads, so an unsellable add-on costs no round trip either.
    const asked = dodoStub.addonsRetrieve.mock.calls.map((call) => call[0]);
    expect(asked).not.toContain(UNLIMITED_MONTHLY);
    expect(asked).not.toContain(CONTACT_PACK_MONTHLY);
  });

  it('an Individual tenant on ANNUAL billing is filtered the same way', async () => {
    seedDodoTenant(PLUS_YEARLY, 'plus');
    asOwner();

    // The two questions are independent: the period picks WHICH id, the product
    // decides WHETHER it is offered. Both apply on both periods.
    expect(await offeredMeanings()).toEqual(['adminSeat', 'aiAssistant', 'campus']);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────

  it('a Small Team tenant is offered Contacts +500 but not Unlimited', async () => {
    seedDodoTenant(PRO_MONTHLY, 'pro');
    asOwner();

    const offered = await offeredMeanings();

    // The middle rung, which is what makes this a ladder rather than a switch.
    expect(offered).toContain('contactPack');
    expect(offered).not.toContain('unlimitedContacts');
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────

  it('a Ministry tenant is offered all five', async () => {
    seedDodoTenant(MAX_MONTHLY, 'max');
    asOwner();

    // The top rung loses nothing. A filter that quietly narrowed everybody would
    // pass tests 1–3 and still be a defect.
    expect(await offeredMeanings()).toEqual([...DODO_ADDON_MEANINGS].sort());
  });

  // ── Test 5 — 🔴 THE THE-133 GUARD ──────────────────────────────────────────

  describe('the offered set is derived from the product, never from a tier table', () => {
    it('follows Dodo when Dodo contradicts the tier ladder entirely', async () => {
      seedDodoTenant(PLUS_MONTHLY, 'plus');
      asOwner();
      // 🔴 Dodo says the INDIVIDUAL product carries Unlimited Contacts. That is
      // not the real ladder — and that is the point: if this build held a tier
      // table, or hardcoded "unlimited is Ministry only", the answer here would
      // be the table's rather than the processor's. Attachment is the only
      // input, so moving it in Dodo moves what is sold with no code change.
      productCarries(PLUS_MONTHLY, 'monthly', ['unlimitedContacts']);

      expect(await offeredMeanings()).toEqual(['unlimitedContacts']);
    });

    it('narrows a Ministry tenant when Dodo says its product carries one add-on', async () => {
      seedDodoTenant(MAX_MONTHLY, 'max');
      asOwner();
      // The same claim in the other direction: the top tier is not special-cased
      // into "gets everything" anywhere.
      productCarries(MAX_MONTHLY, 'monthly', ['adminSeat']);

      expect(await offeredMeanings()).toEqual(['adminSeat']);
    });

    it('states no tier’s add-ons anywhere on the availability path', () => {
      // An absence, so it is scanned rather than exercised: the build looks
      // identical right up until someone "helpfully" writes the ladder down.
      for (const file of ['app/api/dodo/addons/route.ts', 'lib/dodo/addon-purchase.ts']) {
        expect(readSource(file), `${file} names a plan`).not.toMatch(/['"](plus|pro|max)['"]/);
      }
      // And the derivation is a read of the product, by name.
      expect(readSource('app/api/dodo/addons/route.ts')).toContain('retrieveDodoProductAddonIds');
    });
  });

  // ── Test 8 ─────────────────────────────────────────────────────────────────

  describe('the product add-on array is read as id strings, not objects', () => {
    it('refuses rather than offering nothing when Dodo reports objects', async () => {
      seedDodoTenant(MAX_MONTHLY, 'max');
      asOwner();
      // 🔴 PR 307 established the shape: a product's `addons` holds plain id
      // strings. Comparing objects against strings yields an EMPTY intersection,
      // which would silently offer nothing at all — a build that looks merely
      // conservative while it has actually stopped selling. So an entry that is
      // not a string is an unreadable payload, and unreadable refuses.
      dodoStub.productsRetrieve.mockResolvedValue({
        product_id: MAX_MONTHLY,
        addons: [{ addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 }],
      });

      const res = await get(T.tenant);
      expect(res.status).toBe(503);
      // Not an empty catalogue reported as success.
      expect((await res.json()).addons).toBeUndefined();
    });

    it('refuses the purchase path on the same payload, charging nothing', async () => {
      seedDodoTenant(MAX_MONTHLY, 'max');
      asOwner();
      subscriptionHolding(MAX_MONTHLY, []);
      dodoStub.productsRetrieve.mockResolvedValue({
        product_id: MAX_MONTHLY,
        addons: [{ addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 }],
      });

      const res = await post({ ...buyOneSeat, confirm: true });
      expect(res.status).toBe(503);
      expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
      expect(dodoStub.changePlan).not.toHaveBeenCalled();
    });

    it('sells normally when the ids arrive as the strings Dodo really sends', async () => {
      seedDodoTenant(MAX_MONTHLY, 'max');
      asOwner();
      subscriptionHolding(MAX_MONTHLY, []);

      const res = await post({ ...buyOneSeat, confirm: true });
      expect(res.status).toBe(200);
      expect(addonsSentTo(dodoStub.changePlan)).toEqual([
        { addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 },
      ]);
    });
  });
});

// ── Test 6 — 🔴 THE POST REFUSES TOO, WITH NO OFFER SURFACE IN FRONT OF IT ───

describe('a POST for an add-on not attached to the tenant’s product is refused', () => {
  it('is refused before any Dodo call that quotes or charges', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    // An Individual tenant confirming the $59 Unlimited Contacts — a stale tab,
    // a replay, or a direct call. The GET not listing it is not a gate.
    const confirmRes = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'unlimitedContacts', quantity: 1 }],
      confirm: true,
    });

    expect(confirmRes.status).toBe(400);
    expect((await confirmRes.json()).code).toBe('addon-not-on-your-plan');

    // 🔴 Nothing was quoted and nothing was charged. Whether Dodo would have
    // rejected the unattached add-on or simply billed for it is undocumented,
    // and a church's card is not where that gets established.
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses the PREVIEW too, so no price is quoted for it either', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'contactPack', quantity: 1 }],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('addon-not-on-your-plan');
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
  });

  it('names the add-on by MEANING in the refusal, never by id', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'unlimitedContacts', quantity: 1 }],
    });
    const data = await res.json();

    expect(data.addon).toBe('unlimitedContacts');
    const body = JSON.stringify(data);
    for (const id of Object.keys(ADDON_NAMES)) {
      expect(body, `refusal leaked ${id}`).not.toContain(id);
    }
  });

  it('reports it on the money path, with the product that could not sell it', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    await post({ tenantId: T.tenant, addons: [{ addon: 'unlimitedContacts', quantity: 1 }] });

    // An offer surface that produced this request has drifted from what the
    // tenant's product sells, and that is worth knowing about.
    const steps = mockCapture.mock.calls.map((call) => call[1]?.step);
    expect(steps).toContain('dodo-addons-not-on-product');
    const reported = mockCapture.mock.calls.find(
      (call) => call[1]?.step === 'dodo-addons-not-on-product',
    );
    expect(reported?.[1]?.ids?.productId).toBe(PLUS_MONTHLY);
    expect(reported?.[1]?.ids?.meaning).toBe('unlimitedContacts');
  });

  it('🔴 still lets the tenant REMOVE one it already holds', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    // Sold by the very defect this fixes: an Individual tenant holding the pack
    // its product does not carry. Refusing the removal would trap it in the
    // charge — so attachment is checked on what is ADDED, never on what is
    // dropped, and this is the unwind path for anything already sold.
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: CONTACT_PACK_MONTHLY, quantity: 2 }]);

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'contactPack', quantity: 0 }],
      confirm: true,
    });

    expect(res.status).toBe(200);
    expect(addonsSentTo(dodoStub.changePlan)).toEqual([]);
  });

  it('🔴 carries an unattached add-on it holds through an UNRELATED purchase', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, [{ addon_id: UNLIMITED_MONTHLY, quantity: 1 }]);

    // Buying a seat must not silently cancel something the church already pays
    // for. The attachment check reads the REQUEST, never the fold — stripping
    // held add-ons here would be a refund-shaped bug with no refund available.
    const res = await post({ ...buyOneSeat, confirm: true });

    expect(res.status).toBe(200);
    expect(addonsSentTo(dodoStub.changePlan)).toEqual([
      { addon_id: UNLIMITED_MONTHLY, quantity: 1 },
      { addon_id: ADMIN_SEAT_MONTHLY, quantity: 1 },
    ]);
  });

  it('refuses when what the product sells cannot be read, rather than assuming it sells everything', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);
    dodoStub.productsRetrieve.mockRejectedValue(new Error('dodo unreachable'));

    const res = await post({ ...buyOneSeat, confirm: true });

    expect(res.status).toBe(503);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── Test 7 ───────────────────────────────────────────────────────────────────

describe('that refusal is distinct from the not-mapped-in-this-environment refusal', () => {
  it('does not answer a tier problem with the catalogue-gap message', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await post({
      tenantId: T.tenant,
      addons: [{ addon: 'unlimitedContacts', quantity: 1 }],
    });
    const data = await res.json();

    // 🔴 "Not sold on your tier" and "not mapped in this environment" are
    // different facts with different ways out — an upgrade the owner can make
    // themselves, versus a catalogue gap only support can close. One message for
    // both sends every church to the wrong place.
    expect(data.code).toBe('addon-not-on-your-plan');
    expect(data.code).not.toBe('addon-not-available');
    expect(data.error).toMatch(/current plan/i);
    // The live-Campus copy, which must not appear here.
    expect(data.error).not.toMatch(/set it up for you/i);
    expect(data.error).not.toMatch(/not available for purchase yet/i);

    // And they report under different steps, so the two are separable in Sentry
    // rather than one undifferentiated count.
    const steps = mockCapture.mock.calls.map((call) => call[1]?.step);
    expect(steps).toContain('dodo-addons-not-on-product');
    expect(steps).not.toContain('dodo-addons-unmapped-requested');
  });

  it('keeps both refusals in the route, as two codes and two steps', () => {
    /**
     * ⚠️ THE SECOND REFUSAL HAS NO RUNTIME TRIGGER LEFT, so its distinctness is
     * pinned as SOURCE rather than exercised. `DODO_TEST_ADDONS` and
     * `DODO_LIVE_ADDONS` now map all ten ids — the live Campus gap that used to
     * fire it was closed when its two ids were recorded — so no request in
     * either environment can reach the unmapped arm today.
     *
     * That is exactly when a refusal gets quietly folded into its neighbour
     * during a later edit: it looks dead. It is not. It is the guard that stops
     * an add-on this build cannot name from being sold the moment a new meaning
     * is added to the table with one period's id missing.
     */
    const route = readSource('app/api/dodo/addons/route.ts');
    for (const marker of [
      'addon-not-on-your-plan',
      'addon-not-available',
      'dodo-addons-not-on-product',
      'dodo-addons-unmapped-requested',
    ]) {
      expect(route, `route no longer states ${marker}`).toContain(marker);
    }
    // Distinct strings, not one constant used twice.
    expect(new Set(['addon-not-on-your-plan', 'addon-not-available']).size).toBe(2);

    // And the resolver still answers them as two separate reasons.
    const resolver = readSource('lib/dodo/addon-purchase.ts');
    expect(resolver).toContain("reason: 'not-on-product'");
    expect(resolver).toContain("reason: 'unmapped'");
  });
});

// ── Test 9 ───────────────────────────────────────────────────────────────────

describe('an unknown current product still reports its existing coded error', () => {
  it('refuses both paths before reading what any product sells', async () => {
    // A product outside this build's catalogue, or none recorded. Resolved by
    // the shared billing context, which is also where the product id the new
    // filter reads comes from — so this refusal has to come FIRST or the filter
    // would be asking Dodo about a product Harvest cannot name.
    seedDodoTenant('pdt_not_in_this_catalogue', 'plus');
    asOwner();

    for (const res of [await get(T.tenant), await post(buyOneSeat)]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/could not determine your current plan/i);
    }

    const steps = mockCapture.mock.calls.map((call) => call[1]?.step);
    expect(steps).toContain('dodo-addons-unknown-current-product');
    expect(dodoStub.productsRetrieve).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});
