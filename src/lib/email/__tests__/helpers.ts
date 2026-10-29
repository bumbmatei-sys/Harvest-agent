import { memoryEmailLedger } from '@/lib/email/confirm';
import { contentHash, decideClaim, sendingMarkerId } from '@/lib/email/claim';
import { dayKey, monthKey } from '@/lib/email/volume-cap';
import type { EmailContact } from '@/lib/email/audience';
import type { DomainStatus, EmailProvider, OutboundEmail } from '@/lib/email/provider';
import {
  EMPTY_SETTINGS,
  createEmailService,
  type Broadcast,
  type ContactUpdate,
  type EmailActor,
  type EmailSettings,
  type EmailStore,
  type NewContact,
  type SendingState,
} from '@/lib/email/service';

export const TENANT = 'grace';
export const NOW = new Date('2031-03-10T12:00:00.000Z');

export function mockProvider(opts: { failFor?: ReadonlySet<string>; timeoutFor?: ReadonlySet<string>; throwFor?: ReadonlySet<string>; delayMs?: number; onSend?: () => void; known?: Record<string, DomainStatus['state']> } = {}): EmailProvider & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  const status: DomainStatus = { domain: 'mail.grace.org', state: 'verified', records: [] };
  return {
    name: 'plunk',
    sent,
    async send(message) {
      opts.onSend?.();
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.throwFor?.has(message.to)) throw new Error('network down');
      if (opts.timeoutFor?.has(message.to)) return { ok: false, error: 'Plunk did not answer within 15 seconds.', retryable: true, maybeDelivered: true };
      if (opts.failFor?.has(message.to)) return { ok: false, error: 'boom', retryable: false };
      sent.push(message);
      return { ok: true, id: `m${sent.length}` };
    },
    async findDomain(domain) { const state = opts.known?.[domain]; return state ? { domain, state, records: [] } : null; },
    async registerDomain() { return status; },
    async getDomainStatus() { return status; },
  };
}

export function memoryStore(seed: {
  plan?: string;
  contacts?: EmailContact[];
  settings?: Partial<EmailSettings>;
  usage?: number;
  usageByKey?: Record<string, number>;
  createdAt?: unknown;
  limits?: unknown;
  domainOwners?: Record<string, string>;
  /** Domains a ministry released: domain -> the ministry that released it. */
  releasedDomains?: Record<string, string>;
  permissions?: Record<string, boolean>;
  ownerId?: string | null;
  adminEmails?: string[];
  suppressed?: string[];
  tenantCreatedAt?: unknown;
  health?: Partial<{ bounced: number; complained: number }>;
} = {}) {
  const contacts = new Map<string, EmailContact>((seed.contacts ?? []).map((c) => [c.id, c]));
  const broadcasts = new Map<string, Broadcast>();
  let settings: EmailSettings = {
    ...EMPTY_SETTINGS,
    fromName: 'Grace Church',
    replyTo: 'office@grace.org',
    mailingAddress: '1 Main St, Springfield',
    domain: 'grace.org',
    domainState: 'verified',
    ...seed.settings,
  };
  const usage = new Map<string, number>(Object.entries(seed.usageByKey ?? {}));
  if (seed.usage) usage.set(monthKey(NOW), seed.usage);
  const feedback = { bounced: seed.health?.bounced ?? 0, complained: seed.health?.complained ?? 0 };
  let limits: unknown = seed.limits ?? null;
  let sending: SendingState | null = null;
  const queue = new Map<string, string>();
  const sendingMarkers = new Map<string, { tenantId: string; broadcastId: string; sendId: string; claimedAt: string }>();
  const domainOwners = new Map<string, string>(Object.entries(seed.domainOwners ?? { 'grace.org': 'grace' }));
  const released = new Map<string, string>(Object.entries(seed.releasedDomains ?? {}));
  const feedbackEvents = new Set<string>();
  const suppressedEmails = new Set<string>(seed.suppressed ?? []);
  const created: NewContact[] = [];
  const updated: ContactUpdate[] = [];
  const store: EmailStore = {
    async getTenant() { return { name: 'Grace Church', plan: seed.plan ?? 'ministry', status: 'active', ownerId: 'ownerId' in seed ? seed.ownerId ?? null : 'owner', createdAt: 'createdAt' in seed ? seed.createdAt : '2020-01-01T00:00:00.000Z' }; },
    async getLimits() { return limits; },
    async saveLimits(l) { limits = l; },
    async getSendingState() { return sending; },
    async setSendingState(_t, state) { sending = state; },
    async getAdminEmails() { return seed.adminEmails ?? []; },
    async getPermissions() { return seed.permissions ?? {}; },
    async getSettings() { return settings; },
    async saveSettings(_t, next) { settings = next; },
    async getBroadcast(_t, id) { return broadcasts.get(id) ?? null; },
    async saveBroadcast(b) { broadcasts.set(b.id, b); },
    async saveBroadcastIf(b, statuses, expectedContentHash) {
      const cur = broadcasts.get(b.id);
      if (!cur || !statuses.includes(cur.status)) return false;
      if (expectedContentHash !== undefined && contentHash(cur) !== expectedContentHash) return false;
      broadcasts.set(b.id, b);
      return true;
    },
    async removeBroadcastIf(_t, id, statuses) {
      const cur = broadcasts.get(id);
      if (!cur || !statuses.includes(cur.status)) return false;
      broadcasts.delete(id);
      return true;
    },
    // No await between the reads and the writes: like a Firestore transaction, nothing interleaves.
    async claimForSend(req) {
      const cur = broadcasts.get(req.broadcastId);
      const decision = decideClaim(cur?.status ?? null, cur ? contentHash(cur) : null, usage.get(req.month) ?? 0, usage.get(req.day) ?? 0, req);
      if (!decision.ok) return decision;
      broadcasts.set(req.broadcastId, { ...cur!, status: 'sending', sendId: req.sendId, error: null, scheduledAt: null, updatedAt: req.nowIso });
      usage.set(req.month, (usage.get(req.month) ?? 0) + req.requested);
      usage.set(req.day, (usage.get(req.day) ?? 0) + req.requested);
      sendingMarkers.set(sendingMarkerId(req.tenantId, req.broadcastId), { tenantId: req.tenantId, broadcastId: req.broadcastId, sendId: req.sendId, claimedAt: req.nowIso });
      queue.delete(`${req.tenantId}__${req.broadcastId}`);
      return decision;
    },
    async settleSend({ broadcast, settlement }) {
      const cur = broadcasts.get(broadcast.id);
      if (!cur || cur.status !== 'sending' || cur.sendId !== broadcast.sendId) return false;
      broadcasts.set(broadcast.id, broadcast);
      sendingMarkers.delete(sendingMarkerId(broadcast.tenantId, broadcast.id));
      if (settlement && settlement.refund > 0) {
        usage.set(settlement.month, (usage.get(settlement.month) ?? 0) - settlement.refund);
        usage.set(settlement.day, (usage.get(settlement.day) ?? 0) - settlement.refund);
      }
      return true;
    },
    async listStaleSending(cutoff) { return [...sendingMarkers.values()].filter((m) => m.claimedAt <= cutoff); },
    async claimDomain(tenantId, domain) {
      const owner = domainOwners.get(domain);
      if (owner) return owner === tenantId ? 'own' : 'taken';
      const releasedBy = released.get(domain);
      if (releasedBy !== undefined) {
        if (releasedBy !== tenantId) return 'released';
        released.delete(domain);
        domainOwners.set(domain, tenantId);
        return 'own';
      }
      domainOwners.set(domain, tenantId);
      return 'fresh';
    },
    async releaseDomain(tenantId, domain) {
      if (domainOwners.get(domain) !== tenantId) return;
      domainOwners.delete(domain);
      released.set(domain, tenantId);
    },
    async discardClaim(tenantId, domain) { if (domainOwners.get(domain) === tenantId) domainOwners.delete(domain); },
    async claimFeedbackEvent(_t, key) {
      if (feedbackEvents.has(key)) return false;
      feedbackEvents.add(key);
      return true;
    },
    async releaseFeedbackEvent(_t, key) { feedbackEvents.delete(key); },
    async purgeExpiredFeedbackEvents() { const n = feedbackEvents.size; feedbackEvents.clear(); return n; },
    async getDomainOwner(domain) { return domainOwners.get(domain) ?? null; },
    async listSuppressed() { return suppressedEmails; },
    async isSuppressedNow(_t, email) { return suppressedEmails.has(email); },
    async listBroadcasts() { return [...broadcasts.values()]; },
    async listContacts() { return [...contacts.values()]; },
    async createContacts(_t, rows) {
      for (const r of rows) {
        created.push(r);
        contacts.set(`new-${r.email}`, { id: `new-${r.email}`, email: r.email, name: `${r.firstName} ${r.lastName}`.trim(), status: 'subscribed', tags: r.tags, groups: ['Members'], source: r.source, joinedAt: r.at });
      }
    },
    async updateContacts(_t, ups) {
      for (const u of ups) {
        updated.push(u);
        const c = contacts.get(u.id);
        if (c) contacts.set(u.id, { ...c, status: u.subscribe ? 'subscribed' : c.status, tags: [...new Set([...c.tags, ...u.addTags])] });
      }
    },
    async usage(_t, key) { return usage.get(key) ?? 0; },
    async health(_t, month) { return { sent: usage.get(month) ?? 0, ...feedback }; },
    async addFeedback(_t, _m, kind) { feedback[kind] += 1; },
    async markContactStatus(_t, email, status) {
      suppressedEmails.add(email);
      for (const [id, c] of contacts) if (c.email === email) contacts.set(id, { ...c, status });
    },
    async queueScheduled(t, id, at) { queue.set(`${t}__${id}`, at); },
    async unqueueScheduled(t, id) { queue.delete(`${t}__${id}`); },
    async listDue(nowIso) {
      return [...queue.entries()].filter(([, at]) => at <= nowIso).map(([k]) => { const [tenantId, broadcastId] = k.split('__'); return { tenantId, broadcastId }; });
    },
    async recordOptOut(_t, email) {
      suppressedEmails.add(email);
      for (const [id, c] of contacts) if (c.email === email) contacts.set(id, { ...c, status: 'unsubscribed' });
    },
  };
  return { store, contacts, broadcasts, queue, sendingMarkers, domainOwners, released, feedbackEvents, suppressedEmails, created, updated, usage, feedback, get used() { return usage.get(monthKey(NOW)) ?? 0; }, get today() { return usage.get(dayKey(NOW)) ?? 0; }, get sending() { return sending; }, get limits() { return limits; } };
}

export function person(email: string, over: Partial<EmailContact> = {}): EmailContact {
  return { id: `c-${email}`, email, name: 'Alex Doe', status: 'subscribed', tags: [], groups: ['Members'], source: 'import', joinedAt: '2031-01-01T00:00:00.000Z', ...over };
}

export const admin: EmailActor = { uid: 'owner', email: 'owner@grace.org', tenantId: TENANT, isAdmin: true, isSuperAdmin: false };

export function build(seed: Parameters<typeof memoryStore>[0] = {}, provider = mockProvider(), fallbackFrom: string | null = null, extra: { clockMs?: () => number; sendBudgetMs?: number; now?: () => Date } = {}) {
  const mem = memoryStore(seed);
  const ledger = memoryEmailLedger();
  let n = 0;
  const service = createEmailService({
    store: mem.store,
    ledger,
    getProvider: async () => provider,
    appOrigin: 'https://grace.theharvest.app',
    fallbackFrom,
    now: extra.now ?? (() => NOW),
    clockMs: extra.clockMs,
    sendBudgetMs: extra.sendBudgetMs,
    newId: () => `b${++n}`,
  });
  return { service, mem, ledger, provider };
}
