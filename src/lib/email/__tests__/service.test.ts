import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
process.env.PLUNK_API_KEY = 'test-key';
process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';

const { build, admin, person, mockProvider, TENANT } = await import('./helpers');
const { verifyUnsubscribe } = await import('@/lib/email/unsubscribe');

const draft = { subject: 'Sunday', bodyHtml: '<p>Hi {{first_name}}, see you Sunday.</p>', preheader: 'Doors at 9' };

async function drafted(seed: Parameters<typeof build>[0] = {}, provider = mockProvider()) {
  const ctx = build(seed, provider);
  const saved = await ctx.service.saveDraft(admin, TENANT, draft);
  if (!saved.ok) throw new Error('draft failed');
  return { ...ctx, id: saved.broadcast.id };
}

async function sendNow(ctx: Awaited<ReturnType<typeof drafted>>) {
  const preview = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'preview' });
  if (!preview.ok || !('confirmToken' in preview)) throw new Error('no preview');
  return ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'confirm', confirmToken: preview.confirmToken });
}

describe('plan gating', () => {
  it.each(['free', 'plus'])('%s cannot use email', async (plan) => {
    const { service } = build({ plan });
    const r = await service.saveDraft(admin, TENANT, draft);
    expect(r).toMatchObject({ ok: false, error: 'plan_required' });
  });

  it('pro can, and a super admin bypasses the plan', async () => {
    expect((await build({ plan: 'pro' }).service.saveDraft(admin, TENANT, draft)).ok).toBe(true);
    const root = { ...admin, uid: 'root', isSuperAdmin: true, tenantId: null };
    expect((await build({ plan: 'free' }).service.saveDraft(root, TENANT, draft)).ok).toBe(true);
  });

  it('another ministry is refused', async () => {
    const r = await build().service.saveDraft({ ...admin, tenantId: 'other' }, TENANT, draft);
    expect(r).toMatchObject({ ok: false, error: 'cross_tenant' });
  });
});

describe('send: preview then confirm', () => {
  let ctx: Awaited<ReturnType<typeof drafted>>;
  beforeEach(async () => {
    ctx = await drafted({ contacts: [person('a@x.org'), person('b@x.org')] });
  });

  it('preview writes and sends nothing', async () => {
    const r = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'preview' });
    expect(r).toMatchObject({ ok: true, requiresConfirm: true, preview: { recipientCount: 2 } });
    expect(ctx.provider.sent).toHaveLength(0);
    expect(ctx.mem.broadcasts.get(ctx.id)?.status).toBe('draft');
  });

  it('confirm without a token does not send', async () => {
    const r = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'confirm' });
    expect(r).toMatchObject({ ok: false, error: 'confirm_required' });
    expect(ctx.provider.sent).toHaveLength(0);
  });

  it('a token is single use', async () => {
    const p = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'preview' });
    if (!p.ok || !('confirmToken' in p)) throw new Error();
    const args = { id: ctx.id, when: { mode: 'now' as const }, mode: 'confirm' as const, confirmToken: p.confirmToken };
    expect((await ctx.service.send(admin, TENANT, args)).ok).toBe(true);
    expect(ctx.provider.sent).toHaveLength(2);
  });

  it('editing the email after the preview invalidates the token', async () => {
    const p = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'preview' });
    if (!p.ok || !('confirmToken' in p)) throw new Error();
    await ctx.service.saveDraft(admin, TENANT, { id: ctx.id, bodyHtml: '<p>Different</p>' });
    const r = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'confirm', confirmToken: p.confirmToken });
    expect(r).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(ctx.provider.sent).toHaveLength(0);
  });

  it('a token cannot be replayed by someone else', async () => {
    const p = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'preview' });
    if (!p.ok || !('confirmToken' in p)) throw new Error();
    const r = await ctx.service.send({ ...admin, uid: 'mallory', email: 'm@grace.org' }, TENANT, { id: ctx.id, when: { mode: 'now' }, mode: 'confirm', confirmToken: p.confirmToken });
    expect(r.ok).toBe(false);
  });

  it('schedule needs a future time and queues on confirm', async () => {
    const past = await ctx.service.send(admin, TENANT, { id: ctx.id, when: { mode: 'at', at: '2031-03-10T11:00:00.000Z' }, mode: 'preview' });
    expect(past).toMatchObject({ ok: false, error: 'time_not_future' });
    const when = { mode: 'at' as const, at: '2031-03-12T09:00:00.000Z' };
    const p = await ctx.service.send(admin, TENANT, { id: ctx.id, when, mode: 'preview' });
    if (!p.ok || !('confirmToken' in p)) throw new Error();
    const done = await ctx.service.send(admin, TENANT, { id: ctx.id, when, mode: 'confirm', confirmToken: p.confirmToken });
    expect(done).toMatchObject({ ok: true, outcome: 'scheduled' });
    expect(ctx.mem.queue.size).toBe(1);
    expect(ctx.provider.sent).toHaveLength(0);
  });

  it('refuses until sender details and a verified domain exist', async () => {
    const c = await drafted({ contacts: [person('a@x.org')], settings: { domainState: 'pending' } });
    const r = await c.service.send(admin, TENANT, { id: c.id, when: { mode: 'now' }, mode: 'preview' });
    expect(r).toMatchObject({ ok: false, error: 'sender_not_ready' });
  });
});

describe('suppression, opt-out and one-click unsubscribe', () => {
  it('never sends to unsubscribed, bounced, complained or never-opted-in contacts', async () => {
    const c = await drafted({
      contacts: [
        person('ok@x.org'),
        person('unsub@x.org', { status: 'unsubscribed' }),
        person('bounce@x.org', { status: 'bounced' }),
        person('spam@x.org', { status: 'complained' }),
        person('never@x.org', { status: 'none' }),
      ],
    });
    const r = await sendNow(c);
    expect(r).toMatchObject({ ok: true, outcome: 'sent', preview: { recipientCount: 1, skipped: { suppressed: 3, notOptedIn: 1 } } });
    expect(c.provider.sent.map((m) => m.to)).toEqual(['ok@x.org']);
  });

  it('an address suppressed on any duplicate CRM record stays suppressed', async () => {
    const c = await drafted({ contacts: [person('dup@x.org', { id: 'a' }), person('dup@x.org', { id: 'b', status: 'unsubscribed' }), person('ok@x.org')] });
    await sendNow(c);
    expect(c.provider.sent.map((m) => m.to)).toEqual(['ok@x.org']);
  });

  it('every email carries a working signed unsubscribe link and the one-click headers', async () => {
    const c = await drafted({ contacts: [person('a@x.org')] });
    await sendNow(c);
    const mail = c.provider.sent[0];
    const url = /<(https:[^>]+)>/.exec(mail.headers['List-Unsubscribe'])?.[1] ?? '';
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.html).toContain(url.replace(/&/g, '&amp;'));
    expect(mail.text).toContain(url);
    const token = new URL(url).searchParams.get('t') ?? '';
    expect(verifyUnsubscribe(token)).toEqual({ tenantId: TENANT, email: 'a@x.org', broadcastId: c.id });
    expect(verifyUnsubscribe(`${token}x`)).toBeNull();
  });

  it('opting out updates the same CRM record and the next send skips it', async () => {
    const c = await drafted({ contacts: [person('a@x.org'), person('b@x.org')] });
    await c.service.optOut(TENANT, 'A@x.org', c.id);
    expect(c.mem.contacts.get('c-a@x.org')?.status).toBe('unsubscribed');
    await sendNow(c);
    expect(c.provider.sent.map((m) => m.to)).toEqual(['b@x.org']);
  });
});

describe('volume cap and partial sends', () => {
  it('refuses a send that would pass the monthly cap', async () => {
    const c = await drafted({ contacts: [person('a@x.org'), person('b@x.org')], usage: 4999 });
    const r = await c.service.send(admin, TENANT, { id: c.id, when: { mode: 'now' }, mode: 'preview' });
    expect(r).toMatchObject({ ok: false, error: 'volume_cap' });
  });

  it('counts sends against the cap', async () => {
    const c = await drafted({ contacts: [person('a@x.org'), person('b@x.org')] });
    await sendNow(c);
    expect(c.mem.used).toBe(2);
  });

  it('a partial send is recorded and reported, never shown as success', async () => {
    const c = await drafted({ contacts: [person('a@x.org'), person('b@x.org')] }, mockProvider({ failFor: new Set(['b@x.org']) }));
    const r = await sendNow(c);
    expect(r).toMatchObject({ ok: true, outcome: 'partial', stats: { sent: 1, failed: 1 } });
    const stored = c.mem.broadcasts.get(c.id);
    expect(stored?.status).toBe('partial');
    expect(stored?.error).toMatch(/1 of 2/);
    expect(c.mem.used).toBe(1);
  });

  it('a total failure is failed, not sent', async () => {
    const c = await drafted({ contacts: [person('a@x.org')] }, mockProvider({ failFor: new Set(['a@x.org']) }));
    expect(await sendNow(c)).toMatchObject({ ok: true, outcome: 'failed' });
  });
});

describe('CSV import merges into the CRM', () => {
  it('creates new CRM people, merges existing ones and never re-subscribes the unsubscribed', async () => {
    const { service, mem } = build({
      contacts: [
        person('known@x.org', { status: 'none', tags: ['youth'] }),
        person('gone@x.org', { status: 'unsubscribed' }),
        person('already@x.org'),
      ],
    });
    const r = await service.importContacts(admin, TENANT, {
      consentConfirmed: true,
      rows: [
        { email: 'New@X.org', name: 'Ruth Lee', tags: ['women'] },
        { email: 'known@x.org', tags: ['alpha'] },
        { email: 'gone@x.org' },
        { email: 'already@x.org' },
        { email: 'new@x.org' },
        { email: 'not-an-email' },
      ],
    });
    expect(r).toMatchObject({ ok: true, added: 1, merged: 1, blocked: 1, alreadySubscribed: 1, invalid: 1, repeatedInFile: 1 });
    expect(mem.created[0]).toMatchObject({ email: 'new@x.org', firstName: 'Ruth', lastName: 'Lee', source: 'import' });
    expect(mem.contacts.get('c-known@x.org')).toMatchObject({ status: 'subscribed', tags: ['youth', 'alpha'] });
    expect(mem.contacts.get('c-gone@x.org')?.status).toBe('unsubscribed');
  });

  it('requires the consent confirmation', async () => {
    const r = await build().service.importContacts(admin, TENANT, { consentConfirmed: false, rows: [{ email: 'a@x.org' }] });
    expect(r).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('scheduled sends (cron)', () => {
  it('sends due broadcasts, re-reading suppression at send time', async () => {
    const c = await drafted({ contacts: [person('a@x.org'), person('b@x.org')] });
    const when = { mode: 'at' as const, at: '2031-03-10T12:30:00.000Z' };
    const p = await c.service.send(admin, TENANT, { id: c.id, when, mode: 'preview' });
    if (!p.ok || !('confirmToken' in p)) throw new Error();
    await c.service.send(admin, TENANT, { id: c.id, when, mode: 'confirm', confirmToken: p.confirmToken });
    await c.service.optOut(TENANT, 'a@x.org', c.id);
    c.mem.queue.set(`${TENANT}__${c.id}`, '2031-03-10T00:00:00.000Z');
    const results = await c.service.runDue();
    expect(results[0]).toMatchObject({ outcome: 'sent' });
    expect(c.provider.sent.map((m) => m.to)).toEqual(['b@x.org']);
  });

  it('a plan that no longer includes email fails the broadcast instead of sending', async () => {
    const c = await drafted({ contacts: [person('a@x.org')] });
    const b = c.mem.broadcasts.get(c.id)!;
    c.mem.broadcasts.set(c.id, { ...b, status: 'scheduled' });
    c.mem.queue.set(`${TENANT}__${c.id}`, '2031-03-10T00:00:00.000Z');
    const free = build({ plan: 'free', contacts: [person('a@x.org')] });
    free.mem.broadcasts.set(c.id, { ...b, status: 'scheduled' });
    free.mem.queue.set(`${TENANT}__${c.id}`, '2031-03-10T00:00:00.000Z');
    const results = await free.service.runDue();
    expect(results[0].outcome).toBe('failed');
    expect(free.provider.sent).toHaveLength(0);
  });
});
