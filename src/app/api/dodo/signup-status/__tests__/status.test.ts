import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), subscription: vi.fn(), session: vi.fn(), get: vi.fn(), private: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (collection: string) => ({ doc: (id: string) => ({ get: () => mocks.get(collection, id) }) }) } }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mocks.private }));
vi.mock('@/lib/dodo/dodo-provider', () => ({ dodoBillingProvider: { getSubscription: mocks.subscription }, getDodoCheckoutPaymentStatus: mocks.session }));
import { GET } from '../route';
const request = (query = 'dodo=success&subscription_id=sub-A') => new NextRequest(`https://theharvest.app/api/dodo/signup-status?${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ uid: 'A' });
  mocks.subscription.mockResolvedValue({ status: 'active', metadata: { userId: 'A' } });
  mocks.get.mockImplementation(async (collection: string) => ({ exists: collection === 'users', data: () => ({}) }));
  mocks.private.mockResolvedValue({ dodoSubscriptionId: 'sub-A' });
});
describe('checkout return status is authoritative and owned', () => {
  it.each(['failed', 'cancelled', 'expired', 'grace', 'paused'])('%s cannot become success through a query string', async status => {
    mocks.subscription.mockResolvedValue({ status, metadata: { userId: 'A' } });
    expect(await (await GET(request())).json()).toEqual({ status: 'failed' });
    expect(mocks.get).not.toHaveBeenCalledWith('tenants', expect.anything());
  });
  it('does not treat the success marker or an active mandate as a provisioned account', async () => {
    expect(await (await GET(request())).json()).toEqual({ status: 'pending' });
  });
  it('ignores spoofed status=active and reads the server-owned checkout session on a no-id return', async () => {
    mocks.get.mockImplementation(async (collection: string) => ({ exists: true, data: () => collection === 'signup_checkouts' ? { reference: 'server-session' } : {} }));
    mocks.session.mockResolvedValue('failed');
    expect(await (await GET(request('dodo=success&status=active&session_id=spoofed'))).json()).toEqual({ status: 'failed' });
    expect(mocks.session).toHaveBeenCalledWith('server-session');
  });
  it('a declined payment is terminal even while its subscription is still pending', async () => {
    mocks.subscription.mockResolvedValue({ status: 'pending', metadata: { userId: 'A' } });
    mocks.get.mockImplementation(async (collection: string) => ({ exists: collection === 'signup_checkouts', data: () => ({ reference: 'server-session' }) }));
    mocks.session.mockResolvedValue('failed');
    expect(await (await GET(request())).json()).toEqual({ status: 'failed' });
  });
  it('handles cancellation without granting access', async () => {
    expect(await (await GET(request('cancelled=true'))).json()).toEqual({ status: 'cancelled' });
  });
  it('waits for a pending payment even when a tenant exists', async () => {
    mocks.subscription.mockResolvedValue({ status: 'pending', metadata: { userId: 'A' } });
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ tenantId: 'tenant-A' }) });
    expect(await (await GET(request())).json()).toEqual({ status: 'pending' });
  });
  it('continues only after Dodo is active and the webhook has assigned the tenant', async () => {
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ tenantId: 'tenant-A' }) });
    expect(await (await GET(request())).json()).toEqual({ status: 'ready', tenantId: 'tenant-A' });
    expect(mocks.get).toHaveBeenCalledWith('tenants', 'tenant-A');
  });
  it('supports return without an id after the webhook using private subscription data', async () => {
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ tenantId: 'tenant-A' }) });
    expect(await (await GET(request('dodo=success'))).json()).toEqual({ status: 'ready', tenantId: 'tenant-A' });
    expect(mocks.subscription).toHaveBeenCalledWith('sub-A');
  });
  it('user A cannot check user B subscription or read tenant B', async () => {
    mocks.subscription.mockResolvedValue({ status: 'active', metadata: { userId: 'B' } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalledWith('tenants', expect.anything());
  });
  it('API failure is visible, never a false pending or success', async () => {
    mocks.subscription.mockRejectedValue(new Error('offline'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty('error');
  });
});
