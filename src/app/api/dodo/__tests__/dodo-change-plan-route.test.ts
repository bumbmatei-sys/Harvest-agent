import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextRequest } from 'next/server';

/**
 * THE-89, the route half: `/api/dodo/change-plan`.
 *
 * Driven through the REAL route, the REAL `requireOwner`, and the REAL
 * `resolveBillingOwnership`. Only two things are mocked, per the brief: the
 * Dodo SDK client (via the provider's own test seam) and Firebase. The Stripe
 * SDK is mocked for the two tests that drive `/api/stripe/checkout` to prove
 * both halves of the routing.
 *
 * Covers tests 1–6, 11 and 12 of the brief; 7–10 (the webhook half) live in
 * `src/lib/dodo/__tests__/dodo-plan-changed-webhook.test.ts`.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('testsecret').toString('base64');
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
  process.env.STRIPE_SECRET_KEY = 'sk_test_route_test';
});

const T = {
  tenant: 'grace-chapel',
  sub: 'sub_live_1',
  plusMonthly: 'pdt_0NlAMMZk44L0tL8lcLX6M',
  proMonthly: 'pdt_0NlAMMhi90q5Ovk6QBzcf',
};

// ── In-memory Firestore (the parts requireOwner + the routes read) ───────────

function makeDb() {
  const store = new Map<string, Record<string, any>>();
  // Every document read, in order — what test 8 counts. A guard that re-read
  // the private doc instead of using the copy the route already holds would
  // show up here as an extra `tenant_private/…` entry and nowhere else.
  const reads: string[] = [];
  const key = (coll: string, id: string) => `${coll}/${id}`;

  const docRef = (coll: string, id: string) => ({
    __coll: coll,
    __id: id,
    async get() {
      reads.push(key(coll, id));
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
    reads,
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

const { mockVerifyIdToken, mockCapture, mockSessionsCreate, mockCustomersCreate, mockCustomersRetrieve, mockCustomersList } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockCapture: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockCustomersCreate: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockCustomersList: vi.fn(),
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
vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
    customers = { create: mockCustomersCreate, retrieve: mockCustomersRetrieve, list: mockCustomersList };
    subscriptions = { cancel: vi.fn(), retrieve: vi.fn() };
  },
}));

import { POST as dodoChangePlan } from '@/app/api/dodo/change-plan/route';
import { POST as stripeCheckout } from '@/app/api/stripe/checkout/route';
import { __setDodoClientForTests } from '@/lib/dodo/dodo-provider';
// The REAL window, imported rather than restated — see the THE-128 block.
import { DODO_GRACE_PERIOD_MS } from '@/lib/tenant-lifecycle';

// ── The Dodo SDK stub — the one Dodo mock the brief allows ───────────────────

const dodoStub = {
  retrieve: vi.fn(),
  previewChangePlan: vi.fn(),
  changePlan: vi.fn(),
  paymentsList: vi.fn(),
};

function installDodoStub() {
  __setDodoClientForTests({
    subscriptions: {
      retrieve: dodoStub.retrieve,
      previewChangePlan: dodoStub.previewChangePlan,
      changePlan: dodoStub.changePlan,
    },
    payments: { list: dodoStub.paymentsList },
  } as never);
}

/**
 * A subscription well past its trial: created 2025, 14-day trial long over.
 *
 * `addons: []` is present because Dodo returns it on every subscription — an
 * empty cart, stated. THE-132's add-on tests live in their own file; here it
 * only keeps the stub faithful to the payload the route now reads.
 */
function pastTrialSubscription() {
  dodoStub.retrieve.mockResolvedValue({
    subscription_id: T.sub,
    status: 'active',
    product_id: T.plusMonthly,
    trial_period_days: 14,
    created_at: '2025-01-01T00:00:00Z',
    addons: [],
  });
  // Two payments: the $0 trial mandate plus a real renewal — not in trial.
  dodoStub.paymentsList.mockResolvedValue({
    items: [{ total_amount: 0 }, { total_amount: 4900 }],
  });
}

function inTrialSubscription(nowMs: number) {
  dodoStub.retrieve.mockResolvedValue({
    subscription_id: T.sub,
    status: 'active',
    product_id: T.plusMonthly,
    trial_period_days: 14,
    // Day 3 of 14.
    created_at: new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString(),
    addons: [],
  });
  // Exactly one $0 payment — Dodo's own documented in-trial fingerprint.
  dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }] });
}

function stubPreview(summary: Partial<{ total_amount: number; customer_credits: number; currency: string }>) {
  dodoStub.previewChangePlan.mockResolvedValue({
    immediate_charge: {
      effective_at: '2026-08-13T00:00:00Z',
      line_items: [],
      summary: { total_amount: 0, customer_credits: 0, currency: 'USD', ...summary },
    },
    new_plan: {},
  });
}

// ── Tenants ──────────────────────────────────────────────────────────────────

function seedDodoTenant() {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel', plan: 'plus', status: 'active', ownerId: 'owner_1',
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    dodoCustomerId: 'cus_dodo_1',
    dodoProductId: T.plusMonthly,
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
}

function seedStripeTenant() {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel', plan: 'plus', status: 'active', ownerId: 'owner_1',
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    stripeCustomerId: 'cus_stripe_1',
    stripeSubscriptionId: 'sub_stripe_1',
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
}

function seedConflictedTenant() {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Grace Chapel', plan: 'plus', status: 'active', ownerId: 'owner_1',
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    stripeCustomerId: 'cus_stripe_1',
    adminEmails: ['pastor@grace.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
}

/**
 * A Dodo tenant whose renewal FAILED — the THE-128 church.
 *
 * `dodoOnHoldAt` is the field the `subscription.on_hold` handler writes to
 * `tenant_private/{id}`, and it is set here as a raw value on the seeded
 * document rather than through any helper, so the route reads exactly what the
 * webhook leaves behind. `status` stays 'active' on purpose: Dodo sends no
 * terminal event for a subscription that sits in `on_hold`, so nothing has
 * rewritten the tenant's recorded status — the hold is only ever derived.
 */
function seedDodoTenantOnHold(onHoldAt: unknown) {
  seedDodoTenant();
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    ...currentDb.store.get(`tenant_private/${T.tenant}`),
    dodoOnHoldAt: onHoldAt,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

/** Reads of the private doc only — the collection test 8 is about. */
const privateReads = () => currentDb.reads.filter((k) => k.startsWith('tenant_private/'));

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

function post(handler: (req: NextRequest) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new NextRequest('https://theharvest.app/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify(body),
    }) as never,
  );
}

const changePlanBody = { tenantId: T.tenant, plan: 'pro', billing: 'monthly' };

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
  installDodoStub();
});

// ── Test 1: a Dodo tenant can change plan ────────────────────────────────────

describe('a Dodo tenant can change plan', () => {
  it('previews the charge, then performs the change on confirm', async () => {
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500, currency: 'USD' });
    dodoStub.changePlan.mockResolvedValue(undefined);

    const previewRes = await post(dodoChangePlan, changePlanBody);
    expect(previewRes.status).toBe(200);
    const previewData = await previewRes.json();
    expect(previewData.preview).toMatchObject({ amountDueNow: 2500, currency: 'USD', plan: 'pro' });
    // The preview charges nothing.
    expect(dodoStub.changePlan).not.toHaveBeenCalled();

    const confirmRes = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(confirmRes.status).toBe(200);
    expect((await confirmRes.json()).ok).toBe(true);
    expect(dodoStub.changePlan).toHaveBeenCalledTimes(1);
    expect(dodoStub.changePlan).toHaveBeenCalledWith(
      T.sub,
      expect.objectContaining({ product_id: T.proMonthly, quantity: 1 }),
    );
  });

  it('refuses ANY term switch — THE-88 stays a separate decision', async () => {
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();

    const res = await post(dodoChangePlan, { tenantId: T.tenant, plan: 'pro', billing: 'yearly' });
    expect(res.status).toBe(400);
    // ⚠️ The message no longer names "monthly and annual". With three terms
    // that phrasing would tell a QUARTERLY church the refusal was about some
    // other pair — so it names neither pair.
    expect((await res.json()).error).toContain('Switching billing terms is not available yet');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses a switch to QUARTERLY the same way, rather than accepting it', async () => {
    // 🔴 The new term must land on the same refusal, not slip through as an
    // unrecognised value the route happens to ignore.
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();

    const res = await post(dodoChangePlan, { tenantId: T.tenant, plan: 'pro', billing: 'quarterly' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Switching billing terms is not available yet');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised term outright rather than failing closed to monthly', async () => {
    // This route CHANGES what an existing subscription is charged, so "we could
    // not read your term" must be a 400 the owner sees — never a silent choice
    // made on their behalf. That is the opposite of the signup lane's fallback,
    // deliberately.
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();

    const res = await post(dodoChangePlan, { tenantId: T.tenant, plan: 'pro', billing: 'biennial' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Invalid plan/billing');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('test 10 (route half): the route writes NO tenant state — the webhook is the one writer of plan', async () => {
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });
    dodoStub.changePlan.mockResolvedValue(undefined);

    const before = new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]));
    const res = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(res.status).toBe(200);

    // Byte-for-byte: the confirm changed NOTHING in Firestore. tenants.plan is
    // still 'plus' until subscription.plan_changed lands (see the webhook
    // tests, which prove that path DOES move it).
    expect(new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]))).toEqual(before);
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('plus');
  });
});

// ── Test 2: a Stripe tenant still uses the Stripe path ───────────────────────

describe('a Stripe tenant still uses the Stripe path', () => {
  it('gets a Stripe checkout session from /api/stripe/checkout, untouched by this PR', async () => {
    seedStripeTenant();
    asOwner();
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_stripe_1', deleted: false });
    mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/session_1' });

    const res = await post(stripeCheckout, {
      plan: 'pro', billing: 'monthly', tenantId: T.tenant, tenantName: 'Grace Chapel',
    });

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://checkout.stripe/session_1');
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('is refused by the Dodo route, which serves only Dodo-owned tenants', async () => {
    seedStripeTenant();
    asOwner();

    const res = await post(dodoChangePlan, changePlanBody);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('billing-action-unavailable');
    expect(data.processor).toBe('stripe');
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── Test 3: a conflicted tenant is still refused ─────────────────────────────

describe('a conflicted tenant is still refused', () => {
  it('by the Stripe route, with the one shared wording', async () => {
    seedConflictedTenant();
    asOwner();

    const res = await post(stripeCheckout, { plan: 'pro', billing: 'monthly', tenantId: T.tenant });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('billing-action-unavailable');
    expect(data.reason).toBe('conflict');
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('by the Dodo route too — the same helper, the same wording, no charge from either side', async () => {
    seedConflictedTenant();
    asOwner();

    const res = await post(dodoChangePlan, changePlanBody);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('billing-action-unavailable');
    expect(data.reason).toBe('conflict');
    expect(data.error).toContain('more than one payment processor');
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── Test 4: no Stripe call is made for a Dodo tenant (the double-billing regression) ──

describe('no Stripe call is made for a Dodo tenant', () => {
  it('the Stripe route refuses BEFORE any Stripe API call — no session, no customer', async () => {
    seedDodoTenant();
    asOwner();

    const res = await post(stripeCheckout, { plan: 'pro', billing: 'monthly', tenantId: T.tenant });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('billing-action-unavailable');
    // 🔴 The regression itself: nothing Stripe-shaped ran. A session OR a
    // persisted customer would be the double-billing bug reborn.
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
    // And no Stripe identifier was persisted onto the Dodo tenant.
    expect(currentDb.store.get(`tenant_private/${T.tenant}`)?.stripeCustomerId).toBeUndefined();
  });

  it('the Dodo route itself never imports Stripe', () => {
    const route = readFileSync(
      resolve(__dirname, '../change-plan/route.ts'),
      'utf8',
    );
    expect(route).not.toMatch(/from\s+['"]stripe['"]/);
    expect(route).not.toContain('STRIPE_SECRET_KEY');
  });
});

// ── Test 5: on_payment_failure is always prevent_change ──────────────────────

describe('on_payment_failure is always prevent_change', () => {
  it('is passed explicitly on the preview AND on the real call', async () => {
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });
    dodoStub.changePlan.mockResolvedValue(undefined);

    await post(dodoChangePlan, changePlanBody);
    await post(dodoChangePlan, { ...changePlanBody, confirm: true });

    expect(dodoStub.previewChangePlan).toHaveBeenCalledWith(
      T.sub,
      expect.objectContaining({ on_payment_failure: 'prevent_change' }),
    );
    expect(dodoStub.changePlan).toHaveBeenCalledWith(
      T.sub,
      expect.objectContaining({ on_payment_failure: 'prevent_change' }),
    );

    // 🔴 Explicit on EVERY call, so a dashboard edit of the business-level
    // default (apply_change — grants the tier even when payment fails) can
    // never reach this path.
    for (const call of [...dodoStub.previewChangePlan.mock.calls, ...dodoStub.changePlan.mock.calls]) {
      expect(call[1].on_payment_failure).toBe('prevent_change');
    }
  });
});

// ── Test 6: a plan change during trial does not silently charge early ────────

describe('a plan change during trial does not silently charge early', () => {
  it('is REFUSED during the 14-day trial — the decision: refuse, never end a trial early', async () => {
    seedDodoTenant();
    asOwner();
    inTrialSubscription(Date.now());

    const previewRes = await post(dodoChangePlan, changePlanBody);
    expect(previewRes.status).toBe(409);
    expect((await previewRes.json()).code).toBe('plan-change-unavailable-during-trial');

    const confirmRes = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(confirmRes.status).toBe(409);
    expect((await confirmRes.json()).code).toBe('plan-change-unavailable-during-trial');

    // Nothing was charged and nothing was changed.
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('still refuses when only the payments fingerprint says in-trial (a dashboard-extended trial)', async () => {
    seedDodoTenant();
    asOwner();
    // Date arithmetic says the trial is over…
    dodoStub.retrieve.mockResolvedValue({
      subscription_id: T.sub,
      status: 'active',
      product_id: T.plusMonthly,
      trial_period_days: 14,
      created_at: '2026-07-01T00:00:00Z',
      addons: [],
    });
    // …but no real charge has ever landed: exactly one $0 payment.
    dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }] });

    const res = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(res.status).toBe(409);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses when trial status cannot be determined at all — uncertainty never charges', async () => {
    seedDodoTenant();
    asOwner();
    dodoStub.retrieve.mockRejectedValue(new Error('dodo unreachable'));

    const res = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(res.status).toBe(503);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── Test 11: a member who is not the owner cannot change the plan (THE-80) ───

describe('a member who is not the owner cannot change the plan', () => {
  it('403s a tenant member on the Dodo route before any Dodo call', async () => {
    seedDodoTenant();
    asMember();

    const res = await post(dodoChangePlan, changePlanBody);
    expect(res.status).toBe(403);
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
    expect(dodoStub.retrieve).not.toHaveBeenCalled();
  });

  it('admits an owner-by-roster with no user-doc role — the THE-64 identity', async () => {
    seedDodoTenant();
    // On the tenant_private adminEmails roster, but no role and no tenantId of
    // their own — requireAuth's user-doc fallback finds nothing.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'roster_1', email: 'pastor@grace.example', auth_time: 1,
    });
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });

    const res = await post(dodoChangePlan, changePlanBody);
    expect(res.status).toBe(200);
    expect((await res.json()).preview).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE-128 — a failed card gets "update your card", not a generic error.
//
// Driven through the REAL route, the REAL `resolveBillingOwnership`, the REAL
// `requireOwner` and the REAL `resolveTenantGraceState`. `DODO_GRACE_PERIOD_MS`
// is imported rather than restated so a guard that re-derived the window with
// its own arithmetic fails test 4 instead of quietly agreeing with itself.
// ═══════════════════════════════════════════════════════════════════════════

describe('THE-128: a church whose renewal failed is told what actually happened', () => {
  it('test 1: a tenant in grace is told its payment failed, not given a generic error', async () => {
    const heldAt = daysAgo(7);
    seedDodoTenantOnHold(heldAt);
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });

    const res = await post(dodoChangePlan, changePlanBody);
    expect(res.status).toBe(409);
    const data = await res.json();

    // The problem, named. Not "Failed to change plan" and not the 500 the
    // catch-all would have produced.
    expect(data.error).toMatch(/payment did not go through/i);
    expect(data.error).not.toMatch(/failed to change plan/i);
    expect(data.state).toBe('in-grace');

    // 🔴 And the deadline they can act on, to the millisecond — derived from
    // the one definition of the window, so this is the same day the donate gate
    // stops giving rather than a second countdown that can drift from it.
    const expected = new Date(Date.parse(heldAt) + DODO_GRACE_PERIOD_MS);
    expect(data.graceEndsAt).toBe(expected.toISOString());
    expect(data.error).toContain(
      expected.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }),
    );
  });

  it('test 2: the refusal names the card as the thing to fix', async () => {
    seedDodoTenantOnHold(daysAgo(7));
    asOwner();

    const data = await (await post(dodoChangePlan, changePlanBody)).json();

    // The one sentence worth having. "Contact support" would not be it, and
    // neither would naming the failure without naming the remedy.
    expect(data.error).toMatch(/card/i);
    expect(data.error).toMatch(/update the card on file/i);
    expect(data.error).not.toMatch(/contact support/i);
  });

  it('test 3: the refusal carries its own code, distinct from the trial and ownership refusals', async () => {
    // All three codes collected from REAL responses rather than compared against
    // hardcoded strings — renaming any one of them still has to keep them apart.
    seedDodoTenantOnHold(daysAgo(7));
    asOwner();
    const onHoldCode = (await (await post(dodoChangePlan, changePlanBody)).json()).code;

    currentDb = makeDb();
    seedDodoTenant();
    asOwner();
    inTrialSubscription(Date.now());
    const trialCode = (await (await post(dodoChangePlan, changePlanBody)).json()).code;

    currentDb = makeDb();
    seedStripeTenant();
    asOwner();
    const ownershipCode = (await (await post(dodoChangePlan, changePlanBody)).json()).code;

    expect(onHoldCode).toBe('plan-change-unavailable-payment-failed');
    expect(new Set([onHoldCode, trialCode, ownershipCode]).size).toBe(3);
  });

  it('test 4: a tenant past the grace window is refused too — and told giving has already stopped', async () => {
    seedDodoTenantOnHold(daysAgo(22));
    asOwner();
    pastTrialSubscription();

    const res = await post(dodoChangePlan, changePlanBody);
    expect(res.status).toBe(409);
    const data = await res.json();

    // 🔴 The EXPIRED variant specifically. A guard that re-derived the window
    // with its own (longer) arithmetic would still refuse — but it would call
    // this church 'in-grace' and quote it a future deadline that has already
    // passed, and that is what this pins.
    expect(data.code).toBe('plan-change-unavailable-payment-failed');
    expect(data.state).toBe('expired');
    expect(data.graceEndsAt).toBeUndefined();
    expect(data.error).toMatch(/giving has been paused/i);
    expect(data.error).toMatch(/card/i);

    // The boundary itself: at exactly 21 days the window is CLOSED, so this is
    // 'expired' and not the last day of grace.
    currentDb = makeDb();
    seedDodoTenantOnHold(new Date(Date.now() - DODO_GRACE_PERIOD_MS).toISOString());
    asOwner();
    expect((await (await post(dodoChangePlan, changePlanBody)).json()).state).toBe('expired');
  });

  it('test 5: 🔴 a tenant that was never on hold changes plan normally — the no-regression test', async () => {
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500, currency: 'USD' });
    dodoStub.changePlan.mockResolvedValue(undefined);

    // No hold recorded at all — the overwhelmingly common case, and every
    // Stripe-owned tenant forever.
    expect(currentDb.store.get(`tenant_private/${T.tenant}`)?.dodoOnHoldAt).toBeUndefined();

    const previewRes = await post(dodoChangePlan, changePlanBody);
    expect(previewRes.status).toBe(200);
    expect((await previewRes.json()).preview).toMatchObject({ amountDueNow: 2500, plan: 'pro' });

    const confirmRes = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(confirmRes.status).toBe(200);
    expect((await confirmRes.json()).ok).toBe(true);
    expect(dodoStub.changePlan).toHaveBeenCalledTimes(1);
  });

  it('test 5b: an unparseable hold timestamp does not strand a paying church', async () => {
    // The resolver's documented fail-OPEN: the failure mode of allowing is
    // revenue, the failure mode of refusing is a paying church locked out of
    // its own plan by a timestamp that did not parse. This route inherits that
    // rather than second-guessing it.
    seedDodoTenantOnHold('not-a-date');
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });

    const res = await post(dodoChangePlan, changePlanBody);
    expect(res.status).toBe(200);
    expect((await res.json()).preview).toBeDefined();
  });

  it('test 6: the preview refuses as well as the confirm', async () => {
    seedDodoTenantOnHold(daysAgo(7));
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });

    // 🔴 Refusing only on confirm would let a church read a quoted price for a
    // change that cannot happen.
    const previewRes = await post(dodoChangePlan, changePlanBody);
    expect(previewRes.status).toBe(409);
    expect((await previewRes.json()).code).toBe('plan-change-unavailable-payment-failed');

    const confirmRes = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(confirmRes.status).toBe(409);
    expect((await confirmRes.json()).code).toBe('plan-change-unavailable-payment-failed');

    // No quote was fetched and no change was attempted, on either phase.
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
    expect(dodoStub.retrieve).not.toHaveBeenCalled();
  });

  it('test 7: no payment action or retry is exposed', async () => {
    seedDodoTenantOnHold(daysAgo(7));
    asOwner();

    const data = await (await post(dodoChangePlan, changePlanBody)).json();

    // 🔴 The response surface, by LABEL: exactly these keys and no others. A
    // `retryUrl`, `checkoutUrl`, `clientSecret` or `paymentIntent` added later
    // fails here rather than shipping a second way to be charged for one
    // subscription.
    expect(Object.keys(data).sort()).toEqual(
      ['code', 'error', 'graceEndsAt', 'manageBillingPath', 'state'].sort(),
    );

    // The single way out is the existing "Manage subscription" path, which
    // routes a Dodo tenant to Dodo's own portal. Not a route this PR invented.
    expect(data.manageBillingPath).toBe('/api/stripe/portal');
    expect(data.error).not.toMatch(/retry|try again/i);

    // And nothing was charged or attempted to reach a charge.
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
    expect(dodoStub.previewChangePlan).not.toHaveBeenCalled();
  });

  it('test 8: no additional tenant_private read is introduced', async () => {
    // 🔴 ABSOLUTE, not a comparison between the two paths. A `getTenantPrivate`
    // call added ABOVE the `graceState` branch lands on the healthy path too, so
    // "the two paths read the same number of times" stays true while the read
    // count has silently doubled. The number itself is what has to be pinned.
    //
    // ONE read: the `getTenantPrivate` at the ownership resolution. `dodoOnHoldAt`
    // is a field on that same document, so the guard consults a copy already in
    // hand and adds nothing.
    const THE_OWNERSHIP_READ = [`tenant_private/${T.tenant}`];

    seedDodoTenant();
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });
    await post(dodoChangePlan, changePlanBody);
    expect(privateReads()).toEqual(THE_OWNERSHIP_READ);

    // And the refusal path reads no more than the healthy one — the guard is
    // free on the request it actually fires for.
    currentDb = makeDb();
    seedDodoTenantOnHold(daysAgo(7));
    asOwner();
    await post(dodoChangePlan, changePlanBody);
    expect(privateReads()).toEqual(THE_OWNERSHIP_READ);
  });

  it('test 9: on_payment_failure is still prevent_change', async () => {
    seedDodoTenant();
    asOwner();
    pastTrialSubscription();
    stubPreview({ total_amount: 2500 });
    dodoStub.changePlan.mockResolvedValue(undefined);

    await post(dodoChangePlan, changePlanBody);
    await post(dodoChangePlan, { ...changePlanBody, confirm: true });

    // The guarantee this PR must not weaken: the failed charge blocks the
    // change, so no church is moved to a tier it has not paid for. Explicit on
    // every call, preview and confirm alike.
    const calls = [...dodoStub.previewChangePlan.mock.calls, ...dodoStub.changePlan.mock.calls];
    expect(calls.length).toBe(2);
    for (const call of calls) expect(call[1].on_payment_failure).toBe('prevent_change');
  });

  it('test 10: nothing in this path writes the tenant plan', async () => {
    seedDodoTenantOnHold(daysAgo(7));
    asOwner();

    const before = new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]));
    const res = await post(dodoChangePlan, { ...changePlanBody, confirm: true });
    expect(res.status).toBe(409);

    // Byte-for-byte unchanged. The refusal records nothing — no status, no
    // convergence, no `plan`. The webhook stays the single writer, and the
    // grace timer is converged by the paths that already own that (the donate
    // gate and /api/tenants/grace-status), not by a plan-change attempt.
    expect(new Map([...currentDb.store].map(([k, v]) => [k, { ...v }]))).toEqual(before);
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.plan).toBe('plus');
    expect(currentDb.store.get(`tenants/${T.tenant}`)?.status).toBe('active');
  });
});

// ── Test 12: no refund path exists ───────────────────────────────────────────

describe('no refund path exists', () => {
  it('no CODE in the Dodo module or its routes touches a refund', () => {
    // Harvest issues no refunds. Dodo's credit-on-downgrade is consistent with
    // that; a refund call would not be. Scanned as source because the absence
    // of a capability is not observable through behaviour. Comments are
    // stripped first — stating the rule ("Harvest issues no refunds") is
    // welcome; an identifier, call, or string that could reach one is not.
    const roots = [
      resolve(__dirname, '../../../../lib/dodo'),
      resolve(__dirname, '..'),
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(full) || /__tests__|\.test\.tsx?$/.test(full)) continue;
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
        if (/refund/i.test(code)) offenders.push(full);
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
