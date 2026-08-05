import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Server-side entitlement gate for custom-domain provisioning.
 *
 * Before this gate existed the route required only an authenticated admin, and
 * its own header comment claimed the plan was enforced "in the UI and by
 * Firestore rules" — but firestore.rules has no `customDomain` reference at all.
 * So any authenticated tenant admin on ANY plan could attach an arbitrary domain
 * to the shared Vercel project. These tests pin the fix.
 *
 * They also pin that `normalizeDomain` keeps every label of a subdomain, which
 * is what makes `app.church.org` work.
 */

const { mockRequireAdmin, mockCapture, tenantDocs, domainDocs, setCalls } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockCapture: vi.fn(),
  tenantDocs: new Map<string, Record<string, unknown>>(),
  domainDocs: new Map<string, Record<string, unknown>>(),
  setCalls: [] as Array<{ collection: string; id: string; data: Record<string, unknown> }>,
}));

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: mockCapture }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => {
        const store = name === 'tenants' ? tenantDocs : domainDocs;
        return {
          get: async () => ({ exists: store.has(id), data: () => store.get(id) }),
          set: async (data: Record<string, unknown>) => {
            setCalls.push({ collection: name, id, data });
          },
        };
      },
    }),
  },
}));

const { POST, GET } = await import('../route');

function postReq(domain: string): NextRequest {
  return new NextRequest('https://example.com/api/domains/provision', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify({ domain }),
  });
}

function getReq(domain: string): NextRequest {
  return new NextRequest(
    `https://example.com/api/domains/provision?domain=${encodeURIComponent(domain)}`,
    { headers: { authorization: 'Bearer token' } }
  );
}

function mockUser(overrides: object = {}) {
  return {
    uid: 'u1',
    email: 'admin@church.org',
    tenantId: 'tenant1',
    isAdmin: true,
    isSuperAdmin: false,
    ...overrides,
  };
}

/** Give tenant1 a plan. */
function onPlan(plan: string) {
  tenantDocs.set('tenant1', { plan, name: 'Test Church' });
}

/** Vercel replies with a pending subdomain challenge. */
function mockVercelOk(verification: unknown[] = []) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ verified: false, verification }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  tenantDocs.clear();
  domainDocs.clear();
  setCalls.length = 0;
  vi.stubEnv('VERCEL_API_TOKEN', 'test-token');
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/domains/provision — plan gate', () => {
  // The gate is `hasFeature(plan, 'customDomain')` and custom domains are free
  // on every tier under the freemium model, so no plan is refused today. These
  // tests are kept — inverted, not deleted — because the GATE itself still has
  // to work: it is the server-side enforcement (super admins bypass, unknown
  // plans resolve to the free tier), and if `customDomain` is ever made paid
  // again these are the tests that must go red first.
  it('allows a Root (pro) tenant — custom domains are free on every tier', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    onPlan('pro');
    const fetchMock = mockVercelOk();

    const res = await POST(postReq('church.org'));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('allows a Seed (plus, free) tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    onPlan('plus');
    const fetchMock = mockVercelOk();

    const res = await POST(postReq('church.org'));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('resolves a tenant with no plan field to the free tier (still the most restrictive)', async () => {
    // The fail-closed behaviour is unchanged: a missing plan resolves to the
    // CHEAPEST tier, never a generous one. It no longer produces a 403 here only
    // because the cheapest tier now has custom domains.
    mockRequireAdmin.mockResolvedValue(mockUser());
    tenantDocs.set('tenant1', { name: 'No Plan Church' });
    mockVercelOk();

    const res = await POST(postReq('church.org'));

    expect(res.status).toBe(200);
  });

  it('returns 404 when the tenant doc does not exist', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockVercelOk();

    const res = await POST(postReq('church.org'));

    expect(res.status).toBe(404);
  });

  it('succeeds for a Community (max) tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    onPlan('max');
    const fetchMock = mockVercelOk([
      { type: 'CNAME', domain: 'app.church.org', value: 'cname.vercel-dns.com' },
    ]);

    const res = await POST(postReq('app.church.org'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.domain).toBe('app.church.org');
    expect(body.status).toBe('pending');
    expect(fetchMock).toHaveBeenCalledOnce();
    // Vercel's challenge records are passed straight through for the UI to render.
    expect(body.verification).toEqual([
      { type: 'CNAME', domain: 'app.church.org', value: 'cname.vercel-dns.com' },
    ]);
  });

  it('succeeds for a Ministry (ultra) tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    onPlan('ultra');
    mockVercelOk();

    const res = await POST(postReq('church.org'));

    expect(res.status).toBe(200);
  });

  it('lets a super admin through without a plan lookup', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: null, isSuperAdmin: true }));
    mockVercelOk();

    const res = await POST(postReq('church.org'));

    // Resolves to the platform tenant, which has no plan doc — the super-admin
    // bypass is what keeps this from 404ing on the gate.
    expect(res.status).toBe(200);
  });
});

describe('GET /api/domains/provision — plan gate', () => {
  it('allows a Root (pro) tenant — custom domains are free on every tier', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    onPlan('pro');
    const fetchMock = mockVercelOk();

    const res = await GET(getReq('church.org'));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('succeeds for a Grove (max) tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    onPlan('max');
    mockVercelOk();

    const res = await GET(getReq('app.church.org'));

    expect(res.status).toBe(200);
    expect((await res.json()).domain).toBe('app.church.org');
  });
});

describe('normalizeDomain (via the route) — subdomains survive', () => {
  beforeEach(() => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    onPlan('max');
  });

  it('normalizes https://App.Church.org/give to app.church.org', async () => {
    mockVercelOk();
    const res = await POST(postReq('https://App.Church.org/give'));

    expect((await res.json()).domain).toBe('app.church.org');
    // And that is what gets persisted, not the raw input.
    expect(setCalls.find((c) => c.collection === 'domains')?.id).toBe('app.church.org');
  });

  it('strips a leading www. (existing behaviour)', async () => {
    mockVercelOk();
    const res = await POST(postReq('www.church.org'));

    expect((await res.json()).domain).toBe('church.org');
  });

  it('strips no label other than a leading www.', async () => {
    mockVercelOk();
    // Three labels, none of them www — every one must survive.
    const res = await POST(postReq('give.app.church.org'));

    expect((await res.json()).domain).toBe('give.app.church.org');
  });

  it('strips only the FIRST www. and keeps a www label deeper in the host', async () => {
    mockVercelOk();
    const res = await POST(postReq('www.www.church.org'));

    expect((await res.json()).domain).toBe('www.church.org');
  });

  it('sends the normalized host to Vercel, not the raw input', async () => {
    const fetchMock = mockVercelOk();
    await POST(postReq('  HTTPS://Give.Church.ORG/donate?x=1  '));

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.name).toBe('give.church.org');
  });
});
