import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const m = vi.hoisted(() => ({
  tenantForSender: vi.fn(async (_from: string): Promise<string | null> => 'grace'),
  recordFeedback: vi.fn(async () => true),
  recordOptOut: vi.fn(async () => undefined),
  getTenant: vi.fn(async (_id: string): Promise<{ name: string } | null> => ({ name: 'Grace Church' })),
  assertAdminConfigured: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ AdminNotConfiguredError: class extends Error {}, assertAdminConfigured: m.assertAdminConfigured, adminDb: {}, adminAuth: {} }));
vi.mock('@/lib/email/runtime', () => ({ buildEmailService: () => ({ tenantForSender: m.tenantForSender, recordFeedback: m.recordFeedback }) }));
vi.mock('@/lib/email/firestore-store', () => ({ firestoreEmailStore: { recordOptOut: m.recordOptOut, getTenant: m.getTenant } }));

process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';
const webhook = await import('../webhook/route');
const unsub = await import('../unsubscribe/route');
const { verifyWebhookSecret, parseFeedback, feedbackEventKey } = await import('@/lib/email/webhook');
const { signUnsubscribe } = await import('@/lib/email/unsubscribe');
const { renderUnsubscribePage } = await import('@/lib/email/unsubscribe-page');
const { BRAND_PALETTE } = await import('@/lib/email/render');

const SECRET = 'whsec-0123456789abcdef';
const hook = (kind: string | null, body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  new NextRequest(`https://theharvest.app/api/email/webhook${kind ? `?kind=${kind}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Plunk's default webhook body for a workflow step: contact, workflow, execution, event. */
const plunkBody = (event: Record<string, unknown> = {}) => ({
  contact: { email: 'Jane@Example.org', subscribed: false, data: {} },
  workflow: { id: 'wf_1', name: 'Bounces' },
  execution: { id: 'ex_1', startedAt: '2031-03-10T12:00:00.000Z' },
  event: { subject: 'Hi', from: 'hello@mail.grace.org', fromName: 'Grace', emailId: 'em_1', bounceType: 'Permanent', ...event },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.PLUNK_WEBHOOK_SECRET = SECRET;
  m.tenantForSender.mockResolvedValue('grace');
  m.recordFeedback.mockResolvedValue(true);
  m.getTenant.mockResolvedValue({ name: 'Grace Church' });
});

describe('webhook secret', () => {
  it('accepts the exact secret and nothing else, including a wrong secret of the same length', () => {
    expect(verifyWebhookSecret(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(verifyWebhookSecret(`bearer ${SECRET}`, SECRET)).toBe(true);
    const sameLength = `${SECRET.slice(0, -1)}${SECRET.endsWith('f') ? '0' : 'f'}`;
    expect(sameLength).toHaveLength(SECRET.length);
    expect(verifyWebhookSecret(`Bearer ${sameLength}`, SECRET)).toBe(false);
    expect(verifyWebhookSecret(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(verifyWebhookSecret(SECRET, SECRET)).toBe(false);
    expect(verifyWebhookSecret(null, SECRET)).toBe(false);
    expect(verifyWebhookSecret('Bearer ', SECRET)).toBe(false);
  });

  it('never accepts anything when no secret is configured', () => {
    expect(verifyWebhookSecret('Bearer ', '')).toBe(false);
    expect(verifyWebhookSecret('Bearer anything', '')).toBe(false);
  });
});

describe('POST /api/email/webhook', () => {
  it('records a permanent bounce for the ministry that owns the sending domain', async () => {
    const res = await webhook.POST(hook('bounce', plunkBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: true });
    expect(m.tenantForSender).toHaveBeenCalledWith('hello@mail.grace.org');
    expect(m.recordFeedback).toHaveBeenCalledWith('grace', 'Jane@Example.org', 'bounced', 'em_1');
  });

  it('records a complaint', async () => {
    await webhook.POST(hook('complaint', plunkBody({ bounceType: undefined })));
    expect(m.recordFeedback).toHaveBeenCalledWith('grace', 'Jane@Example.org', 'complained', 'em_1');
  });

  it('also reads a flat body written for the webhook step', async () => {
    await webhook.POST(hook('bounce', { email: 'a@x.org', from: 'hello@mail.grace.org', emailId: 'em_7', bounceType: 'Permanent' }));
    expect(m.recordFeedback).toHaveBeenCalledWith('grace', 'a@x.org', 'bounced', 'em_7');
  });

  it('refuses without the secret, with a wrong one, or with no header, and writes nothing', async () => {
    for (const auth of [null, 'Bearer nope', `Bearer ${SECRET}x`, SECRET]) {
      expect((await webhook.POST(hook('bounce', plunkBody(), auth))).status).toBe(401);
    }
    expect(m.recordFeedback).not.toHaveBeenCalled();
    expect(m.tenantForSender).not.toHaveBeenCalled();
  });

  it('fails closed with a 503 when PLUNK_WEBHOOK_SECRET is not set, even for a request that sends no secret', async () => {
    delete process.env.PLUNK_WEBHOOK_SECRET;
    expect((await webhook.POST(hook('bounce', plunkBody(), 'Bearer '))).status).toBe(503);
    expect((await webhook.POST(hook('bounce', plunkBody()))).status).toBe(503);
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('PLUNK_WEBHOOK_SECRET');
    expect(m.recordFeedback).not.toHaveBeenCalled();
  });

  it('needs kind=bounce or kind=complaint', async () => {
    expect((await webhook.POST(hook(null, plunkBody()))).status).toBe(400);
    expect((await webhook.POST(hook('open', plunkBody()))).status).toBe(400);
  });

  it('rejects a body that is not JSON, one without the contact or sender, and one that is too large', async () => {
    expect((await webhook.POST(hook('bounce', 'not json'))).status).toBe(400);
    expect((await webhook.POST(hook('bounce', { contact: {}, event: {} }))).status).toBe(400);
    expect((await webhook.POST(hook('bounce', { email: 'a@x.org' }))).status).toBe(400);
    expect((await webhook.POST(hook('bounce', JSON.stringify({ pad: 'x'.repeat(70_000) })))).status).toBe(413);
    expect(m.recordFeedback).not.toHaveBeenCalled();
  });

  it('ignores a soft bounce: nobody is suppressed and nothing is counted', async () => {
    const res = await webhook.POST(hook('bounce', plunkBody({ bounceType: 'Transient' })));
    expect(await res.json()).toMatchObject({ ok: true, applied: false, reason: 'transient' });
    expect(m.recordFeedback).not.toHaveBeenCalled();
  });

  it('treats an unknown bounce type as permanent, as Plunk does', async () => {
    await webhook.POST(hook('bounce', plunkBody({ bounceType: 'Undetermined' })));
    expect(m.recordFeedback).toHaveBeenCalledTimes(1);
  });

  it('acts on no ministry when the sending domain belongs to none', async () => {
    m.tenantForSender.mockResolvedValue(null);
    const res = await webhook.POST(hook('bounce', plunkBody({ from: 'noreply@theharvest.app' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: false, reason: 'unattributed' });
    expect(m.recordFeedback).not.toHaveBeenCalled();
  });

  it('a redelivered event is acknowledged and not counted again', async () => {
    m.recordFeedback.mockResolvedValue(false);
    expect(await (await webhook.POST(hook('bounce', plunkBody()))).json()).toMatchObject({ ok: true, applied: false, reason: 'duplicate' });
  });

  it('a storage failure is a 500 so the failure is visible, never a quiet success', async () => {
    m.recordFeedback.mockRejectedValueOnce(new Error('firestore down'));
    expect((await webhook.POST(hook('bounce', plunkBody()))).status).toBe(500);
  });

  it('keeps working while the newsletter switch is off, like unsubscribe', async () => {
    // the route does not read the switch at all: protective suppression of mail already sent
    expect((await webhook.POST(hook('bounce', plunkBody()))).status).toBe(200);
  });
});

describe('feedback parsing', () => {
  it('reads Plunk\'s default body and a flat body', () => {
    expect(parseFeedback(plunkBody())).toEqual({ email: 'Jane@Example.org', from: 'hello@mail.grace.org', emailId: 'em_1', bounceType: 'Permanent' });
    expect(parseFeedback({ email: 'a@x.org', from: 'h@mail.g.org' })).toEqual({ email: 'a@x.org', from: 'h@mail.g.org', emailId: null, bounceType: null });
    expect(parseFeedback(null)).toBeNull();
    expect(parseFeedback([])).toBeNull();
    expect(parseFeedback({ contact: { email: 3 }, event: { from: 'a' } })).toBeNull();
  });

  it('without an email id one address counts once a month', () => {
    const fb = { email: 'A@x.org', from: 'h@m.g.org', emailId: null, bounceType: null };
    expect(feedbackEventKey(fb, '2031-03')).toBe(feedbackEventKey({ ...fb, email: 'a@X.org' }, '2031-03'));
    expect(feedbackEventKey(fb, '2031-03')).not.toBe(feedbackEventKey(fb, '2031-04'));
    expect(feedbackEventKey({ ...fb, emailId: 'em_9' }, '2031-03')).toBe('em_9');
  });
});

describe('the unsubscribe page', () => {
  const url = (t: string) => `https://theharvest.app/api/email/unsubscribe?t=${encodeURIComponent(t)}`;
  const token = () => signUnsubscribe({ tenantId: 'grace', email: 'a@x.org', broadcastId: 'b1' });

  it('names the ministry the link came from, on the confirm page and on the result page', async () => {
    const confirm = await (await unsub.GET(new NextRequest(url(token())))).text();
    expect(confirm).toContain('Unsubscribe from Grace Church?');
    expect(confirm).toContain('<form method="post"');
    expect(m.getTenant).toHaveBeenCalledWith('grace');
    const done = await (await unsub.POST(new NextRequest(url(token()), { method: 'POST', body: 'view=page', headers: { 'content-type': 'application/x-www-form-urlencoded' } }))).text();
    expect(done).toContain('You are unsubscribed');
    expect(done).toContain('Grace Church will not send you any more emails');
  });

  it('is navy and gold, and switches to a dark scheme with the reader\'s setting', async () => {
    const html = await (await unsub.GET(new NextRequest(url(token())))).text();
    for (const hex of [BRAND_PALETTE.navy900, BRAND_PALETTE.navy950, BRAND_PALETTE.navy800, BRAND_PALETTE.gold500]) expect(html.toUpperCase()).toContain(hex.toUpperCase());
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html).toContain('color-scheme');
    expect(html).toMatch(/min-height:44px/);
  });

  it('shows a generic page, still branded, when the ministry cannot be read, and still unsubscribes', async () => {
    m.getTenant.mockRejectedValue(new Error('firestore down'));
    const confirm = await unsub.GET(new NextRequest(url(token())));
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain('Unsubscribe from this list?');
    const done = await unsub.POST(new NextRequest(url(token()), { method: 'POST', body: 'view=page', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(done.status).toBe(200);
    expect(m.recordOptOut).toHaveBeenCalledTimes(1);
  });

  it('a ministry name is escaped, never injected as markup', () => {
    const html = renderUnsubscribePage({ title: 'Unsubscribe from <img src=x onerror=alert(1)>?', body: 'a "quote" & more', ministry: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('the one-click POST for a mail client is unchanged: JSON, no page', async () => {
    const res = await unsub.POST(new NextRequest(url(token()), { method: 'POST' }));
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(m.getTenant).not.toHaveBeenCalled();
  });
});
