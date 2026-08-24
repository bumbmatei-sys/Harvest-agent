import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextRequest } from 'next/server';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-226 — Individual → Small Team was refused as a TERM switch.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── What was actually observed ──────────────────────────────────────────────
 *
 * The founder upgraded a free tenant to Individual (worked), then tried
 * Individual → Small Team and got "Switching billing terms is not available
 * yet." He was changing PLAN, not term.
 *
 * The pair, established from production rather than from reading code:
 *
 *   current.period = 'monthly'
 *       Live Dodo subscription `sub_0Nm71Tmd5dD90j2XipJD5` (tenant
 *       `final-test`, created 20:59:46Z, metadata `firstSubscription: 'true'`)
 *       carries `product_id: pdt_0NlJZKKU2AQSSH7E4ziKA`, which is
 *       `plus`/`monthly` in the live catalogue below. Dodo's own cadence fields
 *       agree — `payment_frequency_interval: 'Month'`, count 1 — and so does
 *       the checkout metadata it was created with, `billing: 'monthly'`.
 *
 *   period (sent) = the BillingTermToggle's state, whatever it happened to be
 *       Captured by driving the real `AdminUpgradePage` through the real
 *       `runDodoPlanChange`; see the client half of this suite. Browsing the
 *       yearly prices posted `billing: 'yearly'`, quarterly posted
 *       `'quarterly'`, and an untouched toggle posted `'monthly'`.
 *
 * So the toggle is a PRICE VIEWER whose state was being sent as a statement
 * about what the church pays. A church comparing Small Team's yearly price
 * before pressing Upgrade manufactured a term mismatch out of a display
 * control, and the route — correctly — refused it.
 *
 * ─── 🔴 WHAT THIS DOES NOT DO ────────────────────────────────────────────────
 *
 * It does not touch the term guard. Each term is a separate Dodo product,
 * switching between them is THE-88, and a caller that deliberately sends a
 * different term is still refused — pinned below, and pinned again by reverting
 * the guard and watching that test fail.
 *
 * ⚠️ RUNS IN LIVE MODE, deliberately, unlike `dodo-change-plan-route.test.ts`.
 * Quarterly is `DODO_PRODUCT_UNMAPPED` in test mode, so a quarterly church
 * cannot be represented there at all — and quarterly is exactly the term whose
 * refusal message the founder would have found most confusing. These are also
 * the product ids a real card is charged against.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_' + Buffer.from('testsecret').toString('base64');
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'live_mode';
  process.env.STRIPE_SECRET_KEY = 'sk_test_the226';
});

/**
 * The live products, BY LABEL rather than by price pattern.
 *
 * Named here so every assertion below reads as "Individual, monthly" instead of
 * a bare `pdt_…`, and so a catalogue edit that moved an id under a label would
 * fail loudly rather than silently retargeting these tests.
 */
const P = {
  individualMonthly: 'pdt_0NlJZKKU2AQSSH7E4ziKA',
  individualQuarterly: 'pdt_0NloCamoWgvgYDih2UETS',
  individualYearly: 'pdt_0NlJZMLLKZ5SVGEoSGDdk',
  smallTeamMonthly: 'pdt_0NlJZMOMhmZWiG6UVDl8I',
  smallTeamQuarterly: 'pdt_0NloCaqg1QPMAlkfDnlOe',
  smallTeamYearly: 'pdt_0NlJZMRWL8tuAZseUIRTP',
} as const;

const T = { tenant: 'final-test', sub: 'sub_0Nm71Tmd5dD90j2XipJD5' };

function makeDb() {
  const store = new Map<string, Record<string, any>>();
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

const { mockVerifyIdToken, mockCapture, mockSessionsCreate, mockGetUser } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockCapture: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockGetUser: vi.fn(),
}));

let currentDb = makeDb();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => currentDb.collection(name),
    batch: () => currentDb.batch(),
  },
  adminAuth: {
    verifyIdToken: (...args: any[]) => mockVerifyIdToken(...args),
    getUser: (...args: any[]) => mockGetUser(...args),
  },
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: mockCapture,
  captureHandledError: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
    customers = { create: vi.fn(), retrieve: vi.fn(), list: vi.fn() };
    subscriptions = { cancel: vi.fn(), retrieve: vi.fn() };
  },
}));

import { POST as dodoChangePlan, GET as dodoCurrentTerm } from '@/app/api/dodo/change-plan/route';
import { POST as dodoCheckout } from '@/app/api/dodo/checkout/route';
import { __setDodoClientForTests } from '@/lib/dodo/dodo-provider';
import { attachFirstSubscriptionToTenant } from '@/lib/dodo/first-subscription';
import { provisionTenantFromDodoSubscription } from '@/lib/dodo/provisioning';
import { resolvePlanFromProductId } from '@/lib/dodo/catalogue';

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

/** A subscription well past its trial, on `productId`. */
function pastTrialOn(productId: string) {
  dodoStub.retrieve.mockResolvedValue({
    subscription_id: T.sub,
    status: 'active',
    product_id: productId,
    trial_period_days: 14,
    created_at: '2025-01-01T00:00:00Z',
    addons: [],
  });
  dodoStub.paymentsList.mockResolvedValue({ items: [{ total_amount: 0 }, { total_amount: 2000 }] });
}

function stubPreview(total = 0) {
  dodoStub.previewChangePlan.mockResolvedValue({
    immediate_charge: {
      effective_at: '2026-08-24T00:00:00Z',
      line_items: [],
      summary: { total_amount: total, customer_credits: 0, currency: 'USD' },
    },
    new_plan: {},
  });
}

/** An Individual tenant on `productId`, exactly as the webhook leaves it. */
function seedIndividualOn(productId: string) {
  currentDb.store.set(`tenants/${T.tenant}`, {
    name: 'Final Test', plan: 'plus', status: 'active', ownerId: 'owner_1',
  });
  currentDb.store.set(`tenant_private/${T.tenant}`, {
    billingProcessor: 'dodo',
    dodoSubscriptionId: T.sub,
    dodoCustomerId: 'cus_dodo_1',
    dodoProductId: productId,
    adminEmails: ['pastor@final.example'],
  });
  currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
}

function asOwner() {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'owner_1', email: 'pastor@final.example', tenantId: T.tenant, admin: true, auth_time: 1,
  });
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

function get(handler: (req: NextRequest) => Promise<Response>, tenantId: string) {
  return handler(
    new NextRequest(`https://theharvest.app/api/dodo/change-plan?tenantId=${tenantId}`, {
      method: 'GET',
      headers: { authorization: 'Bearer test-token' },
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = makeDb();
  installDodoStub();
});

// ── Test 1: THE REPORT ───────────────────────────────────────────────────────

describe('an Individual tenant can change plan to Small Team on the same term', () => {
  it('previews and confirms, landing on Small Team monthly', async () => {
    seedIndividualOn(P.individualMonthly);
    asOwner();
    pastTrialOn(P.individualMonthly);
    stubPreview(2000);
    dodoStub.changePlan.mockResolvedValue(undefined);

    const preview = await post(dodoChangePlan, {
      tenantId: T.tenant, plan: 'pro', billing: 'monthly',
    });
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview).toMatchObject({ plan: 'pro', billing: 'monthly' });

    const confirm = await post(dodoChangePlan, {
      tenantId: T.tenant, plan: 'pro', billing: 'monthly', confirm: true,
    });
    expect(confirm.status).toBe(200);
    // 🔴 By LABEL: Small Team on the term the tenant was already on.
    expect(dodoStub.changePlan).toHaveBeenCalledWith(
      T.sub,
      expect.objectContaining({ product_id: P.smallTeamMonthly }),
    );
  });

  it('reports the tenant’s term on GET, from the resolver the guard compares against', async () => {
    seedIndividualOn(P.individualMonthly);
    asOwner();

    const res = await get(dodoCurrentTerm, T.tenant);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: 'plus', billing: 'monthly' });
  });
});

// ── Test 2: the other two terms ──────────────────────────────────────────────

describe('the same works on quarterly and on yearly', () => {
  const cases = [
    { term: 'quarterly', from: P.individualQuarterly, to: P.smallTeamQuarterly },
    { term: 'yearly', from: P.individualYearly, to: P.smallTeamYearly },
  ] as const;

  for (const { term, from, to } of cases) {
    it(`changes Individual → Small Team on ${term}`, async () => {
      seedIndividualOn(from);
      asOwner();
      pastTrialOn(from);
      stubPreview(0);
      dodoStub.changePlan.mockResolvedValue(undefined);

      const res = await post(dodoChangePlan, {
        tenantId: T.tenant, plan: 'pro', billing: term, confirm: true,
      });
      expect(res.status).toBe(200);
      expect(dodoStub.changePlan).toHaveBeenCalledWith(
        T.sub,
        expect.objectContaining({ product_id: to }),
      );
    });

    it(`reports ${term} on GET for a tenant on that term`, async () => {
      seedIndividualOn(from);
      asOwner();
      const res = await get(dodoCurrentTerm, T.tenant);
      expect(res.status).toBe(200);
      expect((await res.json()).billing).toBe(term);
    });
  }
});

// ── Test 3: 🔴 THE GUARD SURVIVES ────────────────────────────────────────────

describe('a genuine term switch is still refused', () => {
  /**
   * 🔴 THE-88 IS REAL AND THIS IS THE TEST THAT KEEPS IT. Nine products exist
   * and a mismatched (plan, term) pair charges the wrong amount. Every cross-term
   * pair a monthly tenant could form is refused, and Dodo is never called.
   */
  for (const requested of ['quarterly', 'yearly'] as const) {
    it(`refuses monthly → ${requested} and calls Dodo not at all`, async () => {
      seedIndividualOn(P.individualMonthly);
      asOwner();
      pastTrialOn(P.individualMonthly);

      const res = await post(dodoChangePlan, {
        tenantId: T.tenant, plan: 'pro', billing: requested, confirm: true,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Switching billing terms is not available yet');
      // The instrumentation THE-226 added: both operands, machine-readable.
      expect(body).toMatchObject({ requested, current: 'monthly' });
      expect(dodoStub.changePlan).not.toHaveBeenCalled();
    });
  }

  it('refuses a term switch that does NOT move plan either', async () => {
    // The term guard runs BEFORE the same-plan refusal, so a pure term switch
    // is caught as a term switch rather than as "already on this plan".
    seedIndividualOn(P.individualYearly);
    asOwner();
    pastTrialOn(P.individualYearly);

    const res = await post(dodoChangePlan, {
      tenantId: T.tenant, plan: 'plus', billing: 'monthly', confirm: true,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Switching billing terms is not available yet');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });
});

// ── Test 4: the suspected root cause, tested rather than assumed ─────────────

describe('a subscription created by first-subscription records the same term as one from signup', () => {
  /**
   * ⚠️ THIS IS THE CANDIDATE THE TICKET SUSPECTED, AND IT IS NOT THE CAUSE.
   * Both writers store `sub.product_id` verbatim, from the same
   * `subscription.active` payload, into the same `tenant_private.dodoProductId`
   * field — so the term `resolveDodoSubscriptionContext` later derives is
   * identical. Kept as a test because "identical by construction" is exactly the
   * kind of claim that stops being true silently.
   */
  const terms = [
    { term: 'monthly', product: P.individualMonthly },
    { term: 'quarterly', product: P.individualQuarterly },
    { term: 'yearly', product: P.individualYearly },
  ] as const;

  for (const { term, product } of terms) {
    it(`records the same product for ${term} whichever path created it`, async () => {
      // The free-upgrade path.
      currentDb = makeDb();
      currentDb.store.set('tenants/upgraded', { plan: 'free', status: 'active' });
      currentDb.store.set('tenant_private/upgraded', { adminEmails: ['a@b.c'] });
      currentDb.store.set('users/user_up', { tenantId: 'upgraded', plan: 'free' });
      const attach = await attachFirstSubscriptionToTenant({
        subscription_id: 'sub_upgrade',
        product_id: product,
        customer: { customer_id: 'cus_1' },
        metadata: { firstSubscription: 'true', tenantId: 'upgraded', userId: 'user_up' },
      } as never);
      expect(attach.outcome).toBe('attached');
      const fromUpgrade = currentDb.store.get('tenant_private/upgraded')?.dodoProductId;

      // The original signup path. The paying user exists in Auth and in
      // Firestore, exactly as they do at a real signup.
      currentDb = makeDb();
      currentDb.store.set('users/user_new', { plan: 'free' });
      mockGetUser.mockResolvedValue({ email: 'new@church.example' });
      await provisionTenantFromDodoSubscription({
        subscription_id: 'sub_signup',
        product_id: product,
        customer: { customer_id: 'cus_2', email: 'new@church.example' },
        metadata: { newTenant: 'true', userId: 'user_new', ministryName: 'New Church' },
      } as never);
      const signupPrivate = [...currentDb.store.entries()]
        .find(([k]) => k.startsWith('tenant_private/'))?.[1];
      const fromSignup = signupPrivate?.dodoProductId;

      // The same id, and therefore the same term through the same resolver.
      expect(fromUpgrade).toBe(product);
      expect(fromSignup).toBe(product);
      expect(resolvePlanFromProductId(fromUpgrade as string)?.period).toBe(term);
      expect(resolvePlanFromProductId(fromSignup as string)?.period).toBe(term);
    });
  }
});

// ── Test 6: the guards that must keep refusing ───────────────────────────────

describe('the ownership and failed-renewal guards still refuse', () => {
  it('refuses a member who is not an owner or admin (requireOwner)', async () => {
    seedIndividualOn(P.individualMonthly);
    mockVerifyIdToken.mockResolvedValue({
      uid: 'member_9', email: 'm@final.example', tenantId: T.tenant, admin: false, auth_time: 1,
    });
    currentDb.store.set('users/member_9', { tenantId: T.tenant, role: 'member', plan: 'plus' });

    const res = await post(dodoChangePlan, { tenantId: T.tenant, plan: 'pro', billing: 'monthly' });
    expect(res.status).toBe(403);
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses the same member on the new GET, which must not be a way around requireOwner', async () => {
    seedIndividualOn(P.individualMonthly);
    mockVerifyIdToken.mockResolvedValue({
      uid: 'member_9', email: 'm@final.example', tenantId: T.tenant, admin: false, auth_time: 1,
    });
    currentDb.store.set('users/member_9', { tenantId: T.tenant, role: 'member', plan: 'plus' });

    const res = await get(dodoCurrentTerm, T.tenant);
    expect(res.status).toBe(403);
  });

  it('refuses a tenant whose renewal failed, in THE-128’s own words', async () => {
    seedIndividualOn(P.individualMonthly);
    currentDb.store.set(`tenant_private/${T.tenant}`, {
      ...currentDb.store.get(`tenant_private/${T.tenant}`),
      dodoOnHoldAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    asOwner();

    const res = await post(dodoChangePlan, { tenantId: T.tenant, plan: 'pro', billing: 'monthly' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('plan-change-unavailable-payment-failed');
    expect(body.error).toContain('did not go through');
    expect(dodoStub.changePlan).not.toHaveBeenCalled();
  });

  it('refuses a Stripe-owned tenant on both the POST and the GET', async () => {
    currentDb.store.set(`tenants/${T.tenant}`, {
      name: 'Final Test', plan: 'plus', status: 'active', ownerId: 'owner_1',
    });
    currentDb.store.set(`tenant_private/${T.tenant}`, {
      stripeCustomerId: 'cus_stripe_1',
      stripeSubscriptionId: 'sub_stripe_1',
      adminEmails: ['pastor@final.example'],
    });
    currentDb.store.set('users/owner_1', { tenantId: T.tenant, role: 'admin', plan: 'plus' });
    asOwner();

    expect((await post(dodoChangePlan, { tenantId: T.tenant, plan: 'pro', billing: 'monthly' })).status).toBe(409);
    expect((await get(dodoCurrentTerm, T.tenant)).status).toBe(409);
  });
});

// ── Test 7: the double-charge guard ──────────────────────────────────────────

describe('the checkout route still refuses when tenantId is set', () => {
  it('refuses a signup checkout carrying a tenantId — the second-subscription guard', async () => {
    asOwner();
    const res = await post(dodoCheckout, {
      plan: 'pro', billing: 'monthly', tenantId: T.tenant, email: 'pastor@final.example',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('creates new ministries only');
  });
});

// ── Test 8: nothing about money moved ────────────────────────────────────────

describe('no price or product id changed', () => {
  const repoFile = (rel: string) => readFileSync(resolve(join(process.cwd(), 'src', rel)), 'utf8');

  it('pins the nine live product ids character-for-character', () => {
    const catalogue = repoFile('lib/dodo/catalogue.ts');
    for (const id of [
      'pdt_0NlJZKKU2AQSSH7E4ziKA', 'pdt_0NloCamoWgvgYDih2UETS', 'pdt_0NlJZMLLKZ5SVGEoSGDdk',
      'pdt_0NlJZMOMhmZWiG6UVDl8I', 'pdt_0NloCaqg1QPMAlkfDnlOe', 'pdt_0NlJZMRWL8tuAZseUIRTP',
      'pdt_0NlJZMUUiT36FGMoiFXgl', 'pdt_0NloCatUWEkEUq1usWJ0n', 'pdt_0NlJZMXTnpRBAwTfBVpPs',
    ]) {
      expect(catalogue, id).toContain(id);
    }
  });

  it('pins the nine prices, by tier and term', async () => {
    const { PLAN_PRICING } = await import('@/utils/plan-features');
    expect(PLAN_PRICING.plus).toMatchObject({ monthly: 20, quarterly: 49, yearly: 165 });
    expect(PLAN_PRICING.pro).toMatchObject({ monthly: 40, quarterly: 99, yearly: 329 });
    expect(PLAN_PRICING.max).toMatchObject({ monthly: 80, quarterly: 199, yearly: 659 });
  });

  it('leaves every resolver mapping intact', () => {
    expect(resolvePlanFromProductId(P.individualMonthly)).toEqual({ plan: 'plus', period: 'monthly' });
    expect(resolvePlanFromProductId(P.individualQuarterly)).toEqual({ plan: 'plus', period: 'quarterly' });
    expect(resolvePlanFromProductId(P.individualYearly)).toEqual({ plan: 'plus', period: 'yearly' });
    expect(resolvePlanFromProductId(P.smallTeamMonthly)).toEqual({ plan: 'pro', period: 'monthly' });
    expect(resolvePlanFromProductId(P.smallTeamQuarterly)).toEqual({ plan: 'pro', period: 'quarterly' });
    expect(resolvePlanFromProductId(P.smallTeamYearly)).toEqual({ plan: 'pro', period: 'yearly' });
  });
});
