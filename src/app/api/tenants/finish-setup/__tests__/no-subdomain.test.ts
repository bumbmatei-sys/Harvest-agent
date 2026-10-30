import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), update: vi.fn(), doc: vi.fn(), private: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mock.auth }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: () => ({ doc: mock.doc }) } }));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mock.private }));
import { POST } from '../route';
beforeEach(() => {
  vi.resetAllMocks();
  mock.auth.mockResolvedValue({ uid: 'A', tenantId: 'tenant-A', email: 'a@example.org', isAdmin: true });
  mock.private.mockResolvedValue({ adminEmails: ['a@example.org'] });
  mock.doc.mockImplementation(() => ({ get: mock.get, update: mock.update }));
});
describe('first run never claims a website address', () => {
  it.each(['free', 'church', 'ministry'])('%s completes with the same internal identity and no subdomain write', async plan => {
    mock.get.mockResolvedValue({ exists: true, data: () => ({ plan, setupCompleted: false }) });
    const response = await POST(new NextRequest('https://theharvest.app/api/tenants/finish-setup', { method: 'POST', body: JSON.stringify({ subdomain: 'claim-someone-elses-host' }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantId: 'tenant-A' });
    expect(mock.doc.mock.calls).toEqual([['tenant-A']]);
    expect(mock.update).toHaveBeenCalledWith({ setupCompleted: true, updatedAt: expect.any(String) });
  });
  it('membership in a tenant does not confer permission to complete its setup', async () => {
    mock.auth.mockResolvedValue({ uid: 'B', tenantId: 'tenant-A', email: 'b@example.org', isAdmin: false });
    mock.get.mockResolvedValue({ exists: true });
    expect((await POST(new NextRequest('https://theharvest.app/api/tenants/finish-setup', { method: 'POST' }))).status).toBe(403);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
