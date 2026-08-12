import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * REP-4 PR 3 (part 2 of 2): the two halves of the decision that are about MONEY
 * and about a church's own records, exercised through the REAL routes.
 *
 * 🔴 GIVING STOPS, SERVER-SIDE. At a 0% platform fee a live donate page is the
 * most valuable surface in the product, so an archived church left with one is
 * the product given away for free indefinitely. It is also a single route, which
 * is why this is the one thing not left to a hidden button.
 *
 * 🔴 EXPORTS NEVER STOP. A church has a legal need for its own giving records,
 * and withholding a donor CSV or a year-end statement behind a paywall is
 * indefensible. Both the donor export and the giving export are run here against
 * a tenant whose subscription has ended, and both must succeed.
 *
 * ⚠️ And a Stripe-owned tenant is unaffected by either: the Stripe webhook's own
 * terminal state ('cancelled') is deliberately ungated, so nothing about a
 * Stripe church's donate page changes in this PR. See the PR body.
 */

const SRC = resolve(__dirname, '../../..');

// ── A fake Firestore with subcollections, ordering and a receipts bucket ─────

const { store, mockCheckoutCreate, mockVerifyAuth, mockGetTenantPrivate, mockSignedUrl, mockFileSave } =
  vi.hoisted(() => ({
    store: new Map<string, Record<string, any>>(),
    mockCheckoutCreate: vi.fn(),
    mockVerifyAuth: vi.fn(),
    mockGetTenantPrivate: vi.fn(),
    mockSignedUrl: vi.fn(),
    mockFileSave: vi.fn().mockResolvedValue(undefined),
  }));

function docRef(path: string): any {
  return {
    // Carried so `batch()` below can resolve a ref back to its document.
    __path: path,
    async get() {
      const data = store.get(path);
      return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
    },
    async set(data: Record<string, any>, options?: { merge?: boolean }) {
      const existing = options?.merge ? store.get(path) : undefined;
      store.set(path, { ...(existing || {}), ...data });
    },
    async update(patch: Record<string, any>) {
      store.set(path, { ...(store.get(path) || {}), ...patch });
    },
    collection: (name: string) => collRef(`${path}/${name}`),
  };
}

/**
 * A batch, added so the grace-window CONVERGENCE runs for real in this file.
 *
 * ⚠️ Convergence is what makes the recorded state agree with the enforced one,
 * and it happens on the donate route. Stubbing it out here would leave the one
 * place it actually fires untested.
 */
function batch(): any {
  const writes: Array<() => void> = [];
  return {
    set(ref: any, data: Record<string, any>, options?: { merge?: boolean }) {
      writes.push(() => {
        const existing = options?.merge ? store.get(ref.__path) : undefined;
        store.set(ref.__path, { ...(existing || {}), ...data });
      });
    },
    update(ref: any, patch: Record<string, any>) {
      writes.push(() => store.set(ref.__path, { ...(store.get(ref.__path) || {}), ...patch }));
    },
    async commit() { for (const write of writes) write(); },
  };
}

function collRef(prefix: string): any {
  const api: any = {
    doc: (id: string) => docRef(`${prefix}/${id}`),
    where: () => api,
    orderBy: () => api,
    limit: () => api,
    add: vi.fn(async () => ({ id: 'generated' })),
    async get() {
      const docs = [...store.entries()]
        .filter(([k]) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes('/'))
        .map(([k, data]) => ({ id: k.slice(prefix.length + 1), data: () => ({ ...data }) }));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  };
  return api;
}

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockCheckoutCreate } };
  },
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => collRef(name), batch: () => batch() },
  adminAuth: { getUser: vi.fn(), getUserByEmail: vi.fn() },
  getReceiptsBucket: () => ({
    file: () => ({ save: mockFileSave, getSignedUrl: mockSignedUrl }),
  }),
}));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: mockGetTenantPrivate,
  DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
  // Needed by the convergence path, which writes the archived state through the
  // same guarded batch the terminal events use.
  TENANT_PRIVATE_COLLECTION: 'tenant_private',
  tenantPrivateRef: (id: string) => docRef(`tenant_private/${id}`),
}));
vi.mock('@/lib/api-auth', () => ({
  verifyAuth: mockVerifyAuth,
  requireAuth: async () => mockVerifyAuth(),
  requireAdmin: async () => mockVerifyAuth(),
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: vi.fn(),
  captureHandledError: vi.fn(),
}));
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn() } })) }));

const { POST: donatePOST } = await import('@/app/api/stripe/donate/route');
const { POST: donorReceiptPOST } = await import('@/app/api/donation-history/download/route');
const { POST: givingStatementPOST } = await import('@/app/api/giving-statements/generate/route');
const {
  TENANT_STATUS_ARCHIVED,
  GIVING_UNAVAILABLE_MESSAGE,
  DODO_GRACE_PERIOD_DAYS,
} = await import('@/lib/tenant-lifecycle');

// ── Grace-window fixtures ────────────────────────────────────────────────────
//
// ⚠️ The donate route reads its own `Date.now()`, so these are anchored to the
// real clock rather than to a fixed instant — and expressed in terms of
// DODO_GRACE_PERIOD_DAYS, never the literal 21. No fake timers are involved:
// moving the HOLD backwards past the deadline is the same arithmetic as moving
// `now` forwards, and it leaves the route reading a clock it actually trusts.

const DAY_MS = 24 * 60 * 60 * 1000;
/** A hold that started `days` ago. */
const heldDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
/** Comfortably inside the window. */
const HELD_INSIDE_WINDOW = () => heldDaysAgo(DODO_GRACE_PERIOD_DAYS - 1);
/** Past it. */
const HELD_PAST_WINDOW = () => heldDaysAgo(DODO_GRACE_PERIOD_DAYS + 1);

/**
 * The private doc of a Dodo church, optionally on hold.
 *
 * `billingProcessor` and `dodoSubscriptionId` are what make the convergence
 * path's ownership check resolve to Dodo — without them it refuses, which is
 * the behaviour the conflict-owned tests rely on.
 */
function dodoPrivate(onHoldAt?: string) {
  return {
    stripeConnectAccountId: 'acct_T',
    dodoCustomerId: 'cus_dodo_1',
    dodoSubscriptionId: 'sub_dodo_1',
    billingProcessor: 'dodo',
    ...(onHoldAt ? { dodoOnHoldAt: onHoldAt } : {}),
  };
}

/** The archived Dodo church every test below acts on. */
const ARCHIVED_TENANT = 'gracechurch';

function seedTenant(status: string, id = ARCHIVED_TENANT) {
  store.set(`tenants/${id}`, {
    name: 'Grace Church',
    subdomain: id,
    plan: 'max',
    status,
    config: {},
  });
}

/** One donation receipt, the row both exports are built from. */
function seedDonationReceipt(tenantId = ARCHIVED_TENANT) {
  store.set(`tenants/${tenantId}/invoices/inv_1`, {
    type: 'donation_receipt',
    recipientEmail: 'donor@example.com',
    recipientName: 'A Donor',
    amount: 25_000,
    description: 'Tithe',
    issuedAt: '2026-03-04T00:00:00.000Z',
    pdfUrl: `receipts/${tenantId}/inv_1.pdf`,
  });
}

const donateRequest = (body: Record<string, unknown>) =>
  new NextRequest('https://example.com/api/stripe/donate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const jsonRequest = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'theharvest.app';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  delete process.env.RESEND_API_KEY;
  mockVerifyAuth.mockResolvedValue(null);
  mockGetTenantPrivate.mockResolvedValue({ stripeConnectAccountId: 'acct_T' });
  mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' });
  mockSignedUrl.mockResolvedValue(['https://signed.example/receipt.pdf']);
});

// ─── Test 4 — giving is refused SERVER-SIDE for a cancelled tenant ───────────

describe('giving is refused server-side for a cancelled tenant', () => {
  it('refuses a one-time donation to an archived tenant', async () => {
    seedTenant(TENANT_STATUS_ARCHIVED);

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: GIVING_UNAVAILABLE_MESSAGE });
    // 🔴 No Stripe Checkout session was created at all. A refusal that still
    // opened a session would take the donor's card and then strand the money.
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('refuses a MONTHLY donation too — one gate, before either branch', async () => {
    seedTenant(TENANT_STATUS_ARCHIVED);

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'monthly' }));

    expect(res.status).toBe(403);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('refuses even when the church still has a live Connect account', async () => {
    // The money could physically move — the account is connected and fine. What
    // stopped it is the lifecycle state, which is the point.
    seedTenant(TENANT_STATUS_ARCHIVED);
    mockGetTenantPrivate.mockResolvedValue({ stripeConnectAccountId: 'acct_LIVE' });

    const res = await donatePOST(donateRequest({ amount: 100_000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(403);
  });

  it('tells the DONOR nothing about the church’s billing', async () => {
    seedTenant(TENANT_STATUS_ARCHIVED);
    const body = await (await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }))).json();
    for (const leak of ['subscription', 'cancel', 'billing', 'plan', 'archiv', 'expired']) {
      expect(String(body.error).toLowerCase()).not.toContain(leak);
    }
  });

  it('still accepts a donation to an ACTIVE tenant — the gate is not a blanket', async () => {
    seedTenant('active');

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(200);
    expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
    // And it is still a 0% destination charge into the church's own account.
    expect(mockCheckoutCreate.mock.calls[0][0].payment_intent_data.application_fee_amount).toBe(0);
  });

  it('does not touch stripe-connect.ts to do it', () => {
    // 🔴 STOP CONDITION. Donations are Stripe Connect destination charges at 0%
    // and that module stays exactly as it is. The gate went on the ROUTE.
    const connect = readFileSync(join(SRC, 'lib/stripe-connect.ts'), 'utf8');
    expect(connect).not.toContain('tenant-lifecycle');
    expect(connect).not.toContain('archived');
    expect(connect).not.toContain('import');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REP-4 part 3 — the grace window, enforced on the one server-side money gate
// ═══════════════════════════════════════════════════════════════════════════

// ─── Test 5 — giving still works during the grace window ─────────────────────

describe('giving still works during the grace window', () => {
  it('still works during the grace window', async () => {
    // 🔴 THE HALF THAT PROTECTS THE CUSTOMER. A failed renewal is usually an
    // expired card, not a decision to leave. Taking the donate page down on the
    // day the card failed would cost a church its offering while they were still
    // trying to pay.
    seedTenant('active');
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_INSIDE_WINDOW()));

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(200);
    expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
    // And still at 0% into the church's own connected account — nothing degraded.
    expect(mockCheckoutCreate.mock.calls[0][0].payment_intent_data.application_fee_amount).toBe(0);
  });

  it('still works on the FIRST day of the hold', async () => {
    seedTenant('active');
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(heldDaysAgo(0)));

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(200);
  });

  it('takes a MONTHLY gift during the window too', async () => {
    seedTenant('active');
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_INSIDE_WINDOW()));

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'monthly' }));

    expect(res.status).toBe(200);
  });

  it('does not archive the tenant while it is inside the window', async () => {
    // Convergence must not fire early: the recorded state is still correct.
    seedTenant('active');
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_INSIDE_WINDOW()));

    await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(store.get(`tenants/${ARCHIVED_TENANT}`)!.status).toBe('active');
  });
});

// ─── Test 4 — giving is refused once the grace window has passed ─────────────

describe('giving is refused once the grace window has passed', () => {
  it('is refused once the grace window has passed', async () => {
    // 🔴 THE WHOLE POINT OF THE PR. Dodo emits NO terminal event for a
    // subscription that stays on hold, so this tenant is still recorded
    // `active` — and at a 0% platform fee a live donate page is the product
    // given away free, indefinitely, unless something ends it.
    seedTenant('active');
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: GIVING_UNAVAILABLE_MESSAGE });
    // No Checkout session was opened at all — a refusal that still took the
    // donor's card would strand the money.
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('refuses a MONTHLY gift too — one gate, before either branch', async () => {
    seedTenant('active');
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'monthly' }));

    expect(res.status).toBe(403);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('tells the DONOR nothing about the church’s billing', async () => {
    // The reader is a donor who came to give money to their church. A church's
    // subscription trouble is not theirs to be told.
    seedTenant('active');
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));

    const body = await (await donatePOST(
      donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }),
    )).json();

    for (const leak of ['subscription', 'cancel', 'billing', 'plan', 'archiv', 'expired', 'grace', 'hold', 'card']) {
      expect(String(body.error).toLowerCase()).not.toContain(leak);
    }
  });

  it('refuses even though the church still has a live Connect account', async () => {
    // The money could physically move. What stopped it is the deadline.
    seedTenant('active');
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue({ ...dodoPrivate(HELD_PAST_WINDOW()), stripeConnectAccountId: 'acct_LIVE' });

    const res = await donatePOST(donateRequest({ amount: 100_000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(403);
  });

  it('CONVERGES the recorded state so the tenant is not left active-but-refused', async () => {
    // 🔴 Dodo will never send a terminal event and this repo has no scheduled
    // job, so the first request that consults the deadline is the only reactive
    // trigger there is. Without this the document would say `active` forever
    // while every surface refused.
    seedTenant('active');
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));

    await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(store.get(`tenants/${ARCHIVED_TENANT}`)!.status).toBe(TENANT_STATUS_ARCHIVED);
    expect(store.get(`tenant_private/${ARCHIVED_TENANT}`)!.dodoSubscriptionStatus).toBe('grace-expired');
  });

  it('leaves `plan` alone while converging', async () => {
    seedTenant('active');
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));

    await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(store.get(`tenants/${ARCHIVED_TENANT}`)!.plan).toBe('max');
  });

  it('still refuses when the convergence write fails', async () => {
    // ⚠️ ENFORCEMENT NEVER WAITS ON BOOKKEEPING. The refusal is derived from the
    // deadline, so a failed archive write cannot hand the donate page back.
    seedTenant('active');
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));
    // No `tenant_private` doc seeded, so the convergence lookup finds no tenant.

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(403);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('refuses on every subsequent request, not just the one that converged', async () => {
    seedTenant('active');
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));

    for (let i = 0; i < 3; i++) {
      const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));
      expect(res.status).toBe(403);
    }
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('does not gate a tenant whose subscription Dodo does not own', async () => {
    // 🔴 A conflict-owned tenant (identifiers from BOTH processors) must not be
    // archived by a Dodo timer. The gate still refuses — the deadline is on the
    // document — but the convergence write is refused by ownership.
    seedTenant('active');
    const conflicted = { ...dodoPrivate(HELD_PAST_WINDOW()), stripeSubscriptionId: 'sub_stripe_1', stripeCustomerId: 'cus_stripe_1' };
    store.set(`tenant_private/${ARCHIVED_TENANT}`, conflicted);
    mockGetTenantPrivate.mockResolvedValue(conflicted);

    await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(store.get(`tenants/${ARCHIVED_TENANT}`)!.status).toBe('active');
  });
});

// ─── Test 6 — every export still works past the grace window ─────────────────

describe('every export still works for a tenant whose grace window has passed', () => {
  /** A church whose window closed AND whose state has already converged. */
  function seedGraceExpiredChurch() {
    seedTenant(TENANT_STATUS_ARCHIVED);
    seedDonationReceipt();
    store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(HELD_PAST_WINDOW()));
    mockGetTenantPrivate.mockResolvedValue(dodoPrivate(HELD_PAST_WINDOW()));
  }

  it('the DONOR export still returns a receipt', async () => {
    // 🔴 STOP CONDITION, and the most important test here. This is a donor
    // asking for their own charitable-contribution receipt from a church whose
    // card failed. `export` is on NEVER_GATED and no deadline may reach it.
    seedGraceExpiredChurch();
    mockVerifyAuth.mockResolvedValue({ uid: 'donor_1', email: 'donor@example.com' });

    const res = await donorReceiptPOST(
      jsonRequest('https://example.com/api/donation-history/download', {
        tenantId: ARCHIVED_TENANT,
        invoiceId: 'inv_1',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://signed.example/receipt.pdf' });
  });

  it('the GIVING export still generates year-end statements', async () => {
    seedGraceExpiredChurch();
    mockVerifyAuth.mockResolvedValue({ uid: 'admin_1', email: 'pastor@gracechurch.org', isAdmin: true, tenantId: ARCHIVED_TENANT });

    const res = await givingStatementPOST(
      jsonRequest('https://example.com/api/giving-statements/generate', { year: 2026, send: false }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ generated: 1, totalDonors: 1, failed: 0 });
    expect(mockFileSave).toHaveBeenCalledTimes(1);
  });

  it('produces the SAME export result past the window as inside it', async () => {
    // The strongest form: byte-for-byte the same answer, so nothing degraded
    // quietly rather than being refused outright.
    const run = async (onHoldAt: string, status: string) => {
      store.clear();
      seedTenant(status);
      seedDonationReceipt();
      store.set(`tenant_private/${ARCHIVED_TENANT}`, dodoPrivate(onHoldAt));
      mockGetTenantPrivate.mockResolvedValue(dodoPrivate(onHoldAt));
      mockVerifyAuth.mockResolvedValue({ uid: 'admin_1', email: 'pastor@gracechurch.org', isAdmin: true, tenantId: ARCHIVED_TENANT });
      return (await givingStatementPOST(
        jsonRequest('https://example.com/api/giving-statements/generate', { year: 2026, send: false }),
      )).json();
    };

    expect(await run(HELD_PAST_WINDOW(), TENANT_STATUS_ARCHIVED)).toEqual(await run(HELD_INSIDE_WINDOW(), 'active'));
  });

  it('keeps admin READ working for a church past its window', async () => {
    // Login and admin read are never gated either — the church can still get in
    // to fix the card that caused all this.
    const { GET: rosterStatusGET } = await import('@/app/api/tenants/roster-status/route');
    seedGraceExpiredChurch();
    mockGetTenantPrivate.mockResolvedValue({ ...dodoPrivate(HELD_PAST_WINDOW()), adminEmails: ['pastor@gracechurch.org'] });
    mockVerifyAuth.mockResolvedValue({ uid: 'admin_1', email: 'pastor@gracechurch.org', isAdmin: true, tenantId: ARCHIVED_TENANT });

    const res = await rosterStatusGET(
      new NextRequest(`https://example.com/api/tenants/roster-status?tenantId=${ARCHIVED_TENANT}`),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isRosterAdmin: true });
  });
});

// ─── Test 9 (money half) — a Stripe-owned tenant is unaffected ───────────────

describe('a Stripe-owned tenant keeps its donate page', () => {
  it.each(['active', 'cancelled', 'past_due', 'suspended', 'pending'])(
    'accepts a donation to a tenant in the %s state',
    async (status) => {
      // ⚠️ 'cancelled' is what the STRIPE webhook writes on
      // customer.subscription.deleted. It stays ungated here on purpose: gating
      // it would change every existing Stripe church's behaviour, which is a
      // second PR. Reported in the PR body, not done here.
      seedTenant(status);

      const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

      expect(res.status).toBe(200);
      expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts a donation to a tenant with no status field at all', async () => {
    // Legacy documents predate the field. Fail OPEN: a live church's donate page
    // going dark on a deploy is not comparable to an archived one staying up.
    store.set(`tenants/${ARCHIVED_TENANT}`, { name: 'Legacy Church', subdomain: ARCHIVED_TENANT, plan: 'plus', config: {} });

    const res = await donatePOST(donateRequest({ amount: 5000, tenantId: ARCHIVED_TENANT, donationType: 'one-time' }));

    expect(res.status).toBe(200);
  });
});

// ─── Test 3 — EVERY export still works for a cancelled tenant ────────────────

describe('every export still works for a cancelled tenant', () => {
  it('the DONOR export still returns a receipt for an archived tenant', async () => {
    // 🔴 THE MOST IMPORTANT TEST HERE. This is a donor asking for their own
    // charitable-contribution receipt from a church whose subscription ended.
    seedTenant(TENANT_STATUS_ARCHIVED);
    seedDonationReceipt();
    mockVerifyAuth.mockResolvedValue({ uid: 'donor_1', email: 'donor@example.com' });

    const res = await donorReceiptPOST(
      jsonRequest('https://example.com/api/donation-history/download', {
        tenantId: ARCHIVED_TENANT,
        invoiceId: 'inv_1',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://signed.example/receipt.pdf' });
  });

  it('the GIVING export still generates year-end statements for an archived tenant', async () => {
    seedTenant(TENANT_STATUS_ARCHIVED);
    seedDonationReceipt();
    mockVerifyAuth.mockResolvedValue({ uid: 'admin_1', email: 'pastor@gracechurch.org', isAdmin: true, tenantId: ARCHIVED_TENANT });

    const res = await givingStatementPOST(
      jsonRequest('https://example.com/api/giving-statements/generate', { year: 2026, send: false }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ generated: 1, totalDonors: 1, failed: 0 });
    // A real PDF was written, not a stubbed-out early return.
    expect(mockFileSave).toHaveBeenCalledTimes(1);
  });

  it('produces the SAME export result archived as it does active', async () => {
    // The strongest form: byte-for-byte the same answer, so nothing degraded
    // quietly rather than being refused outright.
    const run = async (status: string) => {
      store.clear();
      seedTenant(status);
      seedDonationReceipt();
      mockVerifyAuth.mockResolvedValue({ uid: 'admin_1', email: 'pastor@gracechurch.org', isAdmin: true, tenantId: ARCHIVED_TENANT });
      return (await givingStatementPOST(
        jsonRequest('https://example.com/api/giving-statements/generate', { year: 2026, send: false }),
      )).json();
    };

    expect(await run(TENANT_STATUS_ARCHIVED)).toEqual(await run('active'));
  });

  it('never consults the lifecycle gate from an export route', () => {
    // 🔴 STOP CONDITION: a lifecycle state must never gate an export. The
    // structural version — these routes do not import the gate at all, so they
    // cannot start gating on it by accident.
    for (const route of [
      'app/api/donation-history/download/route.ts',
      'app/api/giving-statements/generate/route.ts',
      'app/api/giving-statements/config/route.ts',
      'app/api/billing/statement/route.ts',
      'app/api/donation-history/route.ts',
    ]) {
      const source = readFileSync(join(SRC, route), 'utf8');
      expect(source, route).not.toContain('tenant-lifecycle');
      expect(source, route).not.toContain('useTenantCapability');
    }
  });

  it('leaves the client-side CSV exporters ungated too', () => {
    for (const file of [
      'components/AnalyticsAndRoles.tsx',
      'components/AdminEvents.tsx',
      'components/AdminCheckin.tsx',
      'components/AdminForms.tsx',
    ]) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toContain('useTenantCapability');
    }
  });
});

// ─── Test 2 (route half) — an admin of a cancelled tenant can read ───────────

describe('an admin of a cancelled tenant can still log in and read', () => {
  it('answers "yes" to the roster check the admin area actually performs', async () => {
    // `/api/tenants/roster-status` is what OnboardingGate, AdminDashboard and
    // the news surfaces ask on load. It has no idea a lifecycle state exists.
    const { GET: rosterStatusGET } = await import('@/app/api/tenants/roster-status/route');
    seedTenant(TENANT_STATUS_ARCHIVED);
    mockGetTenantPrivate.mockResolvedValue({ adminEmails: ['pastor@gracechurch.org'] });
    mockVerifyAuth.mockResolvedValue({ uid: 'admin_1', email: 'pastor@gracechurch.org', isAdmin: true, tenantId: ARCHIVED_TENANT });

    const res = await rosterStatusGET(
      new NextRequest(`https://example.com/api/tenants/roster-status?tenantId=${ARCHIVED_TENANT}`),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isRosterAdmin: true });
  });
});
