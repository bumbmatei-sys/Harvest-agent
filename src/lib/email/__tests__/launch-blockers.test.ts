import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
process.env.PLUNK_API_KEY = 'test-key';
process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';

const { build, admin, person, mockProvider, TENANT, NOW } = await import('./helpers');
const { STALE_SENDING_MS } = await import('@/lib/email/service');
const { monthKey, dayKey } = await import('@/lib/email/volume-cap');
const { contentHash } = await import('@/lib/email/claim');
const { isReservedDomain, domainOfAddress } = await import('@/lib/email/reserved-domains');

type Ctx = ReturnType<typeof build>;
const other = { ...admin, uid: 'other-owner', email: 'o@other.org', tenantId: 'other' };
const draft = { subject: 'Sunday', bodyHtml: '<p>Hi {{first_name}}, see you Sunday.</p>', preheader: 'Doors at 9' };
const many = (n: number) => Array.from({ length: n }, (_, i) => person(`p${i}@x.org`));
const noDomain = { domain: '', domainState: 'none' as const };

async function draftIn(ctx: Ctx) {
  const saved = await ctx.service.saveDraft(admin, TENANT, draft);
  if (!saved.ok) throw new Error('draft failed');
  return saved.broadcast.id;
}
async function previewToken(ctx: Ctx, id: string, when: { mode: 'now' } | { mode: 'at'; at: string } = { mode: 'now' }) {
  const p = await ctx.service.send(admin, TENANT, { id, when, mode: 'preview' });
  if (!p.ok || !('confirmToken' in p)) throw new Error(`no preview: ${JSON.stringify(p)}`);
  return p.confirmToken;
}

describe('domain claims', () => {
  it('refuses a fresh claim on a domain the vendor account already verified', async () => {
    const provider = mockProvider({ known: { 'mail.gracechurch.org': 'verified' } });
    const ctx = build({ domainOwners: {}, settings: noDomain }, provider);
    const r = await ctx.service.domain(admin, TENANT, { op: 'register', domain: 'gracechurch.org' });
    expect(r).toMatchObject({ ok: false, error: 'domain_taken' });
    expect(ctx.mem.domainOwners.has('gracechurch.org')).toBe(false);
    expect(ctx.mem.released.has('gracechurch.org')).toBe(false);
  });

  it('also refuses it on a check, and never copies the verified state into settings', async () => {
    const provider = mockProvider({ known: { 'mail.gracechurch.org': 'verified' } });
    const ctx = build({ domainOwners: {}, settings: { domain: 'gracechurch.org', domainState: 'none' } }, provider);
    expect(await ctx.service.domain(admin, TENANT, { op: 'check' })).toMatchObject({ ok: false, error: 'domain_taken' });
    expect((await ctx.mem.store.getSettings(TENANT)).domainState).toBe('none');
  });

  it('a fresh claim on a domain the vendor holds but has not verified goes ahead', async () => {
    const ctx = build({ domainOwners: {}, settings: noDomain }, mockProvider({ known: { 'mail.gracechurch.org': 'pending' } }));
    expect(await ctx.service.domain(admin, TENANT, { op: 'register', domain: 'gracechurch.org' })).toMatchObject({ ok: true });
    expect(ctx.mem.domainOwners.get('gracechurch.org')).toBe(TENANT);
  });

  it('a released claim stays as a placeholder: the next ministry cannot take it, even if the vendor lists it unverified', async () => {
    const ctx = build({ domainOwners: { 'old.org': TENANT }, settings: { domain: 'old.org', domainState: 'verified' } });
    expect(await ctx.service.domain(admin, TENANT, { op: 'register', domain: 'new.org' })).toMatchObject({ ok: true });
    expect(ctx.mem.domainOwners.has('old.org')).toBe(false);
    expect(ctx.mem.released.get('old.org')).toBe(TENANT);

    const b = build({ domainOwners: {}, releasedDomains: { 'old.org': TENANT }, ownerId: 'other-owner', settings: noDomain }, mockProvider({ known: { 'mail.old.org': 'pending' } }));
    expect(await b.service.domain(other, 'other', { op: 'register', domain: 'old.org' })).toMatchObject({ ok: false, error: 'domain_taken' });
    expect(b.mem.released.get('old.org')).toBe(TENANT);
    expect(b.mem.domainOwners.has('old.org')).toBe(false);
  });

  it('the ministry that released a domain can take it back', async () => {
    const ctx = build({ domainOwners: {}, releasedDomains: { 'old.org': TENANT }, settings: noDomain });
    expect(await ctx.service.domain(admin, TENANT, { op: 'register', domain: 'old.org' })).toMatchObject({ ok: true });
    expect(ctx.mem.domainOwners.get('old.org')).toBe(TENANT);
    expect(ctx.mem.released.has('old.org')).toBe(false);
  });

  it('a released domain does not send for anyone: a ministry whose settings still name it has no sender', async () => {
    const ctx = build({ contacts: many(2), domainOwners: {}, releasedDomains: { 'grace.org': 'someone-else' } });
    const id = await draftIn(ctx);
    expect(await ctx.service.send(admin, TENANT, { id, when: { mode: 'now' }, mode: 'preview' })).toMatchObject({ ok: false, error: 'sender_not_ready' });
  });

  it.each([
    ['theharvest.site'], ['THEHARVEST.SITE'], ['mail.theharvest.site'], ['theharvest.app'], ['gracechurch.theharvest.app'], ['news.theharvest.site'],
  ])('%s is reserved for Harvest and nothing is claimed', async (domain) => {
    const ctx = build({ domainOwners: {}, settings: noDomain });
    expect(await ctx.service.domain(admin, TENANT, { op: 'register', domain })).toMatchObject({ ok: false, error: 'domain_reserved' });
    expect(ctx.mem.domainOwners.size).toBe(0);
  });

  it('a domain is not reserved just because it ends with the same letters', async () => {
    const ctx = build({ domainOwners: {}, settings: noDomain });
    expect(await ctx.service.domain(admin, TENANT, { op: 'register', domain: 'nottheharvest.site' })).toMatchObject({ ok: true });
  });

  it('Harvest sending domains named in configuration are reserved too', async () => {
    const { createEmailService } = await import('@/lib/email/service');
    const { memoryEmailLedger } = await import('@/lib/email/confirm');
    const mem = (await import('./helpers')).memoryStore({ domainOwners: {}, settings: noDomain });
    const service = createEmailService({
      store: mem.store, ledger: memoryEmailLedger(), getProvider: async () => mockProvider(), appOrigin: 'https://x.test', now: () => NOW,
      reservedDomains: ['Harvest Mail <hello@mail.sender.example>', 'platform.example'],
    });
    for (const domain of ['sender.example', 'mail.sender.example', 'a.platform.example']) {
      expect(await service.domain(admin, TENANT, { op: 'register', domain })).toMatchObject({ ok: false, error: 'domain_reserved' });
    }
    expect(await service.domain(admin, TENANT, { op: 'register', domain: 'gracechurch.org' })).toMatchObject({ ok: true });
  });

  it('a settings document that already names a Harvest domain never gets a verified sender', async () => {
    const ctx = build({ contacts: many(2), domainOwners: { 'theharvest.site': TENANT }, settings: { domain: 'theharvest.site', domainState: 'verified' } });
    const id = await draftIn(ctx);
    expect(await ctx.service.send(admin, TENANT, { id, when: { mode: 'now' }, mode: 'preview' })).toMatchObject({ ok: false, error: 'sender_not_ready' });
  });

  it('reserved-domain matching reads addresses and display names', () => {
    expect(domainOfAddress('Harvest <noreply@theharvest.app>')).toBe('theharvest.app');
    expect(isReservedDomain('x.org', ['Harvest <a@x.org>'])).toBe(true);
    expect(isReservedDomain('grace.org')).toBe(false);
  });
});

describe('a confirm racing a draft edit', () => {
  /** Runs `edit` once, the first time the service reads the contact list: after it read the broadcast, before it claims it. */
  function editMidSend(ctx: Ctx, edit: () => Promise<unknown>) {
    const real = ctx.mem.store.listContacts;
    let done = false;
    ctx.mem.store.listContacts = async (t) => {
      if (!done) { done = true; await edit(); }
      return real(t);
    };
  }

  it('sends nothing and keeps the edit when the draft changed between the read and the claim', async () => {
    const ctx = build({ contacts: many(3) });
    const id = await draftIn(ctx);
    const token = await previewToken(ctx, id);
    editMidSend(ctx, () => ctx.service.saveDraft(admin, TENANT, { id, bodyHtml: '<p>The edited letter.</p>' }));
    const r = await ctx.service.send(admin, TENANT, { id, when: { mode: 'now' }, mode: 'confirm', confirmToken: token });
    expect(r).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(ctx.provider.sent).toHaveLength(0);
    expect(ctx.mem.used).toBe(0);
    expect(ctx.mem.broadcasts.get(id)).toMatchObject({ status: 'draft', bodyHtml: '<p>The edited letter.</p>' });
  });

  it('a scheduling confirm does not overwrite an edit made after it read the draft', async () => {
    const ctx = build({ contacts: many(3) });
    const id = await draftIn(ctx);
    const when = { mode: 'at' as const, at: '2031-03-12T09:00:00.000Z' };
    const token = await previewToken(ctx, id, when);
    editMidSend(ctx, () => ctx.service.saveDraft(admin, TENANT, { id, subject: 'Edited subject' }));
    const r = await ctx.service.send(admin, TENANT, { id, when, mode: 'confirm', confirmToken: token });
    expect(r).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(ctx.mem.broadcasts.get(id)).toMatchObject({ status: 'draft', subject: 'Edited subject' });
    expect(ctx.mem.queue.size).toBe(0);
  });

  it('with no edit in between the same confirm goes out', async () => {
    const ctx = build({ contacts: many(3) });
    const id = await draftIn(ctx);
    const r = await ctx.service.send(admin, TENANT, { id, when: { mode: 'now' }, mode: 'confirm', confirmToken: await previewToken(ctx, id) });
    expect(r).toMatchObject({ ok: true, outcome: 'sent' });
    expect(ctx.provider.sent).toHaveLength(3);
  });

  it('the cron leaves an edited scheduled email queued instead of failing it', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    const when = { mode: 'at' as const, at: '2031-03-12T09:00:00.000Z' };
    expect(await ctx.service.send(admin, TENANT, { id, when, mode: 'confirm', confirmToken: await previewToken(ctx, id, when) })).toMatchObject({ outcome: 'scheduled' });
    ctx.mem.queue.set(`${TENANT}__${id}`, '2031-03-10T00:00:00.000Z');
    const real = ctx.mem.store.listContacts;
    ctx.mem.store.listContacts = async (t) => {
      ctx.mem.broadcasts.set(id, { ...ctx.mem.broadcasts.get(id)!, subject: 'Edited while the cron read it' });
      return real(t);
    };
    const [r] = await ctx.service.runDue();
    expect(r).toMatchObject({ outcome: 'skipped' });
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('scheduled');
    expect(ctx.mem.queue.has(`${TENANT}__${id}`)).toBe(true);
    expect(ctx.provider.sent).toHaveLength(0);
  });
});

describe('recovery runs where people look, not only in the daily cron', () => {
  async function stuck(ctx: Ctx) {
    const id = await draftIn(ctx);
    const claimedAt = new Date(NOW.getTime() - STALE_SENDING_MS - 60_000).toISOString();
    const claim = await ctx.mem.store.claimForSend({
      tenantId: TENANT, broadcastId: id, from: ['draft'], sendId: 'dead', nowIso: claimedAt, requested: 3, allowance: 5000, dailyCap: null,
      month: monthKey(NOW), day: dayKey(NOW), expectedContentHash: contentHash(ctx.mem.broadcasts.get(id)!),
    });
    expect(claim.ok).toBe(true);
    return id;
  }

  it('opening the overview closes a send whose function died', async () => {
    const ctx = build({ contacts: many(3) });
    const id = await stuck(ctx);
    await ctx.service.list(admin, TENANT);
    expect(ctx.mem.broadcasts.get(id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/interrupted/) });
    expect(ctx.mem.used).toBe(3);
  });

  it('previewing another send closes it too', async () => {
    const ctx = build({ contacts: many(3) });
    const id = await stuck(ctx);
    const next = await ctx.service.saveDraft(admin, TENANT, draft);
    if (!next.ok) throw new Error('draft');
    await ctx.service.send(admin, TENANT, { id: next.broadcast.id, when: { mode: 'now' }, mode: 'preview' });
    expect(ctx.mem.broadcasts.get(id)?.status).toBe('failed');
  });

  it('a failure to recover is logged and does not stop the overview', async () => {
    const ctx = build({ contacts: many(1) });
    ctx.mem.store.listStaleSending = async () => { throw new Error('index missing'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await ctx.service.list(admin, TENANT)).toMatchObject({ ok: true });
    expect(err.mock.calls.flat().join(' ')).toContain('index missing');
    err.mockRestore();
  });
});

describe('bounce and complaint feedback', () => {
  it('the ministry that owns the sender domain is the one acted on', async () => {
    const ctx = build({ contacts: [person('a@x.org')] });
    expect(await ctx.service.tenantForSender('hello@mail.grace.org')).toBe(TENANT);
    expect(await ctx.service.tenantForSender('Grace Church <hello@mail.grace.org>')).toBe(TENANT);
    expect(await ctx.service.tenantForSender('hello@mail.unknown.org')).toBeNull();
    expect(await ctx.service.tenantForSender('noreply@theharvest.app')).toBeNull();
    expect(await ctx.service.tenantForSender('nonsense')).toBeNull();
  });

  it('the same provider event counts once', async () => {
    const ctx = build({ contacts: [person('a@x.org')], usage: 1000 });
    expect(await ctx.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'em_1')).toBe(true);
    expect(await ctx.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'em_1')).toBe(false);
    expect(ctx.mem.feedback.bounced).toBe(1);
    expect(await ctx.service.recordFeedback(TENANT, 'b@x.org', 'bounced', 'em_2')).toBe(true);
    expect(ctx.mem.feedback.bounced).toBe(2);
  });

  it('a bounce is a different event from a complaint with the same id', async () => {
    const ctx = build({ contacts: [person('a@x.org')] });
    await ctx.service.recordFeedback(TENANT, 'a@x.org', 'bounced', 'em_1');
    expect(await ctx.service.recordFeedback(TENANT, 'a@x.org', 'complained', 'em_1')).toBe(true);
  });

  it('a counted bounce suppresses the person and, over the threshold, pauses sending', async () => {
    const ctx = build({ contacts: [person('a@x.org')], usage: 1000, health: { bounced: 50 } });
    await ctx.service.recordFeedback(TENANT, 'A@X.org', 'bounced', 'em_9');
    expect(ctx.mem.contacts.get('c-a@x.org')?.status).toBe('bounced');
    expect(ctx.mem.suppressedEmails.has('a@x.org')).toBe(true);
    expect(ctx.mem.sending).toMatchObject({ reason: 'bounce' });
  });
});

describe('expired confirm tokens are cleaned up', () => {
  it('removes tokens past their expiry, used or not, and keeps live ones', async () => {
    const ctx = build({ contacts: many(2) });
    const id = await draftIn(ctx);
    const used = await previewToken(ctx, id);
    await ctx.service.send(admin, TENANT, { id, when: { mode: 'now' }, mode: 'confirm', confirmToken: used });
    const next = await ctx.service.saveDraft(admin, TENANT, draft);
    if (!next.ok) throw new Error('draft');
    const unused = await previewToken(ctx, next.broadcast.id);
    expect(ctx.ledger.records.size).toBe(2);
    expect(await ctx.service.purgeExpired()).toEqual({ tokens: 0, feedback: 0 });

    for (const [token, rec] of ctx.ledger.records) if (token === used) ctx.ledger.records.set(token, { ...rec, expiresAt: NOW.getTime() - 1 });
    expect(await ctx.service.purgeExpired()).toMatchObject({ tokens: 1 });
    expect([...ctx.ledger.records.keys()]).toEqual([unused]);
  });
});
