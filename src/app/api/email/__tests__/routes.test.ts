import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { verifyAuth, assertAdminConfigured, recordOptOut, runDue, purgeExpired, flag } = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  assertAdminConfigured: vi.fn(),
  recordOptOut: vi.fn(),
  runDue: vi.fn(async () => [] as unknown[]),
  purgeExpired: vi.fn(async () => ({ tokens: 2, feedback: 0 })),
  flag: { enabled: true },
}));

vi.mock('@/lib/newsletter-feature', () => ({
  get NEWSLETTER_FEATURE_ENABLED() { return flag.enabled; },
  NEWSLETTER_HIDDEN_MESSAGE: 'Newsletter is temporarily unavailable.',
}));
vi.mock('@/lib/email/service', () => ({ createEmailService: () => ({ runDue, purgeExpired }) }));

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
const cron = await import('../cron/route');
const unsub = await import('../unsubscribe/route');
const { signUnsubscribe } = await import('@/lib/email/unsubscribe');

const post = (body: unknown) =>
  new NextRequest('https://theharvest.app/api/email/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  flag.enabled = true;
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

  it('answers 503 for every action while the newsletter switch is off, before auth or any read', async () => {
    flag.enabled = false;
    for (const action of ['overview', 'saveDraft', 'send', 'import', 'saveSettings', 'domain', 'sendTest', 'delete']) {
      const res = await actions.POST(post({ action, id: 'b1', mode: 'confirm', when: { mode: 'now' } }));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, error: 'newsletter_hidden', message: 'Newsletter is temporarily unavailable.' });
    }
    expect(verifyAuth).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a send is refused with a clear 503 when EMAIL_UNSUBSCRIBE_SECRET is missing (no fallback to the vendor key)', async () => {
    process.env.PLUNK_API_KEY = 'vendor-key';
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    const res = await actions.POST(post({ action: 'send', id: 'b1', mode: 'preview', when: { mode: 'now' } }));
    expect(res.status).toBe(503);
    expect(dispatch).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('EMAIL_UNSUBSCRIBE_SECRET');
  });

  it('a vendor that does not answer is a 502 with a plain message, not a 500', async () => {
    process.env.PLUNK_API_KEY = 'vendor-key';
    const { EmailProviderError } = await import('@/lib/email/provider');
    dispatch.mockRejectedValueOnce(new EmailProviderError('Plunk did not answer within 15 seconds.', 'timeout'));
    const res = await actions.POST(post({ action: 'domain', op: 'check' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: 'provider_unavailable' });
    expect(body.message).not.toMatch(/Plunk/);
  });

  it('rejects a non-JSON body', async () => {
    const res = await actions.POST(new NextRequest('https://theharvest.app/api/email/actions', { method: 'POST', body: 'nope' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/email/cron', () => {
  const req = () => new NextRequest('https://theharvest.app/api/email/cron', { headers: { authorization: 'Bearer cron-secret' } });
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.PLUNK_API_KEY = 'vendor-key';
  });

  it('runs due sends when the switch is on', async () => {
    expect((await cron.GET(req())).status).toBe(200);
    expect(runDue).toHaveBeenCalledTimes(1);
  });

  it('cleans up expired confirm tokens after the sends and reports how many', async () => {
    const res = await cron.GET(req());
    expect(purgeExpired).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ purged: { tokens: 2 } });
  });

  it('a failed cleanup never fails or delays the sends', async () => {
    purgeExpired.mockRejectedValueOnce(new Error('firestore down'));
    const res = await cron.GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, purged: { error: 'purge_failed' } });
  });

  it('answers 503 and sends nothing while the switch is off, even with the right secret', async () => {
    flag.enabled = false;
    const res = await cron.GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'newsletter_hidden' });
    expect(runDue).not.toHaveBeenCalled();
    expect(purgeExpired).not.toHaveBeenCalled();
  });

  it('still rejects a wrong secret', async () => {
    expect((await cron.GET(new NextRequest('https://theharvest.app/api/email/cron', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    expect(runDue).not.toHaveBeenCalled();
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

  it('the visible link only asks: GET shows a confirm page and records nothing', async () => {
    const res = await unsub.GET(new NextRequest(url(token())));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form method="post"');
    expect(html).not.toContain('You are unsubscribed');
    expect(recordOptOut).not.toHaveBeenCalled();
  });

  it('pressing the button POSTs, and that performs the opt-out and shows the result page', async () => {
    const res = await unsub.POST(new NextRequest(url(token()), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'view=page' }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('You are unsubscribed');
    expect(recordOptOut).toHaveBeenCalledTimes(1);
  });

  it('a forged token on the confirm page is refused and nothing is written', async () => {
    const res = await unsub.GET(new NextRequest(url(`${token()}x`)));
    expect(res.status).toBe(400);
    expect(recordOptOut).not.toHaveBeenCalled();
  });

  it('a same-length forged MAC is refused by the route and writes nothing', async () => {
    const t = token();
    const [body, mac] = t.split('.');
    const flipped = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    expect(flipped).toHaveLength(mac.length);
    expect((await unsub.POST(new NextRequest(url(`${body}.${flipped}`), { method: 'POST' }))).status).toBe(400);
    expect((await unsub.GET(new NextRequest(url(`${body}.${flipped}`)))).status).toBe(400);
    expect(recordOptOut).not.toHaveBeenCalled();
  });

  it('a body swapped to another ministry or address under a valid-length MAC from a different token is refused', async () => {
    const [, otherMac] = signUnsubscribe({ tenantId: 'grace', email: 'victim@x.org', broadcastId: 'b1' }).split('.');
    const [, ownMac] = token().split('.');
    const swapped = (tenantId: string, email: string) => `${Buffer.from(JSON.stringify([tenantId, email, 'b1'])).toString('base64url')}`;
    for (const body of [swapped('other-church', 'a@x.org'), swapped('grace', 'victim2@x.org')]) {
      for (const mac of [otherMac, ownMac]) {
        expect(mac).toHaveLength(ownMac.length);
        expect((await unsub.POST(new NextRequest(url(`${body}.${mac}`), { method: 'POST' }))).status).toBe(400);
      }
    }
    expect(recordOptOut).not.toHaveBeenCalled();
  });

  it('unsubscribe keeps working while the newsletter switch is off', async () => {
    flag.enabled = false;
    expect((await unsub.POST(new NextRequest(url(token()), { method: 'POST' }))).status).toBe(200);
    expect(recordOptOut).toHaveBeenCalledTimes(1);
  });

  it('with no EMAIL_UNSUBSCRIBE_SECRET a link is never accepted, and the vendor key is not used instead', async () => {
    const good = token();
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    process.env.PLUNK_API_KEY = 'test-secret';
    expect((await unsub.POST(new NextRequest(url(good), { method: 'POST' }))).status).toBe(503);
    expect(recordOptOut).not.toHaveBeenCalled();
  });

  it('a storage failure is reported, never shown as unsubscribed', async () => {
    recordOptOut.mockRejectedValueOnce(new Error('down'));
    expect((await unsub.POST(new NextRequest(url(token()), { method: 'POST' }))).status).toBe(503);
    recordOptOut.mockRejectedValueOnce(new Error('down'));
    const res = await unsub.POST(new NextRequest(url(token()), { method: 'POST', body: 'view=page', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('You are unsubscribed');
  });
});

describe('POST /api/email/actions without database credentials', () => {
  it('says the database is unavailable, never that drafts can still be saved', async () => {
    assertAdminConfigured.mockImplementation(() => {
      const error = new Error('FIREBASE_SERVICE_ACCOUNT is not set; admin Firestore is unavailable.');
      error.name = 'AdminNotConfiguredError';
      throw error;
    });
    const res = await actions.POST(post({ action: 'overview' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: 'database_unavailable' });
    expect(body.message).toMatch(/not connected to the database/);
    expect(body.message).not.toMatch(/draft/i);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
