import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DODO_GRACE_PERIOD_MS } from '@/lib/tenant-lifecycle';

/**
 * THE-125 — the church can finally see its own grace window.
 *
 * A failed Dodo renewal records `dodoOnHoldAt` on `tenant_private/{id}`, which
 * is `allow read, write: if false`. That placement is right — a billing-failure
 * timestamp on the world-readable `tenants/{id}` doc would publish a named
 * church's failed card — but it left no way to TELL the church. This route is
 * the authenticated read that closes the gap, and it doubles as the convergence
 * trigger that a lapsed church with no donate traffic otherwise never hits.
 *
 * ⚠️ TWO THINGS THIS SUITE DELIBERATELY DOES NOT MOCK.
 *
 *  1. `@/lib/api-auth`. The gate is half of what this route is; a mocked helper
 *     cannot fail to read a roster it never touches, so test 4 — the THE-64
 *     regression — would prove nothing. Firebase is mocked BENEATH the real
 *     helpers instead, the way `billing-auth-gates` does it.
 *  2. `resolveTenantGraceState`. Mocking the resolver and asserting on the mock
 *     would test the mock. The real resolver runs against real timestamps.
 */

// ── Firebase, beneath the real auth helpers ─────────────────────────────────
const { mockVerifyIdToken, firestore } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  /** `${collection}/${id}` → document data. Absent key = document missing. */
  firestore: new Map<string, any>(),
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
    }),
  },
}));

// The roster AND the hold timestamp both live on this doc, so one fixture per
// tenant drives the gate and the answer alike.
const { tenantPrivate } = vi.hoisted(() => ({ tenantPrivate: new Map<string, any>() }));
vi.mock('@/lib/tenant-private', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenant-private')>();
  return {
    ...actual,
    getTenantPrivate: async (id: string) => tenantPrivate.get(id) ?? {},
    tenantPrivateRef: () => ({ set: async () => undefined }),
  };
});

// Convergence is a WRITE into the Dodo lifecycle and the only thing stubbed on
// the answer path — its own behaviour is pinned by the dodo lifecycle suite.
// Here we only care that the read triggers it, and that it can never break the
// read.
const { mockConverge } = vi.hoisted(() => ({ mockConverge: vi.fn() }));
vi.mock('@/lib/dodo/lifecycle', () => ({ convergeExpiredDodoGrace: mockConverge }));

const { mockCaptureMoneyPathError } = vi.hoisted(() => ({ mockCaptureMoneyPathError: vi.fn() }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: mockCaptureMoneyPathError }));

const { GET } = await import('../route');

// ── Personas ────────────────────────────────────────────────────────────────
//
// The token carries only what Firebase would carry. Anything the token does NOT
// say — a role, a roster entry — has to be found in Firestore by the real
// helper, which is the whole point of the roster case.

interface Persona {
  uid: string;
  email: string;
  decoded: Record<string, unknown>;
  /** users/{uid} document, or null for no user doc at all. */
  userDoc: Record<string, unknown> | null;
}

/** The buyer: tenants/grace.ownerId, role 'admin' on their user doc. */
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
 * firestore.rules admits them (`inTenantAdminEmails`) and so must this route.
 * A gate that read only the user document would refuse them — and billing is
 * the one screen an owner-by-roster cannot afford to lose.
 */
const ROSTER_ADMIN: Persona = {
  uid: 'roster1',
  email: 'Roster@Grace.org', // mixed case on purpose: the match must normalise
  decoded: { uid: 'roster1', email: 'Roster@Grace.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'grace', role: 'user' },
};

/** An admin of a DIFFERENT church. Not on Grace's roster. */
const OTHER_TENANT_ADMIN: Persona = {
  uid: 'admin2',
  email: 'admin@hope.org',
  decoded: { uid: 'admin2', email: 'admin@hope.org', auth_time: 1700000000 },
  userDoc: { tenantId: 'hope', role: 'admin' },
};

const ALL_PERSONAS = [OWNER, ROSTER_ADMIN, OTHER_TENANT_ADMIN];

const DAY_MS = 24 * 60 * 60 * 1000;

/** An ISO timestamp `days` days in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function request(as: Persona | null, tenantId?: string): NextRequest {
  const url = tenantId
    ? `https://example.com/api/tenants/grace-status?tenantId=${tenantId}`
    : 'https://example.com/api/tenants/grace-status';
  return new NextRequest(url, {
    method: 'GET',
    headers: as ? { authorization: `Bearer ${as.uid}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  firestore.clear();
  tenantPrivate.clear();

  mockVerifyIdToken.mockImplementation(async (token: string) => {
    const persona = ALL_PERSONAS.find((p) => p.uid === token);
    if (!persona) throw new Error('invalid token');
    return persona.decoded;
  });
  for (const persona of ALL_PERSONAS) {
    if (persona.userDoc) firestore.set(`users/${persona.uid}`, persona.userDoc);
  }

  firestore.set('tenants/grace', { ownerId: OWNER.uid, status: 'active' });
  firestore.set('tenants/hope', { ownerId: 'someone-else', status: 'active' });

  // Grace Chapel: the roster admin is rostered, and there is no hold by default.
  tenantPrivate.set('grace', {
    adminEmails: ['roster@grace.org'],
    billingProcessor: 'dodo',
    dodoSubscriptionId: 'sub_grace',
  });
  tenantPrivate.set('hope', {
    adminEmails: ['admin@hope.org'],
    billingProcessor: 'dodo',
    dodoSubscriptionId: 'sub_hope',
  });

  mockConverge.mockResolvedValue({ outcome: 'archived', tenantId: 'grace' });
});

describe('GET /api/tenants/grace-status — the state it reports', () => {
  it('returns none for a tenant that was never on hold', async () => {
    const res = await GET(request(OWNER, 'grace'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'none' });
  });

  it('returns in-grace with days remaining inside the window', async () => {
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(7) });

    const res = await GET(request(OWNER, 'grace'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.state).toBe('in-grace');
    // 21 - 7. The deadline is DERIVED from DODO_GRACE_PERIOD_MS, so this asserts
    // against the shared constant rather than re-writing 21 into the test.
    expect(body.daysRemaining).toBe(DODO_GRACE_PERIOD_MS / DAY_MS - 7);
    // And the deadline itself is a real, future ISO instant.
    expect(Date.parse(body.graceEndsAt)).toBeGreaterThan(Date.now());
  });

  it('returns expired past the window', async () => {
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(22) });

    const res = await GET(request(OWNER, 'grace'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.state).toBe('expired');
    // No countdown on a window that has already closed.
    expect(body.daysRemaining).toBeUndefined();
    expect(body.graceEndsAt).toBeUndefined();
  });
});

describe('GET /api/tenants/grace-status — who may ask', () => {
  it('a roster admin with no admin role on their user doc is admitted', async () => {
    // 🔴 THE THE-64 REGRESSION TEST. This persona's `users/{uid}.role` is 'user'
    // and their token carries no admin claim, so every user-document check in the
    // codebase reports them as not-an-admin. Their entitlement is the roster
    // entry alone, and firestore.rules has always honoured it. If this route's
    // gate is swapped for one that reads only the user doc, this is the test that
    // catches it — and the church whose owner has moved on is exactly the church
    // that needs the banner most.
    expect(ROSTER_ADMIN.userDoc?.role).toBe('user');

    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(3) });

    const res = await GET(request(ROSTER_ADMIN, 'grace'));
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('in-grace');
  });

  it('a caller from another tenant is refused', async () => {
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(3) });

    const res = await GET(request(OTHER_TENANT_ADMIN, 'grace'));
    expect(res.status).toBe(403);
    // Refused before anything about Grace Chapel is disclosed.
    expect(JSON.stringify(await res.json())).not.toContain('in-grace');
  });

  it('an unauthenticated caller is refused', async () => {
    const res = await GET(request(null, 'grace'));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tenants/grace-status — convergence as a side effect', () => {
  it('converges an expired tenant as a side effect of the read', async () => {
    // 🔴 THE SECOND HALF OF THIS CARD. Before it, convergence had exactly two
    // triggers: a donation attempt past the deadline and a repeat
    // `subscription.on_hold`. A lapsed church with no donate traffic therefore
    // stayed recorded `active` — and kept publishing and sending — forever.
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(22) });

    const res = await GET(request(OWNER, 'grace'));

    expect(res.status).toBe(200);
    expect(mockConverge).toHaveBeenCalledTimes(1);
    expect(mockConverge.mock.calls[0][0]).toBe('grace');
    // Same clock the answer was resolved against, not a second Date.now().
    expect(typeof mockConverge.mock.calls[0][1]).toBe('number');
  });

  it('does not converge a tenant that is still inside its window', async () => {
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(3) });

    await GET(request(OWNER, 'grace'));
    expect(mockConverge).not.toHaveBeenCalled();
  });

  it('a convergence failure does not change the response', async () => {
    // ⚠️ The answer never waits on the bookkeeping. The read is correct whether
    // or not the write lands — it came from the same resolver the write consults
    // — so a failing write must not turn a working read into a 500 and leave the
    // admin with no banner at all.
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(22) });

    const healthy = await GET(request(OWNER, 'grace'));
    const healthyBody = await healthy.json();

    mockConverge.mockRejectedValue(new Error('firestore unavailable'));
    const broken = await GET(request(OWNER, 'grace'));
    const brokenBody = await broken.json();

    expect(broken.status).toBe(healthy.status);
    expect(broken.status).toBe(200);
    expect(brokenBody).toEqual(healthyBody);
    // It failed loudly where failures are read, not quietly into a 500.
    expect(mockCaptureMoneyPathError).toHaveBeenCalled();
  });
});

describe('GET /api/tenants/grace-status — what it refuses to disclose', () => {
  it('exposes no payment action', async () => {
    // 🔴 Dodo has already charged or attempted to charge, and its dunning email
    // already links to the customer portal. This route answers a question; it
    // never offers a way to pay, and a second charge path would be a second way
    // to be billed for one subscription.
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(7) });

    const res = await GET(request(OWNER, 'grace'));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['daysRemaining', 'graceEndsAt', 'state']);
    const serialized = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['url', 'checkout', 'payment', 'card', 'invoice', 'amount', 'price']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("never returns another tenant's hold timestamp", async () => {
    // Both churches are in trouble. The caller belongs to Grace Chapel, so
    // nothing about Hope may appear — and Grace's own RAW timestamp does not
    // either: only the derived state and deadline ship, the way roster-status
    // returns a boolean rather than the roster.
    const graceHold = daysAgo(7);
    const hopeHold = daysAgo(9);
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: graceHold });
    tenantPrivate.set('hope', { ...tenantPrivate.get('hope'), dodoOnHoldAt: hopeHold });

    const res = await GET(request(OWNER, 'grace'));
    const serialized = JSON.stringify(await res.json());

    expect(serialized).not.toContain(hopeHold);
    expect(serialized).not.toContain('hope');
    expect(serialized).not.toContain('dodoOnHoldAt');
    expect(serialized).not.toContain(graceHold);
  });

  it('refuses a cross-tenant read even when the caller names the tenant explicitly', async () => {
    // The tenantId is a CANDIDATE, never a way to choose whose church you ask
    // about. Hope's admin asking about Hope is fine; asking about Grace is not.
    tenantPrivate.set('hope', { ...tenantPrivate.get('hope'), dodoOnHoldAt: daysAgo(5) });

    const own = await GET(request(OTHER_TENANT_ADMIN, 'hope'));
    expect(own.status).toBe(200);
    expect((await own.json()).state).toBe('in-grace');

    const theirs = await GET(request(OTHER_TENANT_ADMIN, 'grace'));
    expect(theirs.status).toBe(403);
  });

  it("falls back to the caller's own tenant when the param is omitted", async () => {
    tenantPrivate.set('grace', { ...tenantPrivate.get('grace'), dodoOnHoldAt: daysAgo(7) });

    const res = await GET(request(OWNER));
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('in-grace');
  });
});
