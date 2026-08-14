import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-137 — a church reaching its OWN Stripe dashboard.
 *
 * 🔴 The bug: the settings "Manage Stripe Dashboard" control was a plain link to
 * `https://dashboard.stripe.com`. Harvest connects churches as EXPRESS accounts,
 * and an Express holder has no Stripe password — Express onboarding collects
 * business and bank details, never credentials. So every church that connected
 * landed on a login wall it could never pass, and the only route to its payouts,
 * balance, payout schedule and bank details was closed.
 *
 * ⚠️ THIS SUITE DELIBERATELY DOES NOT MOCK `@/lib/api-auth`, for the same reason
 * `billing-auth-gates` does not: the authorization decision IS the point of this
 * route, and a mocked gate cannot fail to read a roster it never touches. The
 * real `requireOwner` runs; only Stripe and Firebase are mocked beneath it.
 *
 * The gate is `requireOwner`, NOT the tenant-match that guards onboarding. A
 * login link is a session inside the church's Stripe account — payout history,
 * bank details, and the ability to change where the money lands. A tenant match
 * admits any member of the congregation.
 */

// ── Stripe ──────────────────────────────────────────────────────────────────
const {
  mockAccountsRetrieve,
  mockCreateLoginLink,
  mockAccountsCreate,
  mockAccountsUpdate,
  mockAccountsDel,
  mockAccountLinksCreate,
} = vi.hoisted(() => ({
  mockAccountsRetrieve: vi.fn(),
  mockCreateLoginLink: vi.fn(),
  mockAccountsCreate: vi.fn(),
  mockAccountsUpdate: vi.fn(),
  mockAccountsDel: vi.fn(),
  mockAccountLinksCreate: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    accounts = {
      retrieve: mockAccountsRetrieve,
      createLoginLink: mockCreateLoginLink,
      create: mockAccountsCreate,
      update: mockAccountsUpdate,
      del: mockAccountsDel,
    };
    accountLinks = { create: mockAccountLinksCreate };
  },
}));

// ── Firebase, beneath the real auth helpers ─────────────────────────────────
//
// `firestoreWrites` records every mutating call. Test 8 and test 9 are only
// worth anything because the mock cannot silently swallow a write.
const { mockVerifyIdToken, firestore, firestoreWrites } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  /** `${collection}/${id}` → document data. Absent key = document missing. */
  firestore: new Map<string, any>(),
  firestoreWrites: [] as Array<{ op: string; path: string; data?: unknown }>,
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
        set: async (data: unknown) => { firestoreWrites.push({ op: 'set', path: `${name}/${id}`, data }); },
        update: async (data: unknown) => { firestoreWrites.push({ op: 'update', path: `${name}/${id}`, data }); },
      }),
      where() { return this; },
      limit() { return this; },
      get: async () => ({ size: 0, empty: true, docs: [] }),
    }),
    batch: () => ({
      set: (_ref: unknown, data: unknown) => { firestoreWrites.push({ op: 'batch.set', path: 'unknown', data }); },
      update: (_ref: unknown, data: unknown) => { firestoreWrites.push({ op: 'batch.update', path: 'unknown', data }); },
      commit: async () => { firestoreWrites.push({ op: 'batch.commit', path: 'unknown' }); },
    }),
  },
}));

// 🔴 The roster lives here, and so does the Connect account id. One fixture per
// tenant drives both `isOnTenantRoster` and the route's own read.
const { tenantPrivate, tenantPrivateWrites } = vi.hoisted(() => ({
  tenantPrivate: new Map<string, any>(),
  tenantPrivateWrites: [] as unknown[],
}));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: async (id: string) => tenantPrivate.get(id) ?? {},
  tenantPrivateRef: () => ({
    set: async (data: unknown) => { tenantPrivateWrites.push(data); },
  }),
  TENANT_PRIVATE_COLLECTION: 'tenant_private',
  DODO_ON_HOLD_FIELD: 'dodoOnHoldAt',
}));

const { POST: loginLink } = await import('@/app/api/stripe/connect/login-link/route');

// ── Named fixtures ──────────────────────────────────────────────────────────
//
// Test 10 asserts the response leaks neither of these. It names them by LABEL,
// never by value pattern — a regex for `acct_...` would pass just as happily
// against a response that leaked a differently-shaped identifier.

/** Grace Chapel's connected Express account. Server-only; must never reach a client. */
const GRACE_ACCOUNT_ID = 'acct_grace_express';
/** Hope Church's account — the one a Grace caller must never obtain a link for. */
const HOPE_ACCOUNT_ID = 'acct_hope_express';
/** The platform's Stripe secret. Must never appear in any response body. */
const STRIPE_SECRET_KEY = 'sk_test_platform_secret_value';
/** What Stripe hands back. Single-use and short-lived by construction. */
const LOGIN_LINK_URL = 'https://connect.stripe.com/express/acct_grace_express/session_one_time';

// ── Personas ────────────────────────────────────────────────────────────────
//
// The token carries only what Firebase would carry. Anything the token does NOT
// say (a role, a roster entry) must be found in Firestore by the real helper.

interface Persona {
  /** Bearer token value; also the uid. */
  uid: string;
  email: string;
  decoded: Record<string, unknown>;
  /** users/{uid} document, or null for no user doc at all. */
  userDoc: Record<string, unknown> | null;
}

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
 * `role: 'user'` on their user doc, no `admin` claim on their token, not the
 * owner. firestore.rules admits them; any check reading only the user document
 * refuses them. That was a production lockout once — it must not recur on the
 * one screen that shows a church its money.
 */
const ROSTER_ADMIN: Persona = {
  uid: 'roster1',
  email: 'Roster@Grace.org', // mixed case on purpose: the match must normalise
  decoded: { uid: 'roster1', email: 'Roster@Grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'user' },
};

/** An ordinary member — anyone who signed up through the church's public subdomain. */
const MEMBER: Persona = {
  uid: 'member1',
  email: 'member@grace.org',
  decoded: { uid: 'member1', email: 'member@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'user' },
};

/** A volunteer with the admin role — Ministry allows 15 of these. Not the owner. */
const VOLUNTEER_ADMIN: Persona = {
  uid: 'volunteer1',
  email: 'volunteer@grace.org',
  decoded: { uid: 'volunteer1', email: 'volunteer@grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'admin' },
};

/** Owner of a DIFFERENT tenant, in good standing on their own. */
const OTHER_TENANT_OWNER: Persona = {
  uid: 'owner2',
  email: 'owner@hope.org',
  decoded: { uid: 'owner2', email: 'owner@hope.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'hope', role: 'admin' },
};

/** An ordinary member of the OTHER tenant. */
const OTHER_TENANT_MEMBER: Persona = {
  uid: 'member2',
  email: 'member@hope.org',
  decoded: { uid: 'member2', email: 'member@hope.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'hope', role: 'user' },
};

const ALL_PERSONAS = [OWNER, ROSTER_ADMIN, MEMBER, VOLUNTEER_ADMIN, OTHER_TENANT_OWNER, OTHER_TENANT_MEMBER];

function request(body: object | null, as: Persona | null): NextRequest {
  return new NextRequest('https://example.com/api/stripe/connect/login-link', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://theharvest.app',
      ...(as ? { authorization: `Bearer ${as.uid}` } : {}),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
}

/** A fully-onboarded Express account, as `accounts.retrieve` would return it. */
function expressAccount(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'express',
    details_submitted: true,
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';

  firestore.clear();
  tenantPrivate.clear();
  firestoreWrites.length = 0;
  tenantPrivateWrites.length = 0;

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
    stripeConnectAccountId: GRACE_ACCOUNT_ID,
  });
  tenantPrivate.set('hope', {
    adminEmails: [],
    stripeConnectAccountId: HOPE_ACCOUNT_ID,
  });

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const persona = ALL_PERSONAS.find((p) => p.uid === token);
    if (!persona) throw new Error('invalid token');
    return persona.decoded;
  });

  mockAccountsRetrieve.mockImplementation(async (id: string) => expressAccount(id));
  mockCreateLoginLink.mockResolvedValue({ object: 'login_link', url: LOGIN_LINK_URL });
});

/** Every Stripe call that would create, alter or delete a connected account. */
function stripeAccountMutations() {
  return [
    ...mockAccountsCreate.mock.calls,
    ...mockAccountsUpdate.mock.calls,
    ...mockAccountsDel.mock.calls,
    ...mockAccountLinksCreate.mock.calls,
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — the whole point of the ticket.
// ═══════════════════════════════════════════════════════════════════════════

describe('an owner gets a working link into their own Stripe dashboard', () => {
  it('returns a Stripe-minted login link, not a dashboard.stripe.com login wall', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe(LOGIN_LINK_URL);

    // 🔴 The link was minted for THIS church's account, by the only mechanism an
    // Express holder can actually use.
    expect(mockCreateLoginLink).toHaveBeenCalledTimes(1);
    expect(mockCreateLoginLink).toHaveBeenCalledWith(GRACE_ACCOUNT_ID);

    // And it is not the dead destination this ticket exists to remove.
    expect(body.url).not.toContain('dashboard.stripe.com');
  });

  it('works when the owner supplies no tenantId — the token resolves it', async () => {
    const res = await loginLink(request({}, OWNER));

    expect(res.status).toBe(200);
    expect(mockCreateLoginLink).toHaveBeenCalledWith(GRACE_ACCOUNT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — the THE-64 regression shape.
// ═══════════════════════════════════════════════════════════════════════════

describe('a roster admin gets one too', () => {
  it('the persona really is roster-only — otherwise this block proves nothing', () => {
    // No admin role on the user doc…
    expect(firestore.get(`users/${ROSTER_ADMIN.uid}`)).toMatchObject({ role: 'user' });
    // …no admin claim on the token…
    expect(ROSTER_ADMIN.decoded).not.toHaveProperty('admin');
    // …and not the owner.
    expect(firestore.get('tenants/grace').ownerId).not.toBe(ROSTER_ADMIN.uid);
    // Their ONLY entitlement is this entry, in a document no client can read.
    expect(tenantPrivate.get('grace').adminEmails).toContain('roster@grace.org');
  });

  it('is not refused, and gets a real link', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, ROSTER_ADMIN));

    // Stated as "not refused" first on purpose: what matters is that
    // authorization did not reject a legitimate owner-equivalent.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(LOGIN_LINK_URL);
  });

  it('matches the roster case-insensitively, as firestore.rules does', async () => {
    // The roster stores 'roster@grace.org'; this admin's token carries
    // 'Roster@Grace.org'. A case-sensitive compare would lock them out.
    expect(ROSTER_ADMIN.email).not.toBe(ROSTER_ADMIN.email.toLowerCase());
    const res = await loginLink(request({ tenantId: 'grace' }, ROSTER_ADMIN));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 — 🔴 THE AUTHORIZATION TEST. Worth more than the rest of this file.
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 an ordinary tenant member is refused', () => {
  it('refuses a member of the church that owns the account', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, MEMBER));

    // 403, not 401: they ARE authenticated, and they ARE a member of this
    // tenant. A tenant-match gate would have let them straight through — which
    // is exactly why this route does not use one. Being in the congregation is
    // not being entitled to the church's bank details.
    expect(res.status).toBe(403);
    const body = await res.json();
    // Pinned to the OWNER gate's wording. A 403 that arrived for some other
    // reason must not be able to stand in for this test.
    expect(body.error).toBe('Owner access required');

    // 🔴 And no link was ever minted. The refusal is before Stripe, not a
    // link created and then withheld.
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
    // Nothing about the account leaked in the refusal either.
    expect(JSON.stringify(body)).not.toContain(GRACE_ACCOUNT_ID);
  });

  it('🔴 refuses a volunteer admin — the admin ROLE is not owner-equivalent', async () => {
    // Ministry allows fifteen admins to manage events. None of them may open a
    // session onto the church's payouts and bank account.
    const res = await loginLink(request({ tenantId: 'grace' }, VOLUNTEER_ADMIN));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Owner access required');
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it('the member is a real member — the refusal is about entitlement, not identity', () => {
    // Same tenant as the owner, and a valid user doc. Nothing about this caller
    // is malformed; they are simply not the owner.
    expect(firestore.get(`users/${MEMBER.uid}`)).toMatchObject({ tenantId: 'grace' });
    expect(firestore.get('tenants/grace').ownerId).not.toBe(MEMBER.uid);
    expect(tenantPrivate.get('grace').adminEmails).not.toContain(MEMBER.email);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 — cross-tenant isolation.
// ═══════════════════════════════════════════════════════════════════════════

describe('a member of another tenant is refused', () => {
  it("refuses tenant B's OWNER asking for tenant A's dashboard", async () => {
    // OTHER_TENANT_OWNER owns 'hope' — a legitimate owner, of the wrong church.
    const res = await loginLink(request({ tenantId: 'grace' }, OTHER_TENANT_OWNER));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Access denied to this tenant');
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
  });

  it("refuses tenant B's member asking for tenant A's dashboard", async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OTHER_TENANT_MEMBER));
    expect(res.status).toBe(403);
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it('🔴 never mints church A a link for church B, even naming B explicitly', async () => {
    await loginLink(request({ tenantId: 'hope' }, OWNER));

    // Grace's owner named Hope. Whatever the outcome, Hope's account id must
    // never have reached Stripe on this caller's behalf.
    expect(mockCreateLoginLink).not.toHaveBeenCalledWith(HOPE_ACCOUNT_ID);
    expect(mockAccountsRetrieve).not.toHaveBeenCalledWith(HOPE_ACCOUNT_ID);
  });

  it('the same caller succeeds on their OWN tenant — scope, not identity', async () => {
    const res = await loginLink(request({ tenantId: 'hope' }, OTHER_TENANT_OWNER));

    expect(res.status).toBe(200);
    expect(mockCreateLoginLink).toHaveBeenCalledWith(HOPE_ACCOUNT_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 5 — unauthenticated.
// ═══════════════════════════════════════════════════════════════════════════

describe('an unauthenticated caller is refused', () => {
  it('returns 401 with no bearer token at all', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, null));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
  });

  it('returns 401 for a token Firebase rejects', async () => {
    const res = await loginLink(
      new NextRequest('https://example.com/api/stripe/connect/login-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-real-token' },
        body: JSON.stringify({ tenantId: 'grace' }),
      }),
    );

    expect(res.status).toBe(401);
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 6 — no connected account yet.
// ═══════════════════════════════════════════════════════════════════════════

describe('a tenant with no connected account is sent to onboarding, not shown an error', () => {
  beforeEach(() => {
    // Grace exists and has an owner, but has never connected Stripe.
    tenantPrivate.set('grace', { adminEmails: ['roster@grace.org'] });
  });

  it('answers with an onboarding route rather than an error status', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    // 🔴 Not a 4xx and not a 5xx. There is nothing wrong — there is simply
    // nothing to log in to yet, and the honest answer is "go and connect".
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboardingRequired).toBe(true);
    expect(body.reason).toBe('not_connected');
    expect(body.error).toBeUndefined();
    expect(body.url).toBeUndefined();
  });

  it('does not go to Stripe at all for an account that does not exist', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it('still refuses a member — a missing account is not a reason to skip the gate', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, MEMBER));
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 7 — connected, but onboarding never finished.
// ═══════════════════════════════════════════════════════════════════════════

describe('an account that has not finished onboarding is sent back to onboarding', () => {
  beforeEach(() => {
    // The account exists; the church walked away part-way through Express
    // onboarding. `createLoginLink` would error for this account.
    mockAccountsRetrieve.mockImplementation(async (id: string) =>
      expressAccount(id, { details_submitted: false, charges_enabled: false, payouts_enabled: false }),
    );
  });

  it('answers with an onboarding route rather than an error dialog', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboardingRequired).toBe(true);
    expect(body.reason).toBe('onboarding_incomplete');
    expect(body.error).toBeUndefined();
    expect(body.url).toBeUndefined();
  });

  it('🔴 never asks Stripe for a link it knows would fail', async () => {
    await loginLink(request({ tenantId: 'grace' }, OWNER));
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });

  it('🔴 a RESTRICTED but onboarded account still gets its dashboard', async () => {
    // Onboarding is finished (`details_submitted`), but Stripe has since raised
    // fresh requirements. This church has money in a real dashboard and needs to
    // see what is holding its payouts up — sending it back through onboarding
    // instead would lock it out of its own balance exactly when it matters.
    mockAccountsRetrieve.mockImplementation(async (id: string) =>
      expressAccount(id, {
        details_submitted: true,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { currently_due: ['individual.verification.document'] },
      }),
    );

    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(LOGIN_LINK_URL);
    expect(mockCreateLoginLink).toHaveBeenCalledWith(GRACE_ACCOUNT_ID);
  });

  it('🔴 fails loudly for an account that is not Express at all', async () => {
    // A Standard holder logs in at dashboard.stripe.com with their own
    // credentials; a login link is the wrong mechanism entirely. If the account
    // type ever changes underneath us, the right destination for the button
    // changes with it — that is a platform fault to be paged about, not
    // something to paper over.
    mockAccountsRetrieve.mockImplementation(async (id: string) =>
      expressAccount(id, { type: 'standard' }),
    );

    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(500);
    const body = await res.json();
    // Loud: an explicit error, NOT a silent onboarding redirect that would send
    // a working Standard account into a flow it does not need.
    expect(body.onboardingRequired).toBeUndefined();
    expect(body.error).toBeTruthy();
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 8 — 🔴 the link is a credential. It is never kept.
// ═══════════════════════════════════════════════════════════════════════════

describe('no link is ever persisted or cached', () => {
  it('writes nothing to Firestore on a successful mint', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));
    expect(res.status).toBe(200);

    // 🔴 Not to the tenant doc, not to the private doc, not to a user doc. A
    // login link is single-use and short-lived, so a stored one is both broken
    // and a stored credential.
    expect(firestoreWrites).toEqual([]);
    expect(tenantPrivateWrites).toEqual([]);
  });

  it('🔴 mints a FRESH link on every call — never replays the previous one', async () => {
    // Stripe hands back a different single-use URL each time; the route must
    // pass through whatever the current call returned, which it can only do by
    // asking again.
    const SECOND_URL = 'https://connect.stripe.com/express/acct_grace_express/session_second';
    mockCreateLoginLink
      .mockResolvedValueOnce({ object: 'login_link', url: LOGIN_LINK_URL })
      .mockResolvedValueOnce({ object: 'login_link', url: SECOND_URL });

    const first = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();
    const second = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();

    expect(mockCreateLoginLink).toHaveBeenCalledTimes(2);
    expect(first.url).toBe(LOGIN_LINK_URL);
    expect(second.url).toBe(SECOND_URL);
    // A cache would have served the first URL twice.
    expect(second.url).not.toBe(first.url);
  });

  it('🔴 does not leak one caller link to the next caller', async () => {
    // Module-level memoisation would survive between requests — and across
    // TENANTS, which is how a cache turns into a cross-tenant breach.
    const HOPE_URL = 'https://connect.stripe.com/express/acct_hope_express/session_hope';
    mockCreateLoginLink
      .mockResolvedValueOnce({ object: 'login_link', url: LOGIN_LINK_URL })
      .mockResolvedValueOnce({ object: 'login_link', url: HOPE_URL });

    const grace = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).json();
    const hope = await (await loginLink(request({ tenantId: 'hope' }, OTHER_TENANT_OWNER))).json();

    expect(grace.url).toBe(LOGIN_LINK_URL);
    expect(hope.url).toBe(HOPE_URL);
    expect(mockCreateLoginLink).toHaveBeenNthCalledWith(1, GRACE_ACCOUNT_ID);
    expect(mockCreateLoginLink).toHaveBeenNthCalledWith(2, HOPE_ACCOUNT_ID);
  });

  it('writes nothing on the refusal and onboarding paths either', async () => {
    await loginLink(request({ tenantId: 'grace' }, MEMBER));
    await loginLink(request({ tenantId: 'grace' }, null));
    tenantPrivate.set('grace', { adminEmails: [] });
    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(firestoreWrites).toEqual([]);
    expect(tenantPrivateWrites).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 9 — this route reads. It never touches account lifecycle.
// ═══════════════════════════════════════════════════════════════════════════

describe('nothing in this path creates or modifies a Stripe account', () => {
  it('mints a link without creating, updating or deleting any account', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));
    expect(res.status).toBe(200);

    expect(stripeAccountMutations()).toHaveLength(0);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockAccountsUpdate).not.toHaveBeenCalled();
    // 🔴 Not even an account LINK: onboarding belongs to /api/stripe/connect,
    // and this route creating one would be it quietly taking over that job.
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });

  it('creates no account for a tenant that has none — it reports, it does not provision', async () => {
    tenantPrivate.set('grace', { adminEmails: [] });

    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(res.status).toBe(200);
    expect((await res.json()).onboardingRequired).toBe(true);
    // The tempting bug: "no account? make one." That would create a live Stripe
    // account from a read-only route, off a button labelled Manage.
    expect(stripeAccountMutations()).toHaveLength(0);
  });

  it('creates no account for a mid-onboarding account either', async () => {
    mockAccountsRetrieve.mockImplementation(async (id: string) =>
      expressAccount(id, { details_submitted: false }),
    );

    await loginLink(request({ tenantId: 'grace' }, OWNER));

    expect(stripeAccountMutations()).toHaveLength(0);
  });

  it('touches Stripe not at all when the caller is refused', async () => {
    await loginLink(request({ tenantId: 'grace' }, MEMBER));
    await loginLink(request({ tenantId: 'grace' }, VOLUNTEER_ADMIN));
    await loginLink(request({ tenantId: 'grace' }, OTHER_TENANT_OWNER));
    await loginLink(request({ tenantId: 'grace' }, null));

    expect(stripeAccountMutations()).toHaveLength(0);
    expect(mockAccountsRetrieve).not.toHaveBeenCalled();
    expect(mockCreateLoginLink).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 10 — the response is the link and nothing else.
// ═══════════════════════════════════════════════════════════════════════════

describe('the response contains no account id and no Stripe key', () => {
  it('returns the link alone — the account id travels nowhere except inside it', async () => {
    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));
    const raw = await res.text();
    const body = JSON.parse(raw);

    // 🔴 Exactly one key. No account id field, no status echo, no key, nothing
    // added "for the client's convenience".
    expect(Object.keys(body)).toEqual(['url']);

    // ⚠️ The link's own URL is Stripe's to format, and it may embed the account
    // id in its path — this fixture does, which is what makes this assertion
    // worth writing. That one place is the carve-out, because the link IS the
    // thing being deliberately handed over. Everywhere else in the response the
    // id is a leak, so assert against the body with the link removed.
    const beyondTheLink = raw.replace(body.url, '');
    expect(beyondTheLink).not.toContain(GRACE_ACCOUNT_ID);

    // The platform secret gets no such carve-out. It appears nowhere at all.
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });

  it('leaks neither on the onboarding-required paths', async () => {
    mockAccountsRetrieve.mockImplementation(async (id: string) =>
      expressAccount(id, { details_submitted: false }),
    );
    const incomplete = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();
    expect(incomplete).not.toContain(GRACE_ACCOUNT_ID);
    expect(incomplete).not.toContain(STRIPE_SECRET_KEY);

    tenantPrivate.set('grace', { adminEmails: [] });
    const unconnected = await (await loginLink(request({ tenantId: 'grace' }, OWNER))).text();
    expect(unconnected).not.toContain(GRACE_ACCOUNT_ID);
    expect(unconnected).not.toContain(STRIPE_SECRET_KEY);
  });

  it('leaks neither on the refusal paths, where an error message might name them', async () => {
    for (const persona of [MEMBER, VOLUNTEER_ADMIN, OTHER_TENANT_OWNER, null]) {
      const raw = await (await loginLink(request({ tenantId: 'grace' }, persona))).text();
      expect(raw).not.toContain(GRACE_ACCOUNT_ID);
      expect(raw).not.toContain(STRIPE_SECRET_KEY);
    }
  });

  it('leaks neither when Stripe itself fails', async () => {
    // Stripe errors often quote the offending id straight back. Echoing a raw
    // provider message into a response is how the id would escape.
    mockCreateLoginLink.mockRejectedValue(
      new Error(`No such account: ${GRACE_ACCOUNT_ID} (key ${STRIPE_SECRET_KEY})`),
    );

    const res = await loginLink(request({ tenantId: 'grace' }, OWNER));
    const raw = await res.text();

    expect(res.status).toBe(500);
    expect(raw).not.toContain(GRACE_ACCOUNT_ID);
    expect(raw).not.toContain(STRIPE_SECRET_KEY);
  });
});
