import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  mockVerifyIdToken,
  mockGetDoc,
  mockUpdate,
  mockCollectionGet,
} from '@/test/mocks/firebase-admin';

// ── Stripe mock ──────────────────────────────────────────────────────────────
const { mockSubItemCreate, mockSubItemDel } = vi.hoisted(() => ({
  mockSubItemCreate: vi.fn(),
  mockSubItemDel: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    subscriptionItems = { create: mockSubItemCreate, del: mockSubItemDel };
  },
}));

const { POST: addBilling } = await import('@/app/api/churches/add-billing/route');
const { POST: removeBilling } = await import('@/app/api/churches/remove-billing/route');

function makeRequest(path: string, body?: unknown, token?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  return new NextRequest(`https://example.com/api/churches/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

/** Auth as an admin of tenant-a (claims carry tenantId+admin so no user-doc read). */
function authAsTenantAdmin() {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'admin1', email: 'admin@x.com', tenantId: 'tenant-a', admin: true, superAdmin: false,
  });
}

/** Queue the tenant doc read (always the first mockGetDoc call in add-billing). */
function queueTenantDoc(data: Record<string, unknown> | undefined) {
  mockGetDoc.mockResolvedValueOnce({ exists: !!data, data: () => data });
}

/** Queue the church doc read (second mockGetDoc call in add-billing, first in remove-billing). */
function queueChurchDoc(data: Record<string, unknown> | undefined) {
  mockGetDoc.mockResolvedValueOnce({ exists: !!data, data: () => data });
}

function setChurchCount(count: number) {
  mockCollectionGet.mockResolvedValue({
    docs: Array.from({ length: count }, (_, i) => ({ id: `c${i}` })),
    empty: count === 0,
    forEach: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset also drops any leftover mockResolvedValueOnce queue from a prior test
  mockGetDoc.mockReset();
  mockCollectionGet.mockReset();
  setChurchCount(0);
  mockSubItemCreate.mockResolvedValue({ id: 'si_new' });
  mockSubItemDel.mockResolvedValue({ id: 'si_deleted' });
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
});

// ─── POST /api/churches/add-billing ──────────────────────────────────────────

describe('POST /api/churches/add-billing', () => {
  it('returns 401 for unauthenticated requests and never touches Stripe', async () => {
    const res = await addBilling(makeRequest('add-billing', { tenantId: 't', churchId: 'c' }));
    expect(res.status).toBe(401);
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when tenantId or churchId is missing', async () => {
    authAsTenantAdmin();
    const res = await addBilling(makeRequest('add-billing', { tenantId: 'tenant-a' }, 'tok'));
    expect(res.status).toBe(400);
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller belongs to a different tenant", async () => {
    authAsTenantAdmin();
    const res = await addBilling(makeRequest('add-billing', { tenantId: 'tenant-b', churchId: 'c1' }, 'tok'));
    expect(res.status).toBe(403);
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });

  it('skips billing for non-Ministry plans (they are capped at 1 church, never charged)', async () => {
    authAsTenantAdmin();
    queueTenantDoc({ plan: 'pro', stripeSubscriptionId: 'sub_1' });
    const res = await addBilling(makeRequest('add-billing', { tenantId: 'tenant-a', churchId: 'c1' }, 'tok'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, skipped: 'not-ministry' });
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });

  it("skips billing for Ministry's first church (1 included free on every plan)", async () => {
    authAsTenantAdmin();
    queueTenantDoc({ plan: 'ultra', stripeSubscriptionId: 'sub_1' });
    queueChurchDoc({ tenantId: 'tenant-a', name: 'First Church' });
    setChurchCount(1); // the just-added church is already in Firestore
    const res = await addBilling(makeRequest('add-billing', { tenantId: 'tenant-a', churchId: 'c1' }, 'tok'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, skipped: 'first-church-free' });
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });

  it("bills $10/mo for Ministry's second church", async () => {
    authAsTenantAdmin();
    queueTenantDoc({ plan: 'ultra', stripeSubscriptionId: 'sub_1' });
    queueChurchDoc({ tenantId: 'tenant-a', name: 'Second Church' });
    setChurchCount(2);
    const res = await addBilling(makeRequest('add-billing', { tenantId: 'tenant-a', churchId: 'c2' }, 'tok'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, subscriptionItemId: 'si_new' });
    expect(mockSubItemCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockSubItemCreate.mock.calls[0][0];
    expect(createArgs.subscription).toBe('sub_1');
    expect(createArgs.price_data.unit_amount).toBe(1000);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ stripeSubscriptionItemId: 'si_new' }));
  });

  it('is idempotent — a church that already has a subscription item is not billed again', async () => {
    authAsTenantAdmin();
    queueTenantDoc({ plan: 'ultra', stripeSubscriptionId: 'sub_1' });
    queueChurchDoc({ tenantId: 'tenant-a', stripeSubscriptionItemId: 'si_existing' });
    setChurchCount(3);
    const res = await addBilling(makeRequest('add-billing', { tenantId: 'tenant-a', churchId: 'c2' }, 'tok'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true, skipped: 'already-billed', subscriptionItemId: 'si_existing',
    });
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });

  it("returns 403 and does not charge when the church belongs to another tenant", async () => {
    authAsTenantAdmin();
    queueTenantDoc({ plan: 'ultra', stripeSubscriptionId: 'sub_1' });
    queueChurchDoc({ tenantId: 'tenant-b' });
    setChurchCount(2);
    const res = await addBilling(makeRequest('add-billing', { tenantId: 'tenant-a', churchId: 'c-foreign' }, 'tok'));
    expect(res.status).toBe(403);
    expect(mockSubItemCreate).not.toHaveBeenCalled();
  });
});

// ─── POST /api/churches/remove-billing ───────────────────────────────────────

describe('POST /api/churches/remove-billing', () => {
  it('is a safe no-op for a free church (no stripeSubscriptionItemId)', async () => {
    authAsTenantAdmin();
    queueChurchDoc({ tenantId: 'tenant-a', name: 'Free Church' });
    const res = await removeBilling(makeRequest('remove-billing', { tenantId: 'tenant-a', churchId: 'c1' }, 'tok'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.skipped).toBe(true);
    expect(mockSubItemDel).not.toHaveBeenCalled();
  });

  it('deletes the subscription item for a billed church', async () => {
    authAsTenantAdmin();
    queueChurchDoc({ tenantId: 'tenant-a', stripeSubscriptionItemId: 'si_paid' });
    const res = await removeBilling(makeRequest('remove-billing', { tenantId: 'tenant-a', churchId: 'c2' }, 'tok'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, subscriptionItemId: 'si_paid' });
    expect(mockSubItemDel).toHaveBeenCalledWith('si_paid');
  });
});
