import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { verifyAuth, assertAdminConfigured, recordOptOut } = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  assertAdminConfigured: vi.fn(),
  recordOptOut: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  AdminNotConfiguredError: class extends Error {},
  assertAdminConfigured,
  adminDb: {},
  adminAuth: {},
}));
vi.mock('@/lib/api-auth', () => ({ verifyAuth }));
vi.mock('@/lib/email/firestore-store', () => ({ firestoreEmailStore: { recordOptOut } }));
vi.mock('@/lib/email/firestore-confirm', () => ({ firestoreEmailLedger: () => ({}) }));
const dispatch = vi.hoisted(() => vi.fn(async () => ({ status: 200, body: { ok: true } })));
vi.mock('@/lib/email/dispatch', async (orig) => ({ ...(await orig<typeof import('@/lib/email/dispatch')>()), dispatchEmailAction: dispatch }));

const actions = await import('../actions/route');
const unsub = await import('../unsubscribe/route');
const { signUnsubscribe } = await import('@/lib/email/unsubscribe');

const post = (body: unknown) =>
  new NextRequest('https://theharvest.app/api/email/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  assertAdminConfigured.mockImplementation(() => {});
  verifyAuth.mockResolvedValue({ uid: 'u', email: 'a@x.org', tenantId: 'grace', isAdmin: true, isSuperAdmin: false });
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';
  delete process.env.PLUNK_API_KEY;
});

describe('POST /api/email/actions', () => {
  it.each(['send', 'sendTest', 'domain'])('%s answers a clean 503 JSON when PLUNK_API_KEY is missing', async (action) => {
    const res = await actions.POST(post({ action, id: 'b1', mode: 'preview', when: { mode: 'now' } }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_configured' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('actions that never reach the vendor still work without the key', async () => {
    const res = await actions.POST(post({ action: 'overview' }));
    expect(res.status).toBe(200);
  });

  it('requires sign-in', async () => {
    verifyAuth.mockResolvedValue(null);
    expect((await actions.POST(post({ action: 'overview' }))).status).toBe(401);
  });

  it('rejects a non-JSON body', async () => {
    const res = await actions.POST(new NextRequest('https://theharvest.app/api/email/actions', { method: 'POST', body: 'nope' }));
    expect(res.status).toBe(400);
  });
});

describe('/api/email/unsubscribe', () => {
  const url = (t: string) => `https://theharvest.app/api/email/unsubscribe?t=${encodeURIComponent(t)}`;
  const token = () => signUnsubscribe({ tenantId: 'grace', email: 'a@x.org', broadcastId: 'b1' });

  it('one-click POST records the opt-out without a login', async () => {
    const res = await unsub.POST(new NextRequest(url(token()), { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(recordOptOut).toHaveBeenCalledWith('grace', 'a@x.org', 'b1', expect.any(String));
    expect(verifyAuth).not.toHaveBeenCalled();
  });

  it('the visible link unsubscribes on GET', async () => {
    const res = await unsub.GET(new NextRequest(url(token())));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('unsubscribed');
    expect(recordOptOut).toHaveBeenCalledTimes(1);
  });

  it('a forged or missing token changes nothing', async () => {
    expect((await unsub.POST(new NextRequest(url(`${token()}x`), { method: 'POST' }))).status).toBe(400);
    expect((await unsub.GET(new NextRequest('https://theharvest.app/api/email/unsubscribe'))).status).toBe(400);
    expect(recordOptOut).not.toHaveBeenCalled();
  });

  it('a storage failure is reported, never shown as unsubscribed', async () => {
    recordOptOut.mockRejectedValueOnce(new Error('down'));
    expect((await unsub.POST(new NextRequest(url(token()), { method: 'POST' }))).status).toBe(503);
    recordOptOut.mockRejectedValueOnce(new Error('down'));
    const res = await unsub.GET(new NextRequest(url(token())));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('You are unsubscribed');
  });
});
