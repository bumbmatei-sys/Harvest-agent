import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));

const { mockAccountsCreate, mockAccountLinksCreate } = vi.hoisted(() => ({
  mockAccountsCreate: vi.fn(),
  mockAccountLinksCreate: vi.fn().mockResolvedValue({ url: 'https://connect.stripe/onboard' }),
}));

const { mockDocGet, mockDocSet, mockDocUpdate, mockBatchSet, mockBatchUpdate, mockBatchCommit } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockBatchSet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
}));

// ── THE-256 ────────────────────────────────────────────────────────────────
// This suite pins what Stripe Connect DOES, so it runs with the master switch
// ON. That is the hide-not-delete guarantee expressed as a test: every rule
// below — the membership gate, the existing-account branch, the affiliate mirror and
// the account link — still holds, unchanged, the moment
// STRIPE_CONNECT_ENABLED goes back to true. That the same route answers 503
// while the switch is OFF is asserted in the-256-stripe-connect-hidden.test.ts.
vi.mock('@/lib/stripe-connect-feature', () => ({
  STRIPE_CONNECT_ENABLED: true,
  STRIPE_CONNECT_HIDDEN_MESSAGE: 'Temporarily unavailable',
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    accounts = { create: mockAccountsCreate };
    accountLinks = { create: mockAccountLinksCreate };
  },
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

// The Connect account id lives on the server-only tenant_private doc; the
// route reads it via getTenantPrivate and writes it via tenantPrivateRef.
const { mockGetTenantPrivate } = vi.hoisted(() => ({ mockGetTenantPrivate: vi.fn() }));
vi.mock('@/lib/tenant-private', () => ({
  getTenantPrivate: mockGetTenantPrivate,
  tenantPrivateRef: (id: string) => ({ __coll: 'tenant_private', id }),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    // Refs carry their collection + id so batch assertions can tell WHICH doc a
    // write targeted (the tenant doc vs its tenant_private dual-write mirror).
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id?: string) => ({
        __coll: name,
        id,
        get: mockDocGet,
        set: mockDocSet,
        update: mockDocUpdate,
      })),
    })),
    batch: vi.fn(() => ({ set: mockBatchSet, update: mockBatchUpdate, commit: mockBatchCommit })),
  },
}));

const { POST } = await import('../connect/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/stripe/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const snap = (data: Record<string, unknown> | null) =>
  data === null ? { exists: false, data: () => undefined } : { exists: true, data: () => data };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  mockRequireAuth.mockResolvedValue({ uid: 'user1', email: 'a@b.co', tenantId: 'tenant1', isSuperAdmin: false });
  mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe/onboard' });
  mockGetTenantPrivate.mockResolvedValue({}); // default: tenant not yet connected
});

describe('POST /api/stripe/connect — unified account mirror', () => {
  it('creates the canonical account and mirrors it (pending) onto the connecting user', async () => {
    mockAccountsCreate.mockResolvedValue({ id: 'acct_new' });
    // 1st doc.get() = tenant (no account yet); 2nd = connecting user (no affiliate acct).
    mockDocGet.mockResolvedValueOnce(snap({ name: 'Grace' })).mockResolvedValueOnce(snap({}));

    const res = await POST(makeRequest({ tenantId: 'tenant1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe/onboard' });
    // Canonical (donations) account id persisted ONLY on tenant_private; the
    // public tenant doc carries just the status.
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ __coll: 'tenants', id: 'tenant1' }),
      expect.objectContaining({ stripeConnectStatus: 'pending' }),
    );
    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripeConnectAccountId: expect.anything() }),
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __coll: 'tenant_private', id: 'tenant1' }),
      expect.objectContaining({ stripeConnectAccountId: 'acct_new' }),
      { merge: true },
    );
    // …and mirrored onto the connecting user's affiliate fields (same account).
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ affiliateStripeAccountId: 'acct_new', affiliateConnectStatus: 'pending' }),
      { merge: true },
    );
  });

  it('reuses the tenant account (no second account) and mirrors it onto the caller when already connected', async () => {
    mockGetTenantPrivate.mockResolvedValue({ stripeConnectAccountId: 'acct_T' });
    mockDocGet
      .mockResolvedValueOnce(snap({ stripeConnectStatus: 'active' })) // tenant (status only — the id is private)
      .mockResolvedValueOnce(snap({})); // connecting user

    const res = await POST(makeRequest({ tenantId: 'tenant1' }));
    expect(res.status).toBe(200);
    // Never mints a second account for an already-connected tenant. (The type
    // that a NEW account is created with is pinned in `standard-connect-account`.)
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    // Mirrors the existing canonical account + its live status onto the caller.
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ affiliateStripeAccountId: 'acct_T', affiliateConnectStatus: 'active' }),
      { merge: true },
    );
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_T' }),
    );
  });

  it('does NOT downgrade a user who already holds a DIFFERENT, active affiliate account', async () => {
    mockAccountsCreate.mockResolvedValue({ id: 'acct_new' });
    mockDocGet
      .mockResolvedValueOnce(snap({ name: 'Grace' })) // tenant (no account yet)
      .mockResolvedValueOnce(snap({ affiliateStripeAccountId: 'acct_legacy', affiliateConnectStatus: 'active' })); // caller has a working payout

    const res = await POST(makeRequest({ tenantId: 'tenant1' }));
    expect(res.status).toBe(200);
    // Tenant still gets its donations account (id on tenant_private)…
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ __coll: 'tenant_private', id: 'tenant1' }),
      expect.objectContaining({ stripeConnectAccountId: 'acct_new' }),
      { merge: true },
    );
    // …but the caller's working affiliate account is left untouched (no clobber).
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it('rejects a caller connecting a tenant they do not belong to', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'user1', email: 'a@b.co', tenantId: 'tenantX', isSuperAdmin: false });

    const res = await POST(makeRequest({ tenantId: 'tenant1' }));
    expect(res.status).toBe(403);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });
});
