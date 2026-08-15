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

import { GET as addonCatalogue, POST as addonChange } from '@/app/api/dodo/addons/route';
import { DODO_TEST_ADDONS, productIdFor } from '@/lib/dodo/catalogue';
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

const PLUS_MONTHLY = productIdFor('plus', 'monthly');
const PLUS_YEARLY = productIdFor('plus', 'yearly');

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
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

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
  it('offers every mapped add-on for the tenant OWN period, named and priced', async () => {
    seedDodoTenant(PLUS_MONTHLY, 'plus');
    asOwner();
    subscriptionHolding(PLUS_MONTHLY, []);

    const res = await get(T.tenant);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.billing).toBe('monthly');
    // All five meanings are mapped in TEST mode — Campus included, which is
    // exactly the asymmetry `dodo-addon-live-campus.test.ts` pins the other half
    // of. Named by meaning, never by id.
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
