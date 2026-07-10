import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));

const { mockAccountsCreate, mockAccountLinksCreate } = vi.hoisted(() => ({
  mockAccountsCreate: vi.fn(),
  mockAccountLinksCreate: vi.fn().mockResolvedValue({ url: 'https://connect.stripe/onboard' }),
}));

const { mockDocGet, mockDocSet, mockDocUpdate } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    accounts = { create: mockAccountsCreate };
    accountLinks = { create: mockAccountLinksCreate };
  },
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: mockDocGet, set: mockDocSet, update: mockDocUpdate })),
    })),
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
});

describe('POST /api/stripe/connect — unified account mirror', () => {
  it('creates the canonical account and mirrors it (pending) onto the connecting user', async () => {
    mockAccountsCreate.mockResolvedValue({ id: 'acct_new' });
    // 1st doc.get() = tenant (no account yet); 2nd = connecting user (no affiliate acct).
    mockDocGet.mockResolvedValueOnce(snap({ name: 'Grace' })).mockResolvedValueOnce(snap({}));

    const res = await POST(makeRequest({ tenantId: 'tenant1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe/onboard' });
    // Canonical (donations) account persisted on the tenant…
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectAccountId: 'acct_new', stripeConnectStatus: 'pending' }),
    );
    // …and mirrored onto the connecting user's affiliate fields (same account).
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ affiliateStripeAccountId: 'acct_new', affiliateConnectStatus: 'pending' }),
      { merge: true },
    );
  });

  it('reuses the tenant account (no second account) and mirrors it onto the caller when already connected', async () => {
    mockDocGet
      .mockResolvedValueOnce(snap({ stripeConnectAccountId: 'acct_T', stripeConnectStatus: 'active' })) // tenant
      .mockResolvedValueOnce(snap({})); // connecting user

    const res = await POST(makeRequest({ tenantId: 'tenant1' }));
    expect(res.status).toBe(200);
    // Never mints a second Express account for an already-connected tenant.
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
    // Tenant still gets its donations account…
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripeConnectAccountId: 'acct_new' }),
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
