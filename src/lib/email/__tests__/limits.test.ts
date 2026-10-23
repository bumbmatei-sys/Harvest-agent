import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
process.env.PLUNK_API_KEY = 'test-key';
process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';

const { build, admin, person, mockProvider, TENANT, NOW } = await import('./helpers');
const { DEFAULT_EMAIL_LIMITS, resolveLimits, validateLimits } = await import('@/lib/email/limits');
const { dayKey, monthKey, decidePause, isNewChurch, percentUsed } = await import('@/lib/email/volume-cap');

const draft = { subject: 'Sunday', bodyHtml: '<p>Hi {{first_name}}, see you Sunday at church.</p>', preheader: 'Doors at 9' };
const many = (n: number) => Array.from({ length: n }, (_, i) => person(`p${i}@x.org`));

async function drafted(seed: Parameters<typeof build>[0] = {}, fallback: string | null = null, provider = mockProvider()) {
  const ctx = build({ contacts: [person('a@x.org'), person('b@x.org')], ...seed }, provider, fallback);
  const saved = await ctx.service.saveDraft(admin, TENANT, draft);
  if (!saved.ok) throw new Error('draft');
  return { ...ctx, id: saved.broadcast.id };
}
const preview = (c: Awaited<ReturnType<typeof drafted>>) => c.service.send(admin, TENANT, { id: c.id, when: { mode: 'now' }, mode: 'preview' });
async function sendNow(c: Awaited<ReturnType<typeof drafted>>) {
  const p = await preview(c);
  if (!p.ok || !('confirmToken' in p)) return p;
  return c.service.send(admin, TENANT, { id: c.id, when: { mode: 'now' }, mode: 'confirm', confirmToken: p.confirmToken });
}

describe('the allowance by plan comes from one config map', () => {
  it('founder numbers: 5,000 on the lower plans, 10,000 on the top plan, none on free', () => {
    expect(DEFAULT_EMAIL_LIMITS.monthlySends).toEqual({ free: 0, plus: 5000, pro: 5000, max: 10000 });
  });

  it('the overview reports the plan\'s allowance, so the meter reads "X of Y"', async () => {
    const pro = await drafted({ usage: 1200 });
    const r = await pro.service.list(admin, TENANT);
    expect(r).toMatchObject({ ok: true, usage: { used: 1200, cap: 5000, percent: 24, warn: false, warnAtPercent: 80 } });
    const max = build({ plan: 'max' });
    expect(await max.service.list(admin, TENANT)).toMatchObject({ usage: { cap: 10000 } });
  });

  it('a super admin can raise a number and it applies with no code change', async () => {
    const root = { ...admin, uid: 'root', isSuperAdmin: true, tenantId: null };
    const c = build({ plan: 'pro' });
    const next = { ...DEFAULT_EMAIL_LIMITS, monthlySends: { ...DEFAULT_EMAIL_LIMITS.monthlySends, pro: 7500 } };
    expect(await c.service.saveLimits(root, next)).toMatchObject({ ok: true });
    expect(await c.service.list(admin, TENANT)).toMatchObject({ usage: { cap: 7500 } });
  });

  it('only a super admin may change limits, and a bad value is refused rather than defaulted', async () => {
    const c = build();
    expect(await c.service.saveLimits(admin, DEFAULT_EMAIL_LIMITS)).toMatchObject({ ok: false, error: 'not_authorized' });
    const root = { ...admin, uid: 'root', isSuperAdmin: true, tenantId: null };
    expect(await c.service.saveLimits(root, { ...DEFAULT_EMAIL_LIMITS, warnAtPercent: 150 })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await c.service.saveLimits(root, { ...DEFAULT_EMAIL_LIMITS, autoPause: { ...DEFAULT_EMAIL_LIMITS.autoPause, bounceRate: 5 } })).toMatchObject({ ok: false });
    expect(c.mem.limits).toBeNull();
  });

  it('a tenant admin never receives the editable config', async () => {
    expect(await build().service.list(admin, TENANT)).toMatchObject({ canEditLimits: false, limits: null });
  });

  it('a field missing or invalid in the stored document falls back to its default', () => {
    const l = resolveLimits({ monthlySends: { pro: 9000, max: 'lots' }, warnAtPercent: 0 });
    expect(l.monthlySends).toMatchObject({ pro: 9000, max: 10000 });
    expect(l.warnAtPercent).toBe(80);
    expect(resolveLimits(null)).toEqual(DEFAULT_EMAIL_LIMITS);
  });

  it('the extra-pack price has no default: it is a setting, not a number in the repo', () => {
    expect(DEFAULT_EMAIL_LIMITS.pack.priceUsd).toBeNull();
    expect(DEFAULT_EMAIL_LIMITS.pack.size).toBe(10000);
    expect(validateLimits({ ...DEFAULT_EMAIL_LIMITS, pack: { size: 5000, priceUsd: 12 } })).toMatchObject({ ok: true });
  });
});

describe('contacts are never metered', () => {
  it('a very large list is not blocked or counted by size (only emails sent are metered)', async () => {
    const c = await drafted({ plan: 'max', contacts: many(6000) });
    expect(await preview(c)).toMatchObject({ ok: true, requiresConfirm: true, preview: { recipientCount: 6000 } });
    expect(c.mem.used).toBe(0);
  });

  it('there is no list-size gate in the email source', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '..');
    const src = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/maxContacts|contact-capacity|unlimitedContacts/);
  });
});

describe('monthly allowance: usage, warning and reset', () => {
  it('warns from 80% of the allowance', async () => {
    const at79 = await drafted({ usage: 3950 });
    expect(await at79.service.list(admin, TENANT)).toMatchObject({ usage: { percent: 79, warn: false } });
    const at80 = await drafted({ usage: 4000 });
    expect(await at80.service.list(admin, TENANT)).toMatchObject({ usage: { percent: 80, warn: true } });
  });

  it('the warning threshold is an adjustable setting', async () => {
    const c = await drafted({ usage: 2600, limits: { warnAtPercent: 50 } });
    expect(await c.service.list(admin, TENANT)).toMatchObject({ usage: { warn: true, warnAtPercent: 50 } });
  });

  it('the allowance resets each calendar month', async () => {
    const lastMonth = monthKey(new Date(Date.UTC(2031, 1, 20)));
    expect(lastMonth).not.toBe(monthKey(NOW));
    const c = await drafted({ usageByKey: { [lastMonth]: 4999 } });
    expect(await c.service.list(admin, TENANT)).toMatchObject({ usage: { used: 0, cap: 5000, resetsAt: '2031-04-01T00:00:00.000Z' } });
    expect(await preview(c)).toMatchObject({ ok: true, requiresConfirm: true });
  });

  it('at the cap a new send is blocked with a clear message, and nothing is sent', async () => {
    const c = await drafted({ usage: 4999 });
    const r = await sendNow(c);
    expect(r).toMatchObject({ ok: false, error: 'volume_cap', message: expect.stringMatching(/1 of 5,000 emails left this month/) });
    expect(c.provider.sent).toHaveLength(0);
  });

  it('a confirmed send counts against both the month and the day', async () => {
    const c = await drafted();
    await sendNow(c);
    expect(c.mem.used).toBe(2);
    expect(c.mem.today).toBe(2);
  });

  it('the cron re-checks the allowance: a scheduled send that would now pass the cap fails visibly', async () => {
    const c = await drafted();
    const at = '2031-03-10T12:30:00.000Z';
    const p = await c.service.send(admin, TENANT, { id: c.id, when: { mode: 'at', at }, mode: 'preview' });
    if (!p.ok || !('confirmToken' in p)) throw new Error();
    await c.service.send(admin, TENANT, { id: c.id, when: { mode: 'at', at }, mode: 'confirm', confirmToken: p.confirmToken });
    c.mem.usage.set(monthKey(NOW), 5000);
    c.mem.queue.set(`${TENANT}__${c.id}`, '2031-03-10T00:00:00.000Z');
    const [r] = await c.service.runDue();
    expect(r.outcome).toBe('failed');
    expect(c.mem.broadcasts.get(c.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/monthly allowance/) });
    expect(c.provider.sent).toHaveLength(0);
  });
});

describe('new-ministry daily cap', () => {
  const young = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  it('a ministry inside its first 14 days is limited to the daily cap', async () => {
    const c = await drafted({ createdAt: young, contacts: many(501) });
    expect(await preview(c)).toMatchObject({ ok: false, error: 'daily_cap', message: expect.stringMatching(/500 emails a day for their first 14 days/) });
  });

  it('what was already sent today counts against the day, not the next day', async () => {
    const c = await drafted({ createdAt: young, contacts: many(200), usageByKey: { [dayKey(NOW)]: 400 } });
    expect(await preview(c)).toMatchObject({ ok: false, error: 'daily_cap' });
    const tomorrow = await drafted({ createdAt: young, contacts: many(200), usageByKey: { '2031-03-09': 400 } });
    expect(await preview(tomorrow)).toMatchObject({ ok: true });
  });

  it('an established ministry has no daily cap', async () => {
    const c = await drafted({ createdAt: '2029-01-01T00:00:00.000Z', contacts: many(900) });
    expect(await preview(c)).toMatchObject({ ok: true, requiresConfirm: true });
  });

  it('the cap and the window are settings', async () => {
    const c = await drafted({ createdAt: young, contacts: many(501), limits: { newChurch: { dailyCap: 2000, days: 14 } } });
    expect(await preview(c)).toMatchObject({ ok: true });
    const short = await drafted({ createdAt: young, contacts: many(501), limits: { newChurch: { dailyCap: 500, days: 2 } } });
    expect(await preview(short)).toMatchObject({ ok: true });
  });

  it('a creation date that cannot be read is treated as new, never as established', () => {
    expect(isNewChurch(undefined, NOW, 14)).toBe(true);
    expect(isNewChurch('not a date', NOW, 14)).toBe(true);
    expect(isNewChurch(young, NOW, 14)).toBe(true);
    expect(isNewChurch('2029-01-01T00:00:00.000Z', NOW, 14)).toBe(false);
  });

  it('the overview shows the daily meter only while the window is open', async () => {
    const c = await drafted({ createdAt: young });
    expect(await c.service.list(admin, TENANT)).toMatchObject({ usage: { daily: { used: 0, cap: 500, days: 14 } } });
    const old = await drafted();
    expect(await old.service.list(admin, TENANT)).toMatchObject({ usage: { daily: null } });
  });
});

describe('large sends need a verified domain', () => {
  const unverified = { domainState: 'pending' as const };

  it('a send over the threshold is refused without a verified domain, even with a shared sender configured', async () => {
    const c = await drafted({ contacts: many(1001), settings: unverified }, 'news@mail.theharvest.app');
    const refused = await preview(c);
    expect(refused).toMatchObject({ ok: false, error: 'domain_required', message: expect.stringMatching(/more than 1,000 people at once is not available yet/) });
    // The refusal is a size limit on the shared sender. It must not tell anyone to verify a domain.
    expect((refused as { message: string }).message).not.toMatch(/verif|domain/i);
  });

  it('a send at the threshold is allowed from the shared sender when one is configured', async () => {
    const c = await drafted({ contacts: many(1000), settings: unverified }, 'news@mail.theharvest.app');
    const r = await sendNow(c);
    expect(r).toMatchObject({ ok: true, outcome: 'sent' });
    expect(c.provider.sent[0].fromAddress).toBe('news@mail.theharvest.app');
  });

  it('with no shared sender configured a verified domain is always required (fails closed)', async () => {
    const c = await drafted({ settings: unverified });
    const refused = await preview(c);
    expect(refused).toMatchObject({ ok: false, error: 'sender_not_ready' });
    expect((refused as { message: string }).message).not.toMatch(/verify your sending domain/i);
  });

  it('a verified domain sends from the ministry\'s own address at any size', async () => {
    const c = await drafted({ contacts: many(1500), plan: 'max' });
    const r = await sendNow(c);
    expect(r).toMatchObject({ ok: true, outcome: 'sent' });
    expect(c.provider.sent[0].fromAddress).toBe('hello@mail.grace.org');
  });

  it('the threshold is a setting', async () => {
    const c = await drafted({ contacts: many(10), settings: unverified, limits: { largeSendThreshold: 5 } }, 'news@mail.theharvest.app');
    expect(await preview(c)).toMatchObject({ ok: false, error: 'domain_required' });
  });
});

describe('auto-pause on a high bounce or complaint rate', () => {
  it('decidePause needs a real sample before it acts', () => {
    const limits = DEFAULT_EMAIL_LIMITS.autoPause;
    expect(decidePause({ sent: 50, bounced: 25, complained: 0 }, limits)).toBeNull();
    expect(decidePause({ sent: 1000, bounced: 40, complained: 0 }, limits)).toBeNull();
    expect(decidePause({ sent: 1000, bounced: 51, complained: 0 }, limits)).toMatchObject({ reason: 'bounce' });
    expect(decidePause({ sent: 1000, bounced: 0, complained: 4 }, limits)).toMatchObject({ reason: 'complaint' });
  });

  it('a bounce rate over the threshold pauses sending, and the next send is blocked with a notice', async () => {
    const c = await drafted({ usage: 1000, health: { bounced: 50 } });
    await c.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'evt-a@x.org');
    expect(c.mem.sending).toMatchObject({ reason: 'bounce' });
    expect(c.mem.contacts.get('c-a@x.org')?.status).toBe('bounced');
    const r = await preview(c);
    expect(r).toMatchObject({ ok: false, error: 'sending_paused', message: expect.stringMatching(/bounced emails passed 5%/) });
    expect(await c.service.list(admin, TENANT)).toMatchObject({ sending: { paused: true, reason: 'bounce' } });
  });

  it('a complaint rate over the threshold pauses sending', async () => {
    const c = await drafted({ usage: 1000, health: { complained: 3 } });
    await c.service.recordFeedback(TENANT, 'b@x.org', 'complained', 'evt-b@x.org');
    expect(c.mem.sending).toMatchObject({ reason: 'complaint' });
  });

  it('under the thresholds nothing pauses', async () => {
    const c = await drafted({ usage: 1000, health: { bounced: 10 } });
    await c.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'evt-a@x.org');
    expect(c.mem.sending).toBeNull();
    expect(await preview(c)).toMatchObject({ ok: true });
  });

  it('thresholds are settings', async () => {
    const c = await drafted({ usage: 1000, health: { bounced: 10 }, limits: { autoPause: { bounceRate: 0.005, complaintRate: 0.003, minSent: 100 } } });
    await c.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'evt-a@x.org');
    expect(c.mem.sending).toMatchObject({ reason: 'bounce' });
  });

  it('a paused ministry cannot send, and a scheduled send fails visibly instead of going out', async () => {
    const c = await drafted({ usage: 1000, health: { bounced: 50 } });
    await c.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'evt-a@x.org');
    c.mem.broadcasts.set(c.id, { ...c.mem.broadcasts.get(c.id)!, status: 'scheduled' });
    c.mem.queue.set(`${TENANT}__${c.id}`, '2031-03-10T00:00:00.000Z');
    const [r] = await c.service.runDue();
    expect(r.outcome).toBe('failed');
    expect(c.provider.sent).toHaveLength(0);
  });

  it('only a super admin can resume, and then sending works again', async () => {
    const c = await drafted({ usage: 1000, health: { bounced: 50 } });
    await c.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'evt-a@x.org');
    expect(await c.service.resumeSending(admin, TENANT)).toMatchObject({ ok: false, error: 'not_authorized' });
    const root = { ...admin, uid: 'root', isSuperAdmin: true, tenantId: null };
    expect(await c.service.resumeSending(root, TENANT)).toMatchObject({ ok: true });
    expect(c.mem.sending).toBeNull();
  });
});

describe('the meter arithmetic', () => {
  it('percentUsed rounds, clamps and survives a zero allowance', () => {
    expect(percentUsed(4000, 5000)).toBe(80);
    expect(percentUsed(9000, 5000)).toBe(100);
    expect(percentUsed(5, 0)).toBe(0);
  });
});
