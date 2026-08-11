import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-80 — who may change what a church pays.
 *
 * 🔴 The bug these tests exist for: several billing WRITE routes gated on
 * `requireAuth` — authenticated, nothing more — plus a tenant-match. A member is
 * anyone who signed up through the church's public subdomain, which is the
 * congregation. So any member could move their church from $49 to $199, change
 * its billed seat count, or add a per-church line. Meanwhile `/api/billing/
 * invoices` and `/statement` were already `requireOwner`, so READING an invoice
 * was harder than RAISING the bill — exactly backwards.
 *
 * ⚠️ THIS SUITE DELIBERATELY DOES NOT MOCK `@/lib/api-auth`. Every other billing
 * suite stubs the gate because it is testing something else; this one is testing
 * the gate itself, so it drives the REAL helpers and mocks only Firebase beneath
 * them. That is what makes test 3 — the roster admin — mean anything: a mocked
 * helper cannot fail to read a roster it never touches.
 */

// ── Stripe: one surface for every route under test ──────────────────────────
const {
  mockSessionsCreate,
  mockCustomersRetrieve,
  mockCustomersCreate,
  mockCustomersList,
  mockPortalCreate,
  mockSubRetrieve,
  mockSubItemUpdate,
  mockSubItemCreate,
  mockSubItemDel,
  mockInvoicesList,
} = vi.hoisted(() => ({
  mockSessionsCreate: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockCustomersCreate: vi.fn(),
  mockCustomersList: vi.fn(),
  mockPortalCreate: vi.fn(),
  mockSubRetrieve: vi.fn(),
  mockSubItemUpdate: vi.fn(),
  mockSubItemCreate: vi.fn(),
  mockSubItemDel: vi.fn(),
  mockInvoicesList: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockSessionsCreate } };
    customers = { retrieve: mockCustomersRetrieve, create: mockCustomersCreate, list: mockCustomersList };
    billingPortal = { sessions: { create: mockPortalCreate } };
    subscriptions = { retrieve: mockSubRetrieve };
    subscriptionItems = { update: mockSubItemUpdate, create: mockSubItemCreate, del: mockSubItemDel };
    invoices = { list: mockInvoicesList };
  },
}));

// ── Firebase, beneath the real auth helpers ─────────────────────────────────
const { mockVerifyIdToken, firestore, churchQuery } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  /** `${collection}/${id}` → document data. Absent key = document missing. */
  firestore: new Map<string, any>(),
  churchQuery: { docs: [] as any[] },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = firestore.get(`${name}/${id}`);
          return { exists: data !== undefined, id, data: () => data };
        },
        set: async () => undefined,
        update: async () => undefined,
      }),
      where() { return this; },
      limit() { return this; },
      get: async () => ({
        size: churchQuery.docs.length,
        empty: churchQuery.docs.length === 0,
        docs: churchQuery.docs,
      }),
    }),
  },
}));

// 🔴 The roster lives here. `isOnTenantRoster` and `resolveBillingOwnership`
// both read it, so one fixture per tenant drives both.
const { tenantPrivate } = vi.hoisted(() => ({ tenantPrivate: new Map<string, any>() }));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: async (id: string) => tenantPrivate.get(id) ?? {},
  tenantPrivateRef: () => ({ set: async () => undefined }),
  TENANT_PRIVATE_COLLECTION: 'tenant_private',
}));

vi.mock('@/lib/dodo/dodo-provider', () => ({
  dodoBillingProvider: { id: 'dodo', createCustomerPortal: vi.fn() },
}));

vi.mock('@/lib/billing', () => ({
  PLAN_PRICES: {
    plus: { monthly: 'price_plus_m', yearly: 'price_plus_y' },
    pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
    max: { monthly: 'price_max_m', yearly: 'price_max_y' },
    ultra: { monthly: 'price_ultra_m', yearly: 'price_ultra_y' },
  },
  AI_ASSISTANT_MONTHLY: 'price_ai_m',
}));

vi.mock('@/lib/stripe-connect', () => ({ PLATFORM_FEE_MAP: { plus: 0, pro: 0, max: 0, ultra: 0 } }));

const { POST: checkout } = await import('@/app/api/stripe/checkout/route');
const { POST: portal } = await import('@/app/api/stripe/portal/route');
const { POST: updateQuantity } = await import('@/app/api/stripe/update-quantity/route');
const { POST: addChurchBillingLegacy } = await import('@/app/api/stripe/add-church-billing/route');
const { POST: addBilling } = await import('@/app/api/churches/add-billing/route');
const { POST: removeBilling } = await import('@/app/api/churches/remove-billing/route');
const { GET: invoices } = await import('@/app/api/billing/invoices/route');
const { POST: statement } = await import('@/app/api/billing/statement/route');
const { POST: donate } = await import('@/app/api/stripe/donate/route');

// ── Personas ────────────────────────────────────────────────────────────────
//
// The token carries only what Firebase would carry. Anything the token does NOT
// say (a role, a roster entry) has to be found by the helper in Firestore — which
// is the whole point of the roster case.

interface Persona {
  /** Bearer token value; also the uid. */
  uid: string;
  email: string;
  decoded: Record<string, unknown>;
  /** users/{uid} document, or null for no user doc at all. */
  userDoc: Record<string, unknown> | null;
}

/** An ordinary member of Grace Chapel — signed up through the public subdomain. */
const MEMBER: Persona = {
  uid: 'member1',
  email: 'member@grace.org',
  decoded: { uid: 'member1', email: 'member@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'user' },
};

/** The buyer: tenants/grace.ownerId. */
const OWNER: Persona = {
  uid: 'owner1',
  email: 'owner@grace.org',
  decoded: { uid: 'owner1', email: 'owner@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin' },
};

/**
 * 🔴 THE THE-64 PERSONA. A real, legitimate admin of Grace Chapel whose
 * entitlement exists ONLY as an entry in `tenant_private.adminEmails`:
 *
 *   - `role: 'user'` on their user doc, so `verifyAuth` reports isAdmin FALSE
 *   - no `admin` claim on their token
 *   - not `tenants/grace.ownerId`
 *
 * firestore.rules admits them (`inTenantAdminEmails`). Any helper that reads
 * only the user document refuses them — which is the production lockout THE-64
 * cost, landing this time on the one screen they cannot afford to lose.
 */
const ROSTER_ADMIN: Persona = {
  uid: 'roster1',
  email: 'Roster@Grace.org', // mixed case on purpose: the match must normalise
  decoded: { uid: 'roster1', email: 'Roster@Grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'user' },
};

/** A volunteer with the admin role — Ministry allows 15 of these. Not the owner. */
const VOLUNTEER_ADMIN: Persona = {
  uid: 'volunteer1',
  email: 'volunteer@grace.org',
  decoded: { uid: 'volunteer1', email: 'volunteer@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin' },
};

/** Platform owner, operating from the apex: tenantId null. */
const SUPER_ADMIN: Persona = {
  uid: 'super1',
  email: 'bumbmatei@proton.me', // a real entry in SUPER_ADMIN_EMAILS
  decoded: { uid: 'super1', email: 'bumbmatei@proton.me', auth_time: 1700000000 },
  userDoc: null,
};

/** Owner of a DIFFERENT tenant. */
const OTHER_TENANT_OWNER: Persona = {
  uid: 'owner2',
  email: 'owner@hope.org',
  decoded: { uid: 'owner2', email: 'owner@hope.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'hope', role: 'admin' },
};

const ALL_PERSONAS = [MEMBER, OWNER, ROSTER_ADMIN, VOLUNTEER_ADMIN, SUPER_ADMIN, OTHER_TENANT_OWNER];

function request(path: string, body: object | null, as: Persona | null, method = 'POST'): NextRequest {
  return new NextRequest(`https://example.com/api/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'https://theharvest.app',
      ...(as ? { authorization: `Bearer ${as.uid}` } : {}),
    },
    ...(method === 'GET' || body === null ? {} : { body: JSON.stringify(body) }),
  });
}

// ── The routes, and how to call each one for tenant `grace` ─────────────────

interface BillingRoute {
  name: string;
  /** The gate this route is expected to enforce after THE-80. */
  tier: 'owner' | 'admin';
  call: (as: Persona | null, tenantId?: string) => Promise<Response>;
}

/** Every WRITE path from THE-79's enumeration that acts on a tenant's billing. */
const WRITE_ROUTES: BillingRoute[] = [
  {
    name: 'POST /api/stripe/checkout (existing-tenant plan change)',
    tier: 'owner',
    call: (as, tenantId = 'grace') =>
      checkout(request('stripe/checkout', { plan: 'max', billing: 'monthly', tenantId }, as)),
  },
  {
    name: 'POST /api/stripe/portal (manage subscription / cancel)',
    tier: 'owner',
    call: (as, tenantId = 'grace') => portal(request('stripe/portal', { tenantId }, as)),
  },
  {
    name: 'POST /api/stripe/update-quantity (billed seat count)',
    tier: 'admin',
    call: (as, tenantId = 'grace') =>
      updateQuantity(request('stripe/update-quantity', { tenantId, action: 'sync' }, as)),
  },
  {
    name: 'POST /api/churches/add-billing (per-church $10/mo)',
    tier: 'admin',
    call: (as, tenantId = 'grace') =>
      addBilling(request('churches/add-billing', { tenantId, churchId: 'c2', churchName: 'Second' }, as)),
  },
  {
    name: 'POST /api/stripe/add-church-billing (legacy twin)',
    tier: 'admin',
    call: (as, tenantId = 'grace') =>
      addChurchBillingLegacy(
        request('stripe/add-church-billing', { tenantId, churchId: 'c2', churchName: 'Second' }, as),
      ),
  },
  {
    name: 'POST /api/churches/remove-billing (per-church $10/mo)',
    tier: 'admin',
    call: (as, tenantId = 'grace') =>
      removeBilling(request('churches/remove-billing', { tenantId, churchId: 'c1' }, as)),
  },
];

/** The READ paths on the same Billing screen. Tenant comes from the token. */
const READ_ROUTES: BillingRoute[] = [
  {
    name: 'GET /api/billing/invoices',
    tier: 'owner',
    call: (as) => invoices(request('billing/invoices', null, as, 'GET')),
  },
  {
    name: 'POST /api/billing/statement',
    tier: 'owner',
    call: (as) => statement(request('billing/statement', {}, as)),
  },
];

const ALL_BILLING_ROUTES = [...WRITE_ROUTES, ...READ_ROUTES];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';

  firestore.clear();
  tenantPrivate.clear();

  for (const p of ALL_PERSONAS) {
    if (p.userDoc) firestore.set(`users/${p.uid}`, p.userDoc);
  }

  firestore.set('tenants/grace', {
    name: 'Grace Chapel', plan: 'ultra', status: 'active', ownerId: OWNER.uid,
  });
  firestore.set('tenants/hope', {
    name: 'Hope Church', plan: 'ultra', status: 'active', ownerId: OTHER_TENANT_OWNER.uid,
  });

  // Grace's roster names the roster admin and NOBODY else — not the owner, not
  // the volunteer. So a pass by the roster admin can only have come from here.
  tenantPrivate.set('grace', {
    adminEmails: ['roster@grace.org'],
    billingProcessor: 'stripe',
    stripeCustomerId: 'cus_grace',
    stripeSubscriptionId: 'sub_grace',
    stripeConnectAccountId: 'acct_grace',
  });
  tenantPrivate.set('hope', {
    adminEmails: [],
    billingProcessor: 'stripe',
    stripeCustomerId: 'cus_hope',
    stripeSubscriptionId: 'sub_hope',
  });

  // c1 is already billed (remove-billing has something to delete); c2 is not.
  firestore.set('churches/c1', { tenantId: 'grace', stripeSubscriptionItemId: 'si_existing' });
  firestore.set('churches/c2', { tenantId: 'grace' });
  churchQuery.docs = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const persona = ALL_PERSONAS.find((p) => p.uid === token);
    if (!persona) throw new Error('invalid token');
    return persona.decoded;
  });

  mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe/session' });
  mockCustomersRetrieve.mockResolvedValue({ id: 'cus_grace', deleted: false });
  mockCustomersCreate.mockResolvedValue({ id: 'cus_created' });
  mockCustomersList.mockResolvedValue({ data: [] });
  mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe/portal' });
  mockSubRetrieve.mockResolvedValue({
    items: { data: [{ id: 'si_1', quantity: 1, current_period_end: 1790000000, price: { unit_amount: 47900, currency: 'usd' } }] },
    cancel_at_period_end: false,
  });
  mockSubItemUpdate.mockResolvedValue({ id: 'si_1' });
  mockSubItemCreate.mockResolvedValue({ id: 'si_new' });
  mockSubItemDel.mockResolvedValue({ id: 'si_existing' });
  mockInvoicesList.mockResolvedValue({ data: [] });
});

/** Every Stripe call that creates, alters or cancels a charge. */
function stripeMoneyCalls() {
  return [
    ...mockSessionsCreate.mock.calls,
    ...mockPortalCreate.mock.calls,
    ...mockSubItemCreate.mock.calls,
    ...mockSubItemUpdate.mock.calls,
    ...mockSubItemDel.mock.calls,
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — THE regression test for the whole issue.
// ═══════════════════════════════════════════════════════════════════════════

describe('an ordinary member cannot change their church billing', () => {
  for (const route of WRITE_ROUTES) {
    it(`refuses an ordinary member: ${route.name}`, async () => {
      const res = await route.call(MEMBER);

      // 403, not 401: they ARE authenticated. They are simply not entitled.
      expect(res.status).toBe(403);
      // The refusal comes from the AUTH GATE, not incidentally from a plan check
      // or a missing document further down. Pinning the wording is what stops a
      // future 403-for-another-reason from silently standing in for this test.
      const body = await res.json();
      expect(body.error, route.name).toBe(
        route.tier === 'owner' ? 'Owner access required' : 'Tenant admin access required',
      );
      // 🔴 And nothing reached Stripe — the refusal is before the money, not a
      // rollback after it.
      expect(stripeMoneyCalls()).toHaveLength(0);
    });
  }

  it('refuses an ordinary member on the READ paths too — the gate is one gate', async () => {
    for (const route of READ_ROUTES) {
      const res = await route.call(MEMBER);
      expect(res.status).toBe(403);
    }
  });

  it('refuses an unauthenticated caller on every billing route with 401', async () => {
    for (const route of ALL_BILLING_ROUTES) {
      const res = await route.call(null);
      expect(res.status, route.name).toBe(401);
    }
    expect(stripeMoneyCalls()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — the permitted role succeeds on each.
// ═══════════════════════════════════════════════════════════════════════════

describe('the permitted role still gets through', () => {
  for (const route of ALL_BILLING_ROUTES) {
    it(`lets the owner through: ${route.name}`, async () => {
      const res = await route.call(OWNER);
      expect(res.status).toBe(200);
    });
  }

  it('lets a volunteer admin operate the per-church seat routes', async () => {
    for (const route of WRITE_ROUTES.filter((r) => r.tier === 'admin')) {
      const res = await route.call(VOLUNTEER_ADMIN);
      expect(res.status, route.name).toBe(200);
    }
  });

  it('🔴 refuses a volunteer admin on everything that changes what the church PAYS', async () => {
    // The founder's case for owner-only, asserted: a volunteer with the admin
    // role managing events cannot move the church from $49 to $199, and cannot
    // cancel the plan out from under the owner.
    for (const route of ALL_BILLING_ROUTES.filter((r) => r.tier === 'owner')) {
      const res = await route.call(VOLUNTEER_ADMIN);
      expect(res.status, route.name).toBe(403);
    }
    expect(stripeMoneyCalls()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 — 🔴 THE MOST IMPORTANT TEST HERE. The THE-64 guard.
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 a roster-only admin is NOT locked out (THE-64)', () => {
  it('the persona really is roster-only — otherwise this whole block proves nothing', () => {
    // No admin role on the user doc…
    expect(firestore.get(`users/${ROSTER_ADMIN.uid}`)).toMatchObject({ role: 'user' });
    // …no admin claim on the token…
    expect(ROSTER_ADMIN.decoded).not.toHaveProperty('admin');
    // …and not the owner.
    expect(firestore.get('tenants/grace').ownerId).not.toBe(ROSTER_ADMIN.uid);
    // Their ONLY entitlement is this entry, in a document no client can read.
    expect(tenantPrivate.get('grace').adminEmails).toContain('roster@grace.org');
  });

  for (const route of ALL_BILLING_ROUTES) {
    it(`is not refused: ${route.name}`, async () => {
      const res = await route.call(ROSTER_ADMIN);

      // Stated as "not refused" rather than "200" on purpose: the assertion that
      // matters is that authorisation did not reject them.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);
    });
  }

  it('matches the roster case-insensitively, as firestore.rules and requireTenantPermission do', async () => {
    // The roster stores 'roster@grace.org'; this admin's token carries
    // 'Roster@Grace.org'. A case-sensitive compare would lock them out.
    expect(ROSTER_ADMIN.email).not.toBe(ROSTER_ADMIN.email.toLowerCase());
    const res = await portal(request('stripe/portal', { tenantId: 'grace' }, ROSTER_ADMIN));
    expect(res.status).toBe(200);
  });

  it('is not admitted to a tenant whose roster does NOT name them', async () => {
    // The roster is a grant for ONE tenant, not a global admin bit.
    const res = await portal(request('stripe/portal', { tenantId: 'hope' }, ROSTER_ADMIN));
    expect(res.status).toBe(403);
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 — the super admin bypass.
// ═══════════════════════════════════════════════════════════════════════════

describe('a super admin operating from the apex still passes', () => {
  it('really has no tenant of its own', () => {
    expect(firestore.get(`users/${SUPER_ADMIN.uid}`)).toBeUndefined();
    expect(SUPER_ADMIN.decoded).not.toHaveProperty('tenantId');
  });

  for (const route of WRITE_ROUTES) {
    it(`passes with tenantId: null: ${route.name}`, async () => {
      const res = await route.call(SUPER_ADMIN);
      expect(res.status).toBe(200);
    });
  }

  it('reaches ANY tenant, not just one', async () => {
    const res = await portal(request('stripe/portal', { tenantId: 'hope' }, SUPER_ADMIN));
    expect(res.status).toBe(200);
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_hope' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 5 — cross-tenant isolation.
// ═══════════════════════════════════════════════════════════════════════════

describe('an admin of tenant A cannot touch tenant B billing', () => {
  for (const route of WRITE_ROUTES) {
    it(`refuses tenant A's owner acting on tenant B: ${route.name}`, async () => {
      // OTHER_TENANT_OWNER owns 'hope' and is asking about 'grace'.
      const res = await route.call(OTHER_TENANT_OWNER, 'grace');
      expect(res.status).toBe(403);
      expect(stripeMoneyCalls()).toHaveLength(0);
    });
  }

  it('the same caller succeeds on their OWN tenant — the refusal is about scope, not identity', async () => {
    const res = await portal(request('stripe/portal', { tenantId: 'hope' }, OTHER_TENANT_OWNER));
    expect(res.status).toBe(200);
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_hope' }));
  });

  it('scopes the READ paths to the caller own tenant, ignoring anything client-supplied', async () => {
    const res = await invoices(request('billing/invoices', null, OTHER_TENANT_OWNER, 'GET'));
    expect(res.status).toBe(200);
    // Hope's ledger, never Grace's, even though the caller can name a tenant on
    // the write routes.
    expect(mockInvoicesList).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_hope' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 6 — 🔴 the donate route must stay public.
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 the donate route stays public — a visitor giving is never authenticated', () => {
  it('an unauthenticated donation still succeeds', async () => {
    const res = await donate(
      request('stripe/donate', { amount: 5000, tenantId: 'grace', donationType: 'one-time', donorEmail: 'visitor@example.com' }, null),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://checkout.stripe/session');
    // The donation really was created with no donor identity attached.
    const args = mockSessionsCreate.mock.calls[0][0] as any;
    expect(args.payment_intent_data.metadata.donorUserId).toBe('');
  });

  it('a member — refused by every billing route above — can still give', async () => {
    const res = await donate(
      request('stripe/donate', { amount: 5000, tenantId: 'grace', donationType: 'one-time' }, MEMBER),
    );
    expect(res.status).toBe(200);
  });
});
