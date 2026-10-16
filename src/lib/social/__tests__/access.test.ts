import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireTenantAdmin: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAdmin: h.requireAdmin,
  requireTenantAdmin: h.requireTenantAdmin,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({ get: h.get }),
    }),
  },
}));

import { requireSocialAccess } from '../access';

const envKeys = ['VERCEL_ENV', 'ZERNIO_API_KEY', 'ZERNIO_SOCIAL_LIVE', 'ZERNIO_SOCIAL_MODE'] as const;

function call(headers?: Record<string, string>) {
  return requireSocialAccess(new NextRequest('http://localhost/api/social/bootstrap', { headers }));
}

describe('requireSocialAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) delete process.env[key];
    h.requireAdmin.mockResolvedValue({ tenantId: 'tenant-a', isAdmin: true, isSuperAdmin: false });
    h.requireTenantAdmin.mockResolvedValue({ tenantId: 'tenant-a', isAdmin: true });
    h.get.mockResolvedValue({
      exists: true,
      data: () => ({ plan: 'max', addons: { aiAssistant: 0, adminSeats: 0, unlimitedContacts: false, socialScheduler: 0 } }),
    });
  });

  it('refuses an unentitled production ministry', async () => {
    const response = await call();
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'social_scheduler_not_entitled' });
  });

  it('opens the sample workspace on preview without reading a live profile', async () => {
    process.env.VERCEL_ENV = 'preview';
    const response = await call();
    expect(response).not.toBeInstanceOf(NextResponse);
    if (response instanceof NextResponse) return;
    expect(response).toEqual({ tenantId: 'tenant-a', entitled: false, sample: true });
  });

  it('lifts a ministry that holds the count', async () => {
    h.get.mockResolvedValue({
      exists: true,
      data: () => ({ plan: 'plus', addons: { socialScheduler: 1 } }),
    });
    const response = await call();
    expect(response).toMatchObject({ tenantId: 'tenant-a', entitled: true, sample: true });
  });

  it('refuses a header that names another ministry', async () => {
    const response = await call({ 'x-harvest-tenant': 'other-ministry' });
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(h.requireTenantAdmin).not.toHaveBeenCalled();
  });

  it('refuses a super admin with no tenant', async () => {
    h.requireAdmin.mockResolvedValue({ tenantId: null, isSuperAdmin: true });
    const response = await call();
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'No tenant associated with this account' });
  });
});
