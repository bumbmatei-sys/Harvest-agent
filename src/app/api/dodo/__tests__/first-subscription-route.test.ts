import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The two THE-203 routes, at their guards. (THE-203)
 *
 * These are the surfaces an untrusted body reaches, so what is asserted here is
 * mostly what they REFUSE:
 *
 *  · `/api/dodo/first-subscription` must refuse `plan: 'free'`. That is the
 *    THE-200 defect class — a derived plan list that went too wide and accepted
 *    a tier with no Dodo product — and it must not reappear on the third route
 *    now that there are three.
 *  · It must refuse a tenant that already has a subscription, on EITHER
 *    processor. This is the route that could reintroduce the double charge
 *    `/api/dodo/checkout`'s tenantId guard exists to prevent.
 *  · `/api/tenants/provision-free` must refuse a caller who already belongs to
 *    an organization, exactly as both paid signup paths do.
 */

vi.hoisted(() => {
  process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
  process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'whsec_dGVzdHNlY3JldA==';
  process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';
});

const { mockRequireAuth, mockTenantGet, mockPrivateGet, mockCreateCheckout, mockProvisionFree } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockTenantGet: vi.fn(),
  mockPrivateGet: vi.fn(),
  mockCreateCheckout: vi.fn().mockResolvedValue({ url: 'https://dodo/checkout', reference: 'ref1' }),
  mockProvisionFree: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: () => ({ doc: () => ({ get: mockTenantGet }) }) },
}));
vi.mock('@/lib/tenant-private', () => ({
  tenantPrivateRef: () => ({ get: mockPrivateGet }),
}));
vi.mock('@/lib/dodo/dodo-provider', () => ({
  dodoBillingProvider: { createPlanCheckout: mockCreateCheckout },
}));
vi.mock('@/lib/affiliate-referrer', () => ({
  resolveAffiliateReferrer: async () => ({ referrerId: null }),
  logReferralCapture: vi.fn(),
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureMoneyPathError: vi.fn(), captureHandledError: vi.fn(),
}));
vi.mock('@/lib/free-provisioning', () => ({
  provisionFreeTenant: mockProvisionFree,
  FreeProvisioningError: class extends Error {},
}));

const { POST: firstSubPOST } = await import('@/app/api/dodo/first-subscription/route');
const { POST: freePOST } = await import('@/app/api/tenants/provision-free/route');
const { PRICED_PLAN_ORDER, PLAN_ORDER } = await import('@/utils/plan-features');

const req = (url: string, body: object) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const FIRST_SUB_URL = 'https://example.com/api/dodo/first-subscription';
const FREE_URL = 'https://example.com/api/tenants/provision-free';

const asAdminOfFreeTenant = () =>
  mockRequireAuth.mockResolvedValue({ uid: 'u1', email: 'a@b.c', tenantId: 't1', isAdmin: true, isSuperAdmin: false });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  mockCreateCheckout.mockResolvedValue({ url: 'https://dodo/checkout', reference: 'ref1' });
  asAdminOfFreeTenant();
  mockTenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'free', name: 'Grace' }) });
  mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({ adminEmails: ['a@b.c'] }) });
  mockProvisionFree.mockResolvedValue({ outcome: 'created', tenantId: 'grace-church' });
});

describe('/api/dodo/first-subscription — the plan it will accept', () => {
  it('opens a checkout for a free tenant buying a priced tier', async () => {
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    expect(res.status).toBe(200);
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
  });

  it('🔴 refuses plan "free" — there is no Dodo product to check out against', async () => {
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'free', billing: 'monthly' }));
    expect(res.status).toBe(400);
    expect(mockCreateCheckout, 'a checkout was opened for a tier with no product').not.toHaveBeenCalled();
  });

  it('accepts every PRICED tier and refuses every tier that is not priced', async () => {
    // Derived, not listed: a tier added to the matrix without a price must be
    // refused here automatically rather than when someone remembers this test.
    for (const plan of PRICED_PLAN_ORDER) {
      vi.clearAllMocks(); asAdminOfFreeTenant();
      mockTenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'free' }) });
      mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({}) });
      mockCreateCheckout.mockResolvedValue({ url: 'u', reference: 'r' });
      const res = await firstSubPOST(req(FIRST_SUB_URL, { plan, billing: 'monthly' }));
      expect(res.status, `priced tier ${plan} was refused`).toBe(200);
    }
    const unpriced = (PLAN_ORDER as readonly string[]).filter((p) => !(PRICED_PLAN_ORDER as readonly string[]).includes(p));
    expect(unpriced, 'no unpriced tier exists — this assertion is vacuous').not.toHaveLength(0);
    for (const plan of unpriced) {
      vi.clearAllMocks(); asAdminOfFreeTenant();
      mockTenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'free' }) });
      mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({}) });
      const res = await firstSubPOST(req(FIRST_SUB_URL, { plan, billing: 'monthly' }));
      expect(res.status, `unpriced tier ${plan} was accepted`).toBe(400);
      expect(mockCreateCheckout).not.toHaveBeenCalled();
    }
  });

  it('refuses an unrecognised billing term rather than substituting one', async () => {
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'biennial' }));
    expect(res.status).toBe(400);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });
});

describe('/api/dodo/first-subscription — who and what it will act on', () => {
  it('refuses a caller with no tenant, and points at the signup route', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u1', email: 'a@b.c', tenantId: null, isAdmin: true, isSuperAdmin: false });
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/\/api\/dodo\/checkout/);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('refuses a member of the tenant who is not an admin', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u2', email: 'm@b.c', tenantId: 't1', isAdmin: false, isSuperAdmin: false });
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    expect(res.status).toBe(403);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it.each(['plus', 'pro', 'max'])('refuses a tenant already on %s', async (plan) => {
    mockTenantGet.mockResolvedValue({ exists: true, data: () => ({ plan }) });
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'pro', billing: 'monthly' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/change-plan/);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('🔴 refuses a tenant that already has a Dodo subscription', async () => {
    mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({ dodoSubscriptionId: 'sub_1' }) });
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    expect(res.status).toBe(400);
    expect(mockCreateCheckout, 'a second subscription could have been opened').not.toHaveBeenCalled();
  });

  it('🔴 refuses a tenant that already has a STRIPE subscription', async () => {
    mockPrivateGet.mockResolvedValue({ exists: true, data: () => ({ stripeSubscriptionId: 'sub_s' }) });
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    expect(res.status).toBe(400);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it('refuses a tenant that does not exist', async () => {
    mockTenantGet.mockResolvedValue({ exists: false, data: () => null });
    const res = await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    expect(res.status).toBe(404);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });
});

describe('/api/dodo/first-subscription — the checkout it builds', () => {
  it('stamps firstSubscription and the tenant, and NEVER newTenant', async () => {
    await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    const meta = mockCreateCheckout.mock.calls[0][0].metadata;
    expect(meta).toMatchObject({ firstSubscription: 'true', tenantId: 't1', userId: 'u1' });
    // `newTenant: 'true'` is what the provisioner keys on to BUILD a church.
    // This tenant already exists; stamping it would build a second one.
    expect(meta).not.toHaveProperty('newTenant');
  });

  it('passes no trialDays, leaving the product’s own trial to apply', async () => {
    await firstSubPOST(req(FIRST_SUB_URL, { plan: 'plus', billing: 'monthly' }));
    expect(mockCreateCheckout.mock.calls[0][0]).not.toHaveProperty('trialDays');
  });
});

describe('/api/tenants/provision-free — the guard', () => {
  it('provisions for a user with no tenant', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u9', email: 'n@b.c', tenantId: null, isAdmin: false, isSuperAdmin: false });
    const res = await freePOST(req(FREE_URL, { ministryName: 'Grace Church' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tenantId: 'grace-church', created: true });
  });

  it('🔴 refuses a user who already belongs to an organization', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'u1', email: 'a@b.c', tenantId: 't1', isAdmin: true, isSuperAdmin: false });
    const res = await freePOST(req(FREE_URL, { ministryName: 'Second Church' }));
    expect(res.status).toBe(400);
    expect(mockProvisionFree, 'a second church could have been built').not.toHaveBeenCalled();
  });

  it('refuses a platform super admin, who legitimately has no tenant', async () => {
    // The `!tenantId` guard alone would let a super admin through, and a
    // platform operator acquiring a ministry of their own is not a signup.
    mockRequireAuth.mockResolvedValue({ uid: 'sa', email: 's@b.c', tenantId: null, isAdmin: true, isSuperAdmin: true });
    const res = await freePOST(req(FREE_URL, { ministryName: 'Ops' }));
    expect(res.status).toBe(400);
    expect(mockProvisionFree).not.toHaveBeenCalled();
  });

  it('reports an existing tenant as a success, not an error', async () => {
    // A double-submitted button must not surface as a failure to someone whose
    // church exists.
    mockRequireAuth.mockResolvedValue({ uid: 'u9', email: 'n@b.c', tenantId: null, isAdmin: false, isSuperAdmin: false });
    mockProvisionFree.mockResolvedValue({ outcome: 'already-provisioned', tenantId: 'grace-church' });
    const res = await freePOST(req(FREE_URL, { ministryName: 'Grace Church' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tenantId: 'grace-church', created: false });
  });
});
