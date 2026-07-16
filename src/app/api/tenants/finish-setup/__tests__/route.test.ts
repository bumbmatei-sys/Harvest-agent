import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockSubsRetrieve, mockSubsUpdate } = vi.hoisted(() => ({
  mockSubsRetrieve: vi.fn(),
  mockSubsUpdate: vi.fn().mockResolvedValue({ id: 'sub_ref' }),
}));
const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));
const { mockDocGet, mockDocCreate, mockDocSet, mockDocUpdate, mockDocDelete, mockCollGet } = vi.hoisted(() => ({
  mockDocGet: vi.fn(),
  mockDocCreate: vi.fn().mockResolvedValue(undefined),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocDelete: vi.fn().mockResolvedValue(undefined),
  mockCollGet: vi.fn().mockResolvedValue({ empty: true, docs: [], forEach: vi.fn() }),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    subscriptions = { retrieve: mockSubsRetrieve, update: mockSubsUpdate };
  },
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: mockDocGet,
        create: mockDocCreate,
        set: mockDocSet,
        update: mockDocUpdate,
        delete: mockDocDelete,
      })),
      where: vi.fn(() => ({ get: mockCollGet })),
    })),
    batch: vi.fn(() => ({ update: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) })),
  },
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn().mockResolvedValue(undefined) }));

const { POST } = await import('../route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/tenants/finish-setup', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  mockRequireAuth.mockResolvedValue({
    tenantId: 'old-tenant', email: 'pastor@grace.org', isSuperAdmin: false, isAdmin: true,
  });
  mockCollGet.mockResolvedValue({ empty: true, docs: [], forEach: vi.fn() });
});

describe('POST /api/tenants/finish-setup — subscription metadata merge on rename', () => {
  it('preserves referrerId/plan/billing when re-pointing the subscription to the new tenant id', async () => {
    // The first-run rename re-tags the subscription with the new tenant id. Stripe
    // metadata updates REPLACE the whole object, so this is the SECOND place (after
    // the checkout webhook) that would wipe referrerId on the church-signup path —
    // silently stopping the affiliate's recurring commission. The fix merges.
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        adminEmails: ['pastor@grace.org'],
        setupCompleted: false,
        stripeSubscriptionId: 'sub_ref',
        ministryName: 'Grace Church',
      }),
    });
    mockSubsRetrieve.mockResolvedValue({
      id: 'sub_ref',
      metadata: { tenantId: 'old-tenant', plan: 'pro', billing: 'monthly', referrerId: 'refUser' },
    });

    const res = await POST(makeRequest({ subdomain: 'grace-church' }));
    expect(res.status).toBe(200);
    expect((await res.json()).tenantId).toBe('grace-church');

    // Existing metadata read back and merged — only tenantId changes.
    expect(mockSubsRetrieve).toHaveBeenCalledWith('sub_ref');
    expect(mockSubsUpdate).toHaveBeenCalledWith('sub_ref', {
      metadata: { tenantId: 'grace-church', plan: 'pro', billing: 'monthly', referrerId: 'refUser' },
    });
  });
});
