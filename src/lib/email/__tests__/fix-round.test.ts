import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
process.env.PLUNK_API_KEY = 'test-key';
process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';

const { build, admin, person, mockProvider, TENANT, NOW } = await import('./helpers');
const { signUnsubscribe, verifyUnsubscribe, assertUnsubscribeConfigured } = await import('@/lib/email/unsubscribe');
const { resolveAudience } = await import('@/lib/email/audience');
const { renderEmail, DEFAULT_EMAIL_DESIGN } = await import('@/lib/email/render');
const { monthKey, dayKey } = await import('@/lib/email/volume-cap');
const { contentHash } = await import('@/lib/email/claim');
const { STALE_SENDING_MS } = await import('@/lib/email/service');
const { memoryEmailLedger } = await import('@/lib/email/confirm');

type Ctx = ReturnType<typeof build>;
const draft = { subject: 'Sunday', bodyHtml: '<p>Hi {{first_name}}, see you Sunday.</p>', preheader: 'Doors at 9' };
const many = (n: number) => Array.from({ length: n }, (_, i) => person(`p${i}@x.org`));
const NOW_SEND = { id: '', when: { mode: 'now' as const } };

async function draftIn(ctx: Ctx, over: Partial<typeof draft> = {}) {
  const saved = await ctx.service.saveDraft(admin, TENANT, { ...draft, ...over });
  if (!saved.ok) throw new Error('draft failed');
  return saved.broadcast.id;
}
async function previewToken(ctx: Ctx, id: string, when: { mode: 'now' } | { mode: 'at'; at: string } = { mode: 'now' }) {
  const p = await ctx.service.send(admin, TENANT, { id, when, mode: 'preview' });
  if (!p.ok || !('confirmToken' in p)) throw new Error(`no preview: ${JSON.stringify(p)}`);
  return p.confirmToken;
}
const confirm = (ctx: Ctx, id: string, token: string, when: { mode: 'now' } | { mode: 'at'; at: string } = { mode: 'now' }) =>
  ctx.service.send(admin, TENANT, { id, when, mode: 'confirm', confirmToken: token });
async function schedule(ctx: Ctx, id: string) {
  const when = { mode: 'at' as const, at: '2031-03-12T09:00:00.000Z' };
  const done = await confirm(ctx, id, await previewToken(ctx, id, when), when);
  expect(done).toMatchObject({ ok: true, outcome: 'scheduled' });
  ctx.mem.queue.set(`${TENANT}__${id}`, '2031-03-10T00:00:00.000Z');
}

describe('sends are atomic', () => {
  it('two confirms with two valid tokens deliver to the list exactly once', async () => {
    const ctx = build({ contacts: many(4) }, mockProvider({ delayMs: 5 }));
    const id = await draftIn(ctx);
    const [t1, t2] = [await previewToken(ctx, id), await previewToken(ctx, id)];
    expect(t1).not.toBe(t2);
    const results = await Promise.all([confirm(ctx, id, t1), confirm(ctx, id, t2)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([{ error: 'already_sent' }]);
    expect(ctx.provider.sent).toHaveLength(4);
    expect(ctx.mem.used).toBe(4);
  });

  it('a confirm token is single use: replaying it sends nothing more', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    const token = await previewToken(ctx, id);
    expect((await confirm(ctx, id, token)).ok).toBe(true);
    expect((await confirm(ctx, id, token)).ok).toBe(false);
    expect(ctx.provider.sent).toHaveLength(2);
    expect(ctx.mem.used).toBe(2);
  });

  it('the ledger spends a token once', async () => {
    const ledger = memoryEmailLedger();
    const binding = { action: 'send' as const, tenantId: TENANT, uid: 'owner', broadcastId: 'b1', payloadHash: 'h' };
    const token = await ledger.issue(binding, NOW.getTime());
    expect(await ledger.consume(token, binding, NOW.getTime())).toBe('ok');
    expect(await ledger.consume(token, binding, NOW.getTime())).toBe('reused');
  });

  it('concurrent broadcasts of one ministry cannot both pass the monthly allowance', async () => {
    const ctx = build({ contacts: many(3), usage: 4996 }, mockProvider({ delayMs: 5 }));
    const a = await draftIn(ctx, { subject: 'A' });
    const b = await draftIn(ctx, { subject: 'B' });
    const [ta, tb] = [await previewToken(ctx, a), await previewToken(ctx, b)];
    const results = await Promise.all([confirm(ctx, a, ta), confirm(ctx, b, tb)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([{ error: 'volume_cap' }]);
    expect(ctx.provider.sent).toHaveLength(3);
    expect(ctx.mem.used).toBe(4999);
    expect(ctx.mem.used).toBeLessThanOrEqual(5000);
  });

  it('the allowance is reserved before the first email goes out', async () => {
    let seenDuringSend = -1;
    let ctx: Ctx;
    const provider = mockProvider({ onSend: () => { if (seenDuringSend < 0) seenDuringSend = ctx.mem.used; } });
    ctx = build({ contacts: many(3) }, provider);
    const id = await draftIn(ctx);
    await confirm(ctx, id, await previewToken(ctx, id));
    expect(seenDuringSend).toBe(3);
  });

  it('a doubled cron run sends a scheduled broadcast once', async () => {
    const ctx = build({ contacts: many(3) }, mockProvider({ delayMs: 5 }));
    const id = await draftIn(ctx);
    await schedule(ctx, id);
    const [r1, r2] = await Promise.all([ctx.service.runDue(), ctx.service.runDue()]);
    expect(ctx.provider.sent).toHaveLength(3);
    expect([...r1, ...r2].filter((r) => r.outcome === 'sent')).toHaveLength(1);
    expect(ctx.mem.used).toBe(3);
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('sent');
  });

  it('a send that throws for every email ends failed with the reservation handed back, never stuck', async () => {
    const ctx = build({ contacts: many(2) }, mockProvider({ throwFor: new Set(['p0@x.org', 'p1@x.org']) }));
    const id = await draftIn(ctx);
    const r = await confirm(ctx, id, await previewToken(ctx, id));
    expect(r).toMatchObject({ ok: true, outcome: 'failed' });
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('failed');
    expect(ctx.mem.used).toBe(0);
    expect(ctx.mem.sendingMarkers.size).toBe(0);
  });

  it('a partial send counts what went out and refunds only what did not', async () => {
    const ctx = build({ contacts: many(3) }, mockProvider({ failFor: new Set(['p1@x.org']) }));
    const id = await draftIn(ctx);
    expect(await confirm(ctx, id, await previewToken(ctx, id))).toMatchObject({ outcome: 'partial', stats: { sent: 2, failed: 1 } });
    expect(ctx.mem.used).toBe(2);
    expect(ctx.mem.today).toBe(2);
  });

  it('a timed-out send stays counted (it may have been delivered) and is never retried; a plain failure is refunded', async () => {
    const provider = mockProvider({ timeoutFor: new Set(['p1@x.org']), failFor: new Set(['p2@x.org']) });
    const ctx = build({ contacts: many(4) }, provider);
    const id = await draftIn(ctx);
    const r = await confirm(ctx, id, await previewToken(ctx, id));
    expect(r).toMatchObject({ ok: true, outcome: 'partial', stats: { sent: 2, failed: 2 } });
    expect(r).toMatchObject({ message: expect.stringMatching(/1 timed out and still count/) });
    expect(ctx.mem.used).toBe(3);
    expect(ctx.mem.today).toBe(3);
    expect(provider.sent.map((m) => m.to).sort()).toEqual(['p0@x.org', 'p3@x.org']);
  });

  it('a send where every email times out ends failed with the whole reservation still counted', async () => {
    const ctx = build({ contacts: many(2) }, mockProvider({ timeoutFor: new Set(['p0@x.org', 'p1@x.org']) }));
    const id = await draftIn(ctx);
    expect(await confirm(ctx, id, await previewToken(ctx, id))).toMatchObject({ ok: true, outcome: 'failed' });
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('failed');
    expect(ctx.mem.used).toBe(2);
    expect(ctx.mem.sendingMarkers.size).toBe(0);
  });

  it('running out of time stops starting emails, ends the send and still counts what went out', async () => {
    let sends = 0;
    const provider = mockProvider({ onSend: () => { sends += 1; } });
    const ctx = build({ contacts: many(8) }, provider, null, { clockMs: () => (sends >= 2 ? 1_000_000 : 0), sendBudgetMs: 1000 });
    const id = await draftIn(ctx);
    const r = await confirm(ctx, id, await previewToken(ctx, id));
    expect(r).toMatchObject({ ok: true, outcome: 'partial', stats: { sent: 2, failed: 6 } });
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('partial');
    expect(ctx.mem.used).toBe(2);
  });

  it('a send whose function died is found and closed, and its reservation stays counted', async () => {
    const claimedAt = new Date(NOW.getTime() - STALE_SENDING_MS - 60_000).toISOString();
    const ctx = build({ contacts: many(3) });
    const id = await draftIn(ctx);
    const b = ctx.mem.broadcasts.get(id)!;
    const claim = await ctx.mem.store.claimForSend({
      tenantId: TENANT, broadcastId: id, from: ['draft'], sendId: 'dead-run', nowIso: claimedAt, requested: 3,
      allowance: 5000, dailyCap: null, month: monthKey(NOW), day: dayKey(NOW), expectedContentHash: contentHash(ctx.mem.broadcasts.get(id)!),
    });
    expect(claim.ok).toBe(true);
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('sending');
    expect(b.status).toBe('draft');
    const results = await ctx.service.runDue();
    expect(results).toMatchObject([{ broadcastId: id, outcome: 'failed' }]);
    expect(ctx.mem.broadcasts.get(id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/interrupted/) });
    expect(ctx.mem.used).toBe(3);
    expect(ctx.mem.sendingMarkers.size).toBe(0);
    expect(ctx.provider.sent).toHaveLength(0);
  });

  it('a send that is still within its window is left alone by the recovery sweep', async () => {
    const ctx = build({ contacts: many(3) });
    const id = await draftIn(ctx);
    await ctx.mem.store.claimForSend({
      tenantId: TENANT, broadcastId: id, from: ['draft'], sendId: 'live-run', nowIso: NOW.toISOString(), requested: 3,
      allowance: 5000, dailyCap: null, month: monthKey(NOW), day: dayKey(NOW), expectedContentHash: contentHash(ctx.mem.broadcasts.get(id)!),
    });
    await ctx.service.runDue();
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('sending');
  });

  it('a sending broadcast cannot be edited or deleted', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    await ctx.mem.store.claimForSend({
      tenantId: TENANT, broadcastId: id, from: ['draft'], sendId: 'x', nowIso: NOW.toISOString(), requested: 2,
      allowance: 5000, dailyCap: null, month: monthKey(NOW), day: dayKey(NOW), expectedContentHash: contentHash(ctx.mem.broadcasts.get(id)!),
    });
    expect(await ctx.service.saveDraft(admin, TENANT, { id, subject: 'Changed' })).toMatchObject({ ok: false, error: 'already_sent' });
    expect(await ctx.service.remove(admin, TENANT, id)).toMatchObject({ ok: false, error: 'already_sent' });
  });

  it('a scheduled send that was changed to failed after claim is not sent twice by a later run', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    await schedule(ctx, id);
    await ctx.service.runDue();
    ctx.mem.queue.set(`${TENANT}__${id}`, '2031-03-10T00:00:00.000Z');
    const second = await ctx.service.runDue();
    expect(second[0]).toMatchObject({ outcome: 'skipped' });
    expect(ctx.provider.sent).toHaveLength(2);
  });
});

describe('who may use email', () => {
  const colleague = { uid: 'u2', email: 'u2@grace.org', tenantId: TENANT, isAdmin: true, isSuperAdmin: false };
  const seed = { ownerId: 'someone-else' };

  it('a ministry admin without manageNewsletter or fullAccess is refused', async () => {
    const ctx = build({ ...seed, permissions: { manageEvents: true } });
    expect(await ctx.service.saveDraft(colleague, TENANT, draft)).toMatchObject({ ok: false, error: 'not_authorized' });
    expect(await ctx.service.list(colleague, TENANT)).toMatchObject({ ok: false, error: 'not_authorized' });
  });

  it('manageNewsletter or fullAccess lets an admin in', async () => {
    expect((await build({ ...seed, permissions: { manageNewsletter: true } }).service.saveDraft(colleague, TENANT, draft)).ok).toBe(true);
    expect((await build({ ...seed, permissions: { fullAccess: true } }).service.saveDraft(colleague, TENANT, draft)).ok).toBe(true);
  });

  it('manageNewsletter alone does not help someone who is not an admin', async () => {
    const ctx = build({ ...seed, permissions: { manageNewsletter: true } });
    expect(await ctx.service.saveDraft({ ...colleague, isAdmin: false }, TENANT, draft)).toMatchObject({ ok: false, error: 'not_authorized' });
  });

  it('the owner and a listed roster admin need no extra permission', async () => {
    expect((await build().service.saveDraft({ ...colleague, uid: 'owner' }, TENANT, draft)).ok).toBe(true);
    expect((await build({ ...seed, adminEmails: ['U2@grace.org'] }).service.saveDraft(colleague, TENANT, draft)).ok).toBe(true);
  });
});

describe('a sending domain belongs to one ministry', () => {
  const other = { ...admin, uid: 'other-owner', tenantId: 'other' };

  it('another ministry cannot register or check a domain that is already held', async () => {
    const provider = mockProvider();
    const registerDomain = vi.spyOn(provider, 'registerDomain');
    const getDomainStatus = vi.spyOn(provider, 'getDomainStatus');
    const ctx = build({ domainOwners: { 'gracechurch.org': 'grace' }, ownerId: 'other-owner', settings: { domain: 'gracechurch.org', domainState: 'none' } }, provider);
    expect(await ctx.service.domain(other, 'other', { op: 'register', domain: 'gracechurch.org' })).toMatchObject({ ok: false, error: 'domain_taken' });
    expect(await ctx.service.domain(other, 'other', { op: 'check' })).toMatchObject({ ok: false, error: 'domain_taken' });
    expect(registerDomain).not.toHaveBeenCalled();
    expect(getDomainStatus).not.toHaveBeenCalled();
    expect(ctx.mem.domainOwners.get('gracechurch.org')).toBe('grace');
  });

  it('the ministry that holds it can register and re-check it', async () => {
    const ctx = build({ domainOwners: {}, settings: { domain: '', domainState: 'none' } });
    expect(await ctx.service.domain(admin, TENANT, { op: 'register', domain: 'Gracechurch.org' })).toMatchObject({ ok: true, settings: { domain: 'gracechurch.org', domainState: 'verified' } });
    expect(ctx.mem.domainOwners.get('gracechurch.org')).toBe(TENANT);
    expect((await ctx.service.domain(admin, TENANT, { op: 'check' })).ok).toBe(true);
  });

  it('two ministries racing for one domain: exactly one gets it', async () => {
    const shared = { domainOwners: {} as Record<string, string> };
    const a = build({ ...shared, settings: { domain: '', domainState: 'none' } });
    const b = build({ ...shared, ownerId: 'other-owner', settings: { domain: '', domainState: 'none' } });
    // two services, one registry: point both memory stores at the same map
    const map = a.mem.domainOwners;
    b.mem.domainOwners.clear();
    b.mem.store.claimDomain = a.mem.store.claimDomain;
    b.mem.store.getDomainOwner = a.mem.store.getDomainOwner;
    b.mem.store.releaseDomain = a.mem.store.releaseDomain;
    const results = await Promise.all([
      a.service.domain(admin, TENANT, { op: 'register', domain: 'gracechurch.org' }),
      b.service.domain(other, 'other', { op: 'register', domain: 'gracechurch.org' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(map.get('gracechurch.org')).toBeDefined();
  });

  it('a ministry cannot send as a verified domain it does not hold', async () => {
    const ctx = build({ contacts: many(2), ownerId: 'other-owner', domainOwners: { 'grace.org': 'grace' }, settings: { domain: 'grace.org', domainState: 'verified' } });
    const saved = await ctx.service.saveDraft(other, 'other', draft);
    if (!saved.ok) throw new Error('draft');
    expect(await ctx.service.send(other, 'other', { id: saved.broadcast.id, when: { mode: 'now' }, mode: 'preview' })).toMatchObject({ ok: false, error: 'sender_not_ready' });
    expect(ctx.provider.sent).toHaveLength(0);
  });

  it('a failed vendor call gives back a domain that was only just claimed', async () => {
    const provider = mockProvider();
    provider.registerDomain = async () => { throw new Error('plunk down'); };
    const ctx = build({ domainOwners: {}, settings: { domain: '', domainState: 'none' } }, provider);
    await expect(ctx.service.domain(admin, TENANT, { op: 'register', domain: 'gracechurch.org' })).rejects.toThrow('plunk down');
    expect(ctx.mem.domainOwners.has('gracechurch.org')).toBe(false);
  });

  it('moving to a new domain releases the old one', async () => {
    const ctx = build({ domainOwners: { 'old.org': TENANT }, settings: { domain: 'old.org', domainState: 'verified' } });
    await ctx.service.domain(admin, TENANT, { op: 'register', domain: 'new.org' });
    expect(ctx.mem.domainOwners.has('old.org')).toBe(false);
    expect(ctx.mem.domainOwners.get('new.org')).toBe(TENANT);
  });
});

describe('editing a scheduled broadcast', () => {
  it('saves, takes it off the schedule and makes it a draft again', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    await schedule(ctx, id);
    const r = await ctx.service.saveDraft(admin, TENANT, { id, subject: 'New subject' });
    expect(r).toMatchObject({ ok: true, unscheduled: true, broadcast: { subject: 'New subject', status: 'draft', scheduledAt: null } });
    expect(ctx.mem.queue.size).toBe(0);
    expect(await ctx.service.runDue()).toEqual([]);
    expect(ctx.provider.sent).toHaveLength(0);
  });

  it('the old confirmation no longer works for the edited email', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    const when = { mode: 'at' as const, at: '2031-03-12T09:00:00.000Z' };
    const token = await previewToken(ctx, id, when);
    await confirm(ctx, id, token, when);
    await ctx.service.saveDraft(admin, TENANT, { id, bodyHtml: '<p>Different</p>' });
    expect(await ctx.service.send(admin, TENANT, { id, when, mode: 'confirm', confirmToken: token })).toMatchObject({ ok: false });
  });
});

describe('who an audience reaches', () => {
  it('a newer record that never opted in cannot hide an older subscribed one', () => {
    const r = resolveAudience([
      person('dup@x.org', { id: 'new', status: 'none', joinedAt: '2031-03-01T00:00:00.000Z' }),
      person('dup@x.org', { id: 'old', status: 'subscribed' }),
    ], []);
    expect(r.recipients.map((c) => c.id)).toEqual(['old']);
    expect(r.skipped.notOptedIn).toBe(0);
  });

  it('a filter matches if any subscribed record of the address does', () => {
    const r = resolveAudience([
      person('dup@x.org', { id: 'a', tags: [] }),
      person('dup@x.org', { id: 'b', tags: ['youth'] }),
    ], [{ kind: 'has-tag', value: 'youth' }]);
    expect(r.recipients.map((c) => c.id)).toEqual(['b']);
  });

  it('suppression still wins over any duplicate, and over the server-side opt-out record', () => {
    expect(resolveAudience([person('d@x.org', { id: 'a' }), person('d@x.org', { id: 'b', status: 'unsubscribed' })], []).recipients).toEqual([]);
    const r = resolveAudience([person('gone@x.org')], [], new Set(['gone@x.org']));
    expect(r.recipients).toEqual([]);
    expect(r.skipped.suppressed).toBe(1);
  });

  it('an opt-out survives the CRM person being deleted: the address is not emailed or re-imported', async () => {
    const ctx = build({ contacts: [person('stay@x.org'), person('leaves@x.org')] });
    await ctx.service.optOut(TENANT, 'leaves@x.org', 'b0');
    ctx.mem.contacts.delete('c-leaves@x.org');
    const imported = await ctx.service.importContacts(admin, TENANT, { consentConfirmed: true, rows: [{ email: 'leaves@x.org' }] });
    expect(imported).toMatchObject({ ok: true, added: 0, blocked: 1 });
    expect(ctx.mem.created).toHaveLength(0);
    ctx.mem.contacts.set('c-back', person('leaves@x.org', { id: 'c-back' }));
    const id = await draftIn(ctx);
    await confirm(ctx, id, await previewToken(ctx, id));
    expect(ctx.provider.sent.map((m) => m.to)).toEqual(['stay@x.org']);
  });
});

describe('merge tags cannot inject markup', () => {
  const base = { design: DEFAULT_EMAIL_DESIGN, bodyHtml: '<p>Hi {{first_name}}, from {{sender_name}}</p>', preheader: 'Hello {{first_name}}', churchName: 'Grace', mailingAddress: '1 Main', unsubscribeUrl: 'https://u.example/x' };

  it('escapes a first name and a sender name in the HTML', () => {
    const { html } = renderEmail({ ...base, firstName: '<img src=x onerror=alert(1)>', senderName: '<script>steal()</script>' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
  });

  it('an ordinary name renders unchanged, with an apostrophe and an ampersand handled once', () => {
    const { html } = renderEmail({ ...base, firstName: "O'Brien", senderName: 'Grace & Co' });
    expect(html).toContain("Hi O'Brien");
    expect(html).toContain('Grace &amp; Co');
    expect(html).not.toContain('&amp;amp;');
  });

  it('the plain-text part stays plain text', () => {
    const { text } = renderEmail({ ...base, firstName: 'Ann<img src=x>', senderName: 'Grace' });
    expect(text).toContain('Hi Ann');
    expect(text).not.toContain('<img');
  });
});

describe('unsubscribe tokens', () => {
  const env = { EMAIL_UNSUBSCRIBE_SECRET: 'secret-a' };
  const payload = { tenantId: 'grace', email: 'a@x.org', broadcastId: 'b1' };

  it('round-trips with the same secret', () => {
    expect(verifyUnsubscribe(signUnsubscribe(payload, env), env)).toEqual(payload);
  });

  it('a same-length wrong MAC is rejected', () => {
    const [body, mac] = signUnsubscribe(payload, env).split('.');
    const wrong = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    expect(wrong).toHaveLength(mac.length);
    expect(verifyUnsubscribe(`${body}.${wrong}`, env)).toBeNull();
  });

  it('a body swapped to another ministry or address under a valid-length MAC from another token is rejected', () => {
    const [, macOfOther] = signUnsubscribe({ ...payload, email: 'victim@x.org' }, env).split('.');
    const swap = (parts: string[]) => Buffer.from(JSON.stringify(parts)).toString('base64url');
    expect(verifyUnsubscribe(`${swap(['other', 'a@x.org', 'b1'])}.${macOfOther}`, env)).toBeNull();
    expect(verifyUnsubscribe(`${swap(['grace', 'victim2@x.org', 'b1'])}.${macOfOther}`, env)).toBeNull();
    const [, ownMac] = signUnsubscribe(payload, env).split('.');
    expect(verifyUnsubscribe(`${swap(['grace', 'victim@x.org', 'b1'])}.${ownMac}`, env)).toBeNull();
  });

  it('a token signed with another secret is rejected', () => {
    expect(verifyUnsubscribe(signUnsubscribe(payload, { EMAIL_UNSUBSCRIBE_SECRET: 'secret-b' }), env)).toBeNull();
  });

  it('with no secret it fails closed with a clear error and never falls back to the vendor key', () => {
    const onlyVendor = { PLUNK_API_KEY: 'vendor-key' };
    expect(() => signUnsubscribe(payload, onlyVendor)).toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
    expect(() => verifyUnsubscribe(signUnsubscribe(payload, env), onlyVendor)).toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
    expect(() => assertUnsubscribeConfigured(onlyVendor)).toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
    expect(() => assertUnsubscribeConfigured({ EMAIL_UNSUBSCRIBE_SECRET: '   ' })).toThrow();
  });

  it('a send refuses to start without the secret, before anything is claimed or counted', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    const token = await previewToken(ctx, id);
    const saved = process.env.EMAIL_UNSUBSCRIBE_SECRET;
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    try {
      await expect(confirm(ctx, id, token)).rejects.toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
    } finally {
      process.env.EMAIL_UNSUBSCRIBE_SECRET = saved;
    }
    expect(ctx.mem.used).toBe(0);
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('draft');
    expect(ctx.provider.sent).toHaveLength(0);
  });
});
