import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  tenant: { current: null as Record<string, unknown> | null },
  attempts: { current: 0 },
  added: [] as unknown[],
  store: {
    getTenant: vi.fn(async () => ({ name: 'Grace Church' })),
    findContacts: vi.fn(async () => []),
    createPending: vi.fn(async () => 'c1'),
    refreshPending: vi.fn(),
    getPending: vi.fn(),
    confirm: vi.fn(),
  },
  send: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      where: () => ({ where: () => ({ limit: () => ({ get: async () => ({ size: h.attempts.current }) }) }) }),
      add: async (doc: unknown) => { h.added.push(doc); return { id: 'a1' }; },
    }),
  },
}));
vi.mock('@/lib/server-tenant', () => ({ getTenantFromHost: async () => h.tenant.current }));
vi.mock('@/lib/email/subscribe-store', () => ({ firestoreSubscribeStore: h.store }));
vi.mock('@/lib/transactional-email', () => ({ sendTransactionalEmail: h.send }));

import { POST } from '@/app/api/email/subscribe/route';

const call = (body: unknown, host = 'grace.theharvest.app') =>
  POST(new NextRequest(`https://${host}/api/email/subscribe`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));

beforeEach(() => {
  h.tenant.current = { id: 'grace', name: 'Grace Church', plan: 'ministry' };
  h.attempts.current = 0;
  h.added.length = 0;
  vi.clearAllMocks();
});

describe('POST /api/email/subscribe', () => {
  it('takes the ministry from the HOST and ignores a tenantId in the body', async () => {
    const res = await call({ name: 'Ana', email: 'ana@x.org', tenantId: 'other-ministry' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.store.createPending).toHaveBeenCalledWith('grace', expect.objectContaining({ email: 'ana@x.org' }));
    expect(h.store.createPending).not.toHaveBeenCalledWith('other-ministry', expect.anything());
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'ana@x.org', churchName: 'Grace Church' }));
  });

  it('a filled honeypot gets the success answer and does nothing at all', async () => {
    const res = await call({ name: 'Bot', email: 'bot@x.org', website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(h.store.createPending).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('answers 404 for a host that is no ministry', async () => {
    h.tenant.current = null;
    expect((await call({ name: 'Ana', email: 'ana@x.org' }, 'www.theharvest.app')).status).toBe(404);
    expect(h.store.createPending).not.toHaveBeenCalled();
  });

  it('answers 404 for a ministry whose plan does not include the newsletter', async () => {
    h.tenant.current = { id: 'grace', name: 'Grace Church', plan: 'free' };
    expect((await call({ name: 'Ana', email: 'ana@x.org' })).status).toBe(404);
    expect(h.store.createPending).not.toHaveBeenCalled();
  });

  it.each([
    ['max', 200],
    ['pro', 404],
    ['plus', 404],
  ])('reads a stored legacy %s as the tier it became (newsletter answers %i)', async (legacy, status) => {
    h.tenant.current = { id: 'grace', name: 'Grace Church', plan: legacy };
    expect((await call({ name: 'Ana', email: 'ana@x.org' })).status).toBe(status);
  });

  it('answers 429 over the rate limit and writes nothing', async () => {
    h.attempts.current = 5;
    expect((await call({ name: 'Ana', email: 'ana@x.org' })).status).toBe(429);
    expect(h.store.createPending).not.toHaveBeenCalled();
  });

  it('answers 400 for a bad address and 400 for a body that is not JSON', async () => {
    expect((await call({ name: 'Ana', email: 'nope' })).status).toBe(400);
    expect((await call('{not json')).status).toBe(400);
  });

  it('answers 502 when the confirmation email could not be sent, so the visitor is not told to check their inbox', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.send.mockResolvedValueOnce({ ok: false });
    const res = await call({ name: 'Ana', email: 'ana@x.org' });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('send_failed');
  });
});
