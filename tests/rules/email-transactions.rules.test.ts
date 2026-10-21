import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * The email send path against the REAL Firestore emulator, through the Admin SDK
 * the production code uses. The unit suites use an in-memory store whose
 * "transactions" cannot interleave, so they prove the decisions but not that
 * Firestore's own transactions serialise two racing claims. These do.
 *
 * Not a rules test: the Admin SDK bypasses rules. It lives here because this is
 * the one config that runs under `firebase emulators:exec` (CI's Firestore job).
 */

const PROJECT = 'demo-rules-test';
let app: App;
let db: Firestore;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/firebase-admin', () => ({
  get adminDb() { return db; },
  AdminNotConfiguredError: class extends Error {},
  assertAdminConfigured: () => {},
}));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: async () => ({}) }));

process.env.EMAIL_UNSUBSCRIBE_SECRET = 'emulator-test-secret';

const { firestoreEmailStore: store, SENDING_QUEUE, DOMAIN_CLAIMS, FEEDBACK_EVENTS, SCHEDULED_QUEUE } = await import('@/lib/email/firestore-store');
const { firestoreEmailLedger, EMAIL_CONFIRM_TOKENS } = await import('@/lib/email/firestore-confirm');
const { contentHash } = await import('@/lib/email/claim');
const { createEmailService } = await import('@/lib/email/service');
const { DEFAULT_EMAIL_DESIGN } = await import('@/lib/email/design');

const uid = () => randomUUID().slice(0, 8);
const MONTH = '2031-03';
const DAY = '2031-03-10';
const NOW = '2031-03-10T12:00:00.000Z';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run through `npm run test:rules`: the Firestore emulator is not up.');
  // The emulator needs no credential; this stops the SDK probing the cloud metadata server for one (a 30s wait).
  process.env.NO_GCE_CHECK = 'true';
  app = initializeApp({ projectId: PROJECT }, `email-tx-${uid()}`);
  db = getFirestore(app);
});
afterAll(async () => { await deleteApp(app); });

type Status = 'draft' | 'scheduled' | 'sending' | 'sent';
async function seedBroadcast(tenantId: string, id = uid(), over: Record<string, unknown> = {}) {
  const b = {
    id, tenantId, subject: 'Sunday', subjectB: null, preheader: '', bodyHtml: '<p>Hi {{first_name}}, see you Sunday.</p>', design: DEFAULT_EMAIL_DESIGN,
    filters: [], status: 'draft' as Status, scheduledAt: null, sentAt: null, stats: null, error: null, sendId: null, createdBy: 'u', createdAt: NOW, updatedAt: NOW, ...over,
  };
  await db.collection('tenants').doc(tenantId).collection('emailBroadcasts').doc(id).set(b);
  return (await store.getBroadcast(tenantId, id))!;
}
const claimReq = (b: { id: string; tenantId: string }, over: Record<string, unknown> = {}) => ({
  tenantId: b.tenantId, broadcastId: b.id, from: ['draft', 'scheduled'], sendId: `s-${uid()}`, nowIso: NOW, requested: 10,
  allowance: 5000, dailyCap: null, month: MONTH, day: DAY, expectedContentHash: '', ...over,
});
const used = async (tenantId: string, key = MONTH) => ((await db.collection('tenants').doc(tenantId).collection('emailUsage').doc(key).get()).data()?.sent ?? 0) as number;

describe('claimForSend is one Firestore transaction', () => {
  it('of many concurrent claims on one broadcast, exactly one wins and the allowance is reserved once', async () => {
    const t = `t-${uid()}`;
    const b = await seedBroadcast(t);
    await db.collection(SCHEDULED_QUEUE).doc(`${t}__${b.id}`).set({ tenantId: t, broadcastId: b.id, at: NOW });
    const results = await Promise.all(Array.from({ length: 8 }, () => store.claimForSend(claimReq(b, { expectedContentHash: contentHash(b) }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'not_claimable')).toBe(true);
    expect(await used(t)).toBe(10);
    expect(await used(t, DAY)).toBe(10);
    expect((await store.getBroadcast(t, b.id))?.status).toBe('sending');
    expect((await db.collection(SENDING_QUEUE).doc(`${t}__${b.id}`).get()).exists).toBe(true);
    expect((await db.collection(SCHEDULED_QUEUE).doc(`${t}__${b.id}`).get()).exists).toBe(false);
  });

  it('concurrent broadcasts of one ministry cannot pass the monthly allowance', async () => {
    const t = `t-${uid()}`;
    const bs = await Promise.all([seedBroadcast(t), seedBroadcast(t), seedBroadcast(t), seedBroadcast(t)]);
    const results = await Promise.all(bs.map((b) => store.claimForSend(claimReq(b, { requested: 40, allowance: 100, expectedContentHash: contentHash(b) }))));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'volume_cap')).toBe(true);
    expect(await used(t)).toBe(80);
    const losers = bs.filter((_, i) => !results[i].ok);
    for (const b of losers) expect((await store.getBroadcast(t, b.id))?.status).toBe('draft');
  });

  it('enforces the new-ministry daily cap across concurrent claims', async () => {
    const t = `t-${uid()}`;
    const bs = await Promise.all([seedBroadcast(t), seedBroadcast(t), seedBroadcast(t)]);
    const results = await Promise.all(bs.map((b) => store.claimForSend(claimReq(b, { requested: 30, dailyCap: 50, expectedContentHash: contentHash(b) }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'daily_cap')).toBe(true);
    expect(await used(t, DAY)).toBe(30);
  });

  it('refuses a broadcast that was edited after it was read, and writes nothing', async () => {
    const t = `t-${uid()}`;
    const b = await seedBroadcast(t);
    await db.collection('tenants').doc(t).collection('emailBroadcasts').doc(b.id).update({ subject: 'Edited after the preview' });
    const r = await store.claimForSend(claimReq(b, { expectedContentHash: contentHash(b) }));
    expect(r).toMatchObject({ ok: false, code: 'changed' });
    expect(await used(t)).toBe(0);
    expect((await store.getBroadcast(t, b.id))).toMatchObject({ status: 'draft', subject: 'Edited after the preview' });
    expect((await db.collection(SENDING_QUEUE).doc(`${t}__${b.id}`).get()).exists).toBe(false);
  });

  it('a stored document read back in another key order has the same hash', async () => {
    const t = `t-${uid()}`;
    const b = await seedBroadcast(t, uid(), { design: { theme: 'letter', accent: 'gold' } });
    const again = (await store.getBroadcast(t, b.id))!;
    expect(contentHash(again)).toBe(contentHash({ ...b, design: Object.fromEntries(Object.entries(b.design).reverse()) as typeof b.design }));
    expect(await store.claimForSend(claimReq(b, { expectedContentHash: contentHash(again) }))).toEqual({ ok: true });
  });

  it('saveBroadcastIf refuses a stale write and a wrong status', async () => {
    const t = `t-${uid()}`;
    const b = await seedBroadcast(t);
    const stale = contentHash(b);
    await db.collection('tenants').doc(t).collection('emailBroadcasts').doc(b.id).update({ preheader: 'changed' });
    expect(await store.saveBroadcastIf({ ...b, status: 'scheduled' }, ['draft'], stale)).toBe(false);
    expect((await store.getBroadcast(t, b.id))?.status).toBe('draft');
    expect(await store.saveBroadcastIf({ ...b, status: 'scheduled' }, ['sent'])).toBe(false);
    expect(await store.saveBroadcastIf({ ...b, status: 'scheduled' }, ['draft'])).toBe(true);
  });
});

describe('settleSend is one Firestore transaction', () => {
  async function claimed(requested = 10) {
    const t = `t-${uid()}`;
    const b = await seedBroadcast(t);
    const sendId = `s-${uid()}`;
    expect(await store.claimForSend(claimReq(b, { sendId, requested, expectedContentHash: contentHash(b) }))).toEqual({ ok: true });
    return { t, b, sendId };
  }

  it('writes the final state once, refunds only what did not go out, and clears the marker', async () => {
    const { t, b, sendId } = await claimed(10);
    const done = { ...b, status: 'partial' as const, sendId, stats: { recipients: 10, sent: 7, failed: 3, skippedSuppressed: 0, skippedNotOptedIn: 0 } };
    const [first, second] = await Promise.all([
      store.settleSend({ broadcast: done, settlement: { month: MONTH, day: DAY, refund: 3 } }),
      store.settleSend({ broadcast: done, settlement: { month: MONTH, day: DAY, refund: 3 } }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await used(t)).toBe(7);
    expect(await used(t, DAY)).toBe(7);
    expect((await store.getBroadcast(t, b.id))?.status).toBe('partial');
    expect((await db.collection(SENDING_QUEUE).doc(`${t}__${b.id}`).get()).exists).toBe(false);
  });

  it('a settle under a different sendId changes nothing', async () => {
    const { t, b } = await claimed(10);
    expect(await store.settleSend({ broadcast: { ...b, status: 'sent', sendId: 'someone-else' }, settlement: { month: MONTH, day: DAY, refund: 10 } })).toBe(false);
    expect(await used(t)).toBe(10);
    expect((await store.getBroadcast(t, b.id))?.status).toBe('sending');
  });

  it('a send nobody settled is found by age, and closing it keeps the reservation', async () => {
    const { t, b, sendId } = await claimed(10);
    await db.collection(SENDING_QUEUE).doc(`${t}__${b.id}`).update({ claimedAt: '2031-03-10T11:00:00.000Z' });
    const stale = await store.listStaleSending('2031-03-10T11:30:00.000Z');
    expect(stale).toContainEqual({ tenantId: t, broadcastId: b.id, sendId });
    expect(await store.listStaleSending('2031-03-10T10:00:00.000Z')).not.toContainEqual({ tenantId: t, broadcastId: b.id, sendId });
    expect(await store.settleSend({ broadcast: { ...b, status: 'failed', sendId }, settlement: null })).toBe(true);
    expect(await used(t)).toBe(10);
  });
});

describe('the confirm token is one Firestore transaction', () => {
  const binding = (t: string) => ({ action: 'send' as const, tenantId: t, uid: 'u', broadcastId: 'b', payloadHash: 'h' });

  it('of many concurrent confirms with one token, exactly one is ok and the rest are reused', async () => {
    const ledger = firestoreEmailLedger();
    const t = `t-${uid()}`;
    const token = await ledger.issue(binding(t), Date.now());
    const results = await Promise.all(Array.from({ length: 6 }, () => ledger.consume(token, binding(t), Date.now())));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'reused')).toHaveLength(5);
  });

  it('a different ministry, user or payload is a mismatch and does not spend the token', async () => {
    const ledger = firestoreEmailLedger();
    const t = `t-${uid()}`;
    const token = await ledger.issue(binding(t), Date.now());
    expect(await ledger.consume(token, { ...binding(t), tenantId: 'other' }, Date.now())).toBe('mismatch');
    expect(await ledger.consume(token, { ...binding(t), payloadHash: 'changed' }, Date.now())).toBe('mismatch');
    expect(await ledger.consume(token, binding(t), Date.now())).toBe('ok');
  });

  it('purges expired tokens, used or not, and keeps live ones', async () => {
    const ledger = firestoreEmailLedger();
    const t = `t-${uid()}`;
    const old = await ledger.issue(binding(t), Date.now() - 60 * 60 * 1000);
    const spent = await ledger.issue(binding(t), Date.now() - 60 * 60 * 1000);
    await ledger.consume(spent, binding(t), Date.now() - 60 * 60 * 1000);
    const live = await ledger.issue(binding(t), Date.now());
    const removed = await ledger.purgeExpired(Date.now());
    expect(removed).toBeGreaterThanOrEqual(2);
    for (const gone of [old, spent]) expect((await db.collection(EMAIL_CONFIRM_TOKENS).doc(gone).get()).exists).toBe(false);
    expect((await db.collection(EMAIL_CONFIRM_TOKENS).doc(live).get()).exists).toBe(true);
    expect(await ledger.purgeExpired(Date.now())).toBe(0);
  });

  it('purges in more than one batch', async () => {
    const ledger = firestoreEmailLedger();
    const t = `t-${uid()}`;
    const past = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < 3; i += 1) {
      const batch = db.batch();
      for (let j = 0; j < 150; j += 1) batch.set(db.collection(EMAIL_CONFIRM_TOKENS).doc(`bulk-${t}-${i}-${j}`), { ...binding(t), expiresAt: past, expireAt: new Date(past), consumed: false });
      await batch.commit();
    }
    expect(await ledger.purgeExpired(Date.now())).toBeGreaterThanOrEqual(450);
    expect((await db.collection(EMAIL_CONFIRM_TOKENS).where('expiresAt', '<=', Date.now()).get()).size).toBe(0);
  });
});

describe('the domain registry is transactional and keeps placeholders', () => {
  it('of five ministries claiming one domain, exactly one gets it', async () => {
    const domain = `race-${uid()}.org`;
    const ids = Array.from({ length: 5 }, () => `t-${uid()}`);
    const results = await Promise.all(ids.map((t) => store.claimDomain(t, domain)));
    expect(results.filter((r) => r === 'fresh')).toHaveLength(1);
    expect(results.filter((r) => r === 'taken')).toHaveLength(4);
    expect(await store.getDomainOwner(domain)).toBe(ids[results.indexOf('fresh')]);
  });

  it('a release leaves a placeholder that blocks everyone but the releaser, who can take it back', async () => {
    const domain = `moved-${uid()}.org`;
    const [a, b] = [`t-${uid()}`, `t-${uid()}`];
    expect(await store.claimDomain(a, domain)).toBe('fresh');
    expect(await store.claimDomain(a, domain)).toBe('own');
    expect(await store.claimDomain(b, domain)).toBe('taken');
    await store.releaseDomain(a, domain);
    const doc = await db.collection(DOMAIN_CLAIMS).doc(domain).get();
    expect(doc.exists).toBe(true);
    expect(doc.data()).toMatchObject({ tenantId: null, releasedBy: a });
    expect(await store.getDomainOwner(domain)).toBeNull();
    expect(await store.claimDomain(b, domain)).toBe('released');
    expect(await store.claimDomain(b, domain)).toBe('released');
    expect(await store.claimDomain(a, domain)).toBe('own');
    expect(await store.getDomainOwner(domain)).toBe(a);
  });

  it('only the holder can release, and discarding removes only a live claim of your own', async () => {
    const domain = `own-${uid()}.org`;
    const [a, b] = [`t-${uid()}`, `t-${uid()}`];
    await store.claimDomain(a, domain);
    await store.releaseDomain(b, domain);
    expect(await store.getDomainOwner(domain)).toBe(a);
    await store.discardClaim(b, domain);
    expect(await store.getDomainOwner(domain)).toBe(a);
    await store.discardClaim(a, domain);
    expect((await db.collection(DOMAIN_CLAIMS).doc(domain).get()).exists).toBe(false);
  });

  it('five racing claims after a release: nobody but the releaser gets in', async () => {
    const domain = `placeholder-${uid()}.org`;
    const a = `t-${uid()}`;
    await store.claimDomain(a, domain);
    await store.releaseDomain(a, domain);
    const others = Array.from({ length: 5 }, () => `t-${uid()}`);
    const results = await Promise.all(others.map((t) => store.claimDomain(t, domain)));
    expect(results.every((r) => r === 'released')).toBe(true);
    expect(await store.getDomainOwner(domain)).toBeNull();
  });
});

describe('feedback events count once', () => {
  it('of five concurrent deliveries of one event, one is counted', async () => {
    const t = `t-${uid()}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => store.claimFeedbackEvent(t, 'bounced:em_1', NOW)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.claimFeedbackEvent(t, 'bounced:em_2', NOW)).toBe(true);
    expect(await store.claimFeedbackEvent(`t-${uid()}`, 'bounced:em_1', NOW)).toBe(true);
  });

  it('a released event can be claimed again, and releasing an unclaimed one is harmless', async () => {
    const t = `t-${uid()}`;
    expect(await store.claimFeedbackEvent(t, 'bounced:em_r', NOW)).toBe(true);
    expect(await store.claimFeedbackEvent(t, 'bounced:em_r', NOW)).toBe(false);
    await store.releaseFeedbackEvent(t, 'bounced:em_r');
    expect(await store.claimFeedbackEvent(t, 'bounced:em_r', NOW)).toBe(true);
    await expect(store.releaseFeedbackEvent(t, 'bounced:never')).resolves.toBeUndefined();
  });

  it('purges events past their expiry only', async () => {
    const t = `t-${uid()}`;
    await store.claimFeedbackEvent(t, 'bounced:old', '2020-01-01T00:00:00.000Z');
    await store.claimFeedbackEvent(t, 'bounced:new', new Date().toISOString());
    expect(await store.purgeExpiredFeedbackEvents(new Date().toISOString())).toBeGreaterThanOrEqual(1);
    expect((await db.collection(FEEDBACK_EVENTS).doc(`${t}__bounced:old`).get()).exists).toBe(false);
    expect((await db.collection(FEEDBACK_EVENTS).doc(`${t}__bounced:new`).get()).exists).toBe(true);
  });
});

describe('the whole send, service to Firestore', () => {
  const ROOT = { uid: 'root', email: 'root@theharvest.app', tenantId: null, isAdmin: true, isSuperAdmin: true };

  async function ministry(people = 4) {
    const t = `grace-${uid()}`;
    const domain = `${t}.org`;
    await db.collection('tenants').doc(t).set({ name: 'Grace Church', plan: 'pro', status: 'active', ownerId: 'owner', createdAt: '2020-01-01T00:00:00.000Z' });
    await db.collection('tenants').doc(t).collection('emailConfig').doc('settings').set({
      fromName: 'Grace Church', fromLocal: 'hello', replyTo: 'office@grace.org', mailingAddress: '1 Main St', domain, domainState: 'verified', domainRecords: [],
    });
    await store.claimDomain(t, domain);
    for (let i = 0; i < people; i += 1) {
      await db.collection('contacts').add({ tenantId: t, email: `p${i}-${t}@x.org`, firstName: 'Pat', lastName: `N${i}`, type: 'member', emailStatus: 'subscribed', emailOptInAt: NOW, emailOptInSource: 'import' });
    }
    const sent: { to: string }[] = [];
    const provider = {
      name: 'plunk' as const,
      async send(m: { to: string }) { await new Promise((r) => setTimeout(r, 5)); sent.push(m); return { ok: true as const, id: 'm' }; },
      async findDomain() { return null; },
      async registerDomain() { return { domain: '', state: 'verified' as const, records: [] }; },
      async getDomainStatus() { return { domain: '', state: 'verified' as const, records: [] }; },
    };
    const wrapped = { ...store };
    const service = createEmailService({ store: wrapped, ledger: firestoreEmailLedger(), getProvider: async () => provider, appOrigin: 'https://x.test' });
    return { t, service, sent, wrapped };
  }

  async function preview(service: ReturnType<typeof createEmailService>, t: string, id: string) {
    const p = await service.send(ROOT, t, { id, when: { mode: 'now' }, mode: 'preview' });
    if (!p.ok || !('confirmToken' in p)) throw new Error(`no preview: ${JSON.stringify(p)}`);
    return p.confirmToken;
  }

  it('two confirms with two valid tokens deliver exactly once and count the allowance once', async () => {
    const { t, service, sent } = await ministry(4);
    const saved = await service.saveDraft(ROOT, t, { subject: 'Sunday', bodyHtml: '<p>Hi {{first_name}}</p>' });
    if (!saved.ok) throw new Error('draft');
    const id = saved.broadcast.id;
    const [t1, t2] = [await preview(service, t, id), await preview(service, t, id)];
    const results = await Promise.all([
      service.send(ROOT, t, { id, when: { mode: 'now' }, mode: 'confirm', confirmToken: t1 }),
      service.send(ROOT, t, { id, when: { mode: 'now' }, mode: 'confirm', confirmToken: t2 }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([{ error: 'already_sent' }]);
    expect(sent).toHaveLength(4);
    const month = new Date().toISOString().slice(0, 7);
    expect(await used(t, month)).toBe(4);
    expect((await store.getBroadcast(t, id))).toMatchObject({ status: 'sent', stats: { sent: 4, failed: 0 } });
    expect((await db.collection(SENDING_QUEUE).doc(`${t}__${id}`).get()).exists).toBe(false);
  });

  it('a token spent once cannot send again', async () => {
    const { t, service, sent } = await ministry(2);
    const saved = await service.saveDraft(ROOT, t, { subject: 'Sunday', bodyHtml: '<p>Hi</p>' });
    if (!saved.ok) throw new Error('draft');
    const token = await preview(service, t, saved.broadcast.id);
    const confirm = () => service.send(ROOT, t, { id: saved.broadcast.id, when: { mode: 'now' }, mode: 'confirm', confirmToken: token });
    expect((await confirm()).ok).toBe(true);
    expect((await confirm()).ok).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it('an edit that lands between the read and the claim sends nothing and survives', async () => {
    const { t, service, sent, wrapped } = await ministry(3);
    const saved = await service.saveDraft(ROOT, t, { subject: 'Sunday', bodyHtml: '<p>Hi</p>' });
    if (!saved.ok) throw new Error('draft');
    const id = saved.broadcast.id;
    const token = await preview(service, t, id);
    const real = wrapped.listContacts;
    let edited = false;
    wrapped.listContacts = async (tenant) => {
      if (!edited) {
        edited = true;
        await db.collection('tenants').doc(t).collection('emailBroadcasts').doc(id).update({ bodyHtml: '<p>The edited letter.</p>' });
      }
      return real(tenant);
    };
    const r = await service.send(ROOT, t, { id, when: { mode: 'now' }, mode: 'confirm', confirmToken: token });
    expect(r).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(sent).toHaveLength(0);
    expect(await used(t, new Date().toISOString().slice(0, 7))).toBe(0);
    expect(await store.getBroadcast(t, id)).toMatchObject({ status: 'draft', bodyHtml: '<p>The edited letter.</p>' });
  });

  it('a stale send is closed from the overview, and its reservation stays counted', async () => {
    const { t, service } = await ministry(3);
    const saved = await service.saveDraft(ROOT, t, { subject: 'Sunday', bodyHtml: '<p>Hi</p>' });
    if (!saved.ok) throw new Error('draft');
    const b = (await store.getBroadcast(t, saved.broadcast.id))!;
    const month = new Date().toISOString().slice(0, 7);
    const long = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(await store.claimForSend(claimReq(b, { sendId: 'dead', nowIso: long, requested: 3, month, day: new Date().toISOString().slice(0, 10), expectedContentHash: contentHash(b) }))).toEqual({ ok: true });
    await service.list(ROOT, t);
    expect(await store.getBroadcast(t, b.id)).toMatchObject({ status: 'failed' });
    expect(await used(t, month)).toBe(3);
  });
});
