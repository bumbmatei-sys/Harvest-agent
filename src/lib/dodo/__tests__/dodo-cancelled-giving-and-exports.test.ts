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
  adminDb: { collection: (name: string) => collRef(name) },
  adminAuth: { getUser: vi.fn(), getUserByEmail: vi.fn() },
  getReceiptsBucket: () => ({
    file: () => ({ save: mockFileSave, getSignedUrl: mockSignedUrl }),
  }),
}));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mockGetTenantPrivate }));
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
const { TENANT_STATUS_ARCHIVED, GIVING_UNAVAILABLE_MESSAGE } = await import('@/lib/tenant-lifecycle');

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
