import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  userDoc: { role: 'church_admin', permissions: {} as Record<string, unknown> },
  privateDoc: { adminEmails: [] as string[] },
  tenantDoc: {
    plan: 'max',
    addons: { aiAssistant: 0, adminSeats: 0, unlimitedContacts: false, socialScheduler: 0 },
  } as Record<string, unknown>,
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: h.requireAuth,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: () => ({
        get: () => h.get(name),
        set: (...args: unknown[]) => h.set(name, ...args),
        update: (...args: unknown[]) => h.update(name, ...args),
      }),
    }),
  },
}));

import { requireSocialAccess } from '../access';
import { SOCIAL_SAMPLE_SCOPE } from '../mode';

const envKeys = ['VERCEL_ENV', 'ZERNIO_API_KEY', 'ZERNIO_SOCIAL_LIVE', 'ZERNIO_SOCIAL_MODE'] as const;

function call(headers?: Record<string, string>, url = 'http://localhost/api/social/bootstrap') {
  return requireSocialAccess(new NextRequest(url, { headers }));
}

describe('requireSocialAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) delete process.env[key];
    vi.stubEnv('NODE_ENV', 'test');
    h.userDoc = { role: 'church_admin', permissions: {} };
    h.privateDoc = { adminEmails: [] };
    h.tenantDoc = {
      plan: 'max',
      addons: { aiAssistant: 0, adminSeats: 0, unlimitedContacts: false, socialScheduler: 0 },
    };
    h.requireAuth.mockResolvedValue({
      uid: 'admin-1',
      email: 'owner@church.test',
      tenantId: 'tenant-a',
      isAdmin: true,
      isSuperAdmin: false,
      emailVerified: true,
    });
    h.get.mockImplementation(async (name: string) => {
      if (name === 'users') return { exists: true, data: () => h.userDoc };
      if (name === 'tenant_private') return { exists: true, data: () => h.privateDoc };
      if (name === 'tenants') return { exists: true, data: () => h.tenantDoc };
      return { exists: false, data: () => ({}) };
    });
  });

  it('refuses an unentitled production ministry', async () => {
    process.env.VERCEL_ENV = 'production';
    const response = await call();
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'social_scheduler_not_entitled' });
  });

  it('does not treat a header or query flag as the super-admin claim', async () => {
    process.env.VERCEL_ENV = 'production';
    const response = await call(
      { 'x-super-admin': 'true', 'x-harvest-super-admin': '1' },
      'http://localhost/api/social/bootstrap?superAdmin=true&isSuperAdmin=1',
    );
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'social_scheduler_not_entitled' });
    expect(h.set).not.toHaveBeenCalled();
  });

  it('refuses a limited admin who would not see Social in the nav', async () => {
    h.userDoc = { role: 'admin', permissions: { manageEvents: true } };
    const response = await call();
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Admin access required' });
    expect(h.get.mock.calls.map((callArgs) => callArgs[0])).not.toContain('tenants');
  });

  it('reaches the add-on wall for a roster admin without the add-on', async () => {
    process.env.VERCEL_ENV = 'production';
    h.requireAuth.mockResolvedValue({
      uid: 'roster-1',
      email: 'owner@church.test',
      tenantId: 'tenant-a',
      isAdmin: false,
      isSuperAdmin: false,
      emailVerified: true,
    });
    h.userDoc = { role: 'user', permissions: {} };
    h.privateDoc = { adminEmails: ['owner@church.test'] };
    const response = await call();
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(await response.json()).toEqual({ error: 'social_scheduler_not_entitled' });
  });

  it('opens the sample workspace on preview without reading a live profile', async () => {
    process.env.VERCEL_ENV = 'preview';
    vi.stubEnv('NODE_ENV', 'production');
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    const response = await call();
    expect(response).toEqual({ tenantId: 'tenant-a', entitled: false, sample: true, mockOnly: true });
    expect(h.set).not.toHaveBeenCalled();
  });

  it('lifts a ministry that holds the count', async () => {
    h.tenantDoc = { plan: 'plus', addons: { socialScheduler: 1 } };
    const response = await call();
    expect(response).toMatchObject({ tenantId: 'tenant-a', entitled: true, sample: true });
    expect(h.set).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('refuses a header that names another ministry', async () => {
    const response = await call({ 'x-harvest-tenant': 'other-ministry' });
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(h.get).not.toHaveBeenCalled();
  });

  it('refuses a normal admin with no tenant', async () => {
    h.requireAuth.mockResolvedValue({
      uid: 'admin-1',
      tenantId: null,
      isAdmin: true,
      isSuperAdmin: false,
    });
    const response = await call();
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'No tenant associated with this account' });
    expect(h.get).not.toHaveBeenCalled();
  });

  it('lets a super admin through without the add-on and does not write it', async () => {
    h.requireAuth.mockResolvedValue({
      uid: 'super-1',
      email: 'bumbmatei@proton.me',
      tenantId: 'tenant-a',
      isAdmin: true,
      isSuperAdmin: true,
    });
    const response = await call();
    expect(response).toEqual({ tenantId: 'tenant-a', entitled: true, sample: true, mockOnly: true });
    expect(h.set).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('keeps a super admin entitled when production is live', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    process.env.ZERNIO_SOCIAL_MODE = 'mock';
    h.requireAuth.mockResolvedValue({
      uid: 'super-1',
      tenantId: 'tenant-a',
      isAdmin: true,
      isSuperAdmin: true,
    });
    const response = await call();
    expect(response).toEqual({ tenantId: 'tenant-a', entitled: true, sample: false, mockOnly: false });
    expect(h.set).not.toHaveBeenCalled();
  });

  it('answers 503 in production when the provider is not live, including for a super admin', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.ZERNIO_SOCIAL_MODE = 'sample';
    h.tenantDoc = { plan: 'plus', addons: { socialScheduler: 1 } };
    const entitled = await call();
    expect(entitled).toBeInstanceOf(NextResponse);
    if (!(entitled instanceof NextResponse)) return;
    expect(entitled.status).toBe(503);
    expect(await entitled.json()).toEqual({ error: 'social_unavailable' });

    h.requireAuth.mockResolvedValue({
      uid: 'super-1',
      tenantId: null,
      isAdmin: true,
      isSuperAdmin: true,
    });
    const tenantless = await call();
    expect(tenantless).toBeInstanceOf(NextResponse);
    if (!(tenantless instanceof NextResponse)) return;
    expect(tenantless.status).toBe(503);
    expect(h.set).not.toHaveBeenCalled();
  });

  it('serves the sample workspace to a super admin with no tenant on preview', async () => {
    process.env.VERCEL_ENV = 'preview';
    vi.stubEnv('NODE_ENV', 'production');
    process.env.ZERNIO_API_KEY = 'secret';
    process.env.ZERNIO_SOCIAL_LIVE = '1';
    process.env.ZERNIO_SOCIAL_MODE = 'mock';
    h.requireAuth.mockResolvedValue({
      uid: 'super-1',
      tenantId: null,
      isAdmin: true,
      isSuperAdmin: true,
    });
    const response = await call();
    expect(response).toEqual({
      tenantId: SOCIAL_SAMPLE_SCOPE,
      entitled: true,
      sample: true,
      mockOnly: true,
    });
    expect(h.get).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });

  it('does not let a tenantless super admin pick a ministry with a header', async () => {
    h.requireAuth.mockResolvedValue({
      uid: 'super-1',
      tenantId: null,
      isAdmin: true,
      isSuperAdmin: true,
    });
    const response = await call({ 'x-harvest-tenant': 'other-ministry' });
    expect(response).toBeInstanceOf(NextResponse);
    if (!(response instanceof NextResponse)) return;
    expect(response.status).toBe(403);
    expect(h.get).not.toHaveBeenCalled();
    expect(h.set).not.toHaveBeenCalled();
  });
});
