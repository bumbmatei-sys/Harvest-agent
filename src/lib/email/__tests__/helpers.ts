import { memoryEmailLedger } from '@/lib/email/confirm';
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

export function mockProvider(opts: { failFor?: ReadonlySet<string> } = {}): EmailProvider & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  const status: DomainStatus = { domain: 'mail.grace.org', state: 'verified', records: [] };
  return {
    name: 'plunk',
    sent,
    async send(message) {
      if (opts.failFor?.has(message.to)) return { ok: false, error: 'boom', retryable: false };
      sent.push(message);
      return { ok: true, id: `m${sent.length}` };
    },
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
  const created: NewContact[] = [];
  const updated: ContactUpdate[] = [];
  const store: EmailStore = {
    async getTenant() { return { name: 'Grace Church', plan: seed.plan ?? 'pro', status: 'active', ownerId: 'owner', createdAt: 'createdAt' in seed ? seed.createdAt : '2020-01-01T00:00:00.000Z' }; },
    async getLimits() { return limits; },
    async saveLimits(l) { limits = l; },
    async getSendingState() { return sending; },
    async setSendingState(_t, state) { sending = state; },
    async getAdminEmails() { return []; },
    async getPermissions() { return {}; },
    async getSettings() { return settings; },
    async saveSettings(_t, next) { settings = next; },
    async getBroadcast(_t, id) { return broadcasts.get(id) ?? null; },
    async saveBroadcast(b) { broadcasts.set(b.id, b); },
    async removeBroadcast(_t, id) { broadcasts.delete(id); },
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
    async addUsage(_t, key, n) { usage.set(key, (usage.get(key) ?? 0) + n); },
    async health(_t, month) { return { sent: usage.get(month) ?? 0, ...feedback }; },
    async addFeedback(_t, _m, kind) { feedback[kind] += 1; },
    async markContactStatus(_t, email, status) {
      for (const [id, c] of contacts) if (c.email === email) contacts.set(id, { ...c, status });
    },
    async queueScheduled(t, id, at) { queue.set(`${t}__${id}`, at); },
    async unqueueScheduled(t, id) { queue.delete(`${t}__${id}`); },
    async listDue(nowIso) {
      return [...queue.entries()].filter(([, at]) => at <= nowIso).map(([k]) => { const [tenantId, broadcastId] = k.split('__'); return { tenantId, broadcastId }; });
    },
    async recordOptOut(_t, email) {
      for (const [id, c] of contacts) if (c.email === email) contacts.set(id, { ...c, status: 'unsubscribed' });
    },
  };
  return { store, contacts, broadcasts, queue, created, updated, usage, feedback, get used() { return usage.get(monthKey(NOW)) ?? 0; }, get today() { return usage.get(dayKey(NOW)) ?? 0; }, get sending() { return sending; }, get limits() { return limits; } };
}

export function person(email: string, over: Partial<EmailContact> = {}): EmailContact {
  return { id: `c-${email}`, email, name: 'Alex Doe', status: 'subscribed', tags: [], groups: ['Members'], source: 'import', joinedAt: '2031-01-01T00:00:00.000Z', ...over };
}

export const admin: EmailActor = { uid: 'owner', email: 'owner@grace.org', tenantId: TENANT, isAdmin: true, isSuperAdmin: false };

export function build(seed: Parameters<typeof memoryStore>[0] = {}, provider = mockProvider(), fallbackFrom: string | null = null) {
  const mem = memoryStore(seed);
  const ledger = memoryEmailLedger();
  let n = 0;
  const service = createEmailService({
    store: mem.store,
    ledger,
    getProvider: async () => provider,
    appOrigin: 'https://grace.theharvest.app',
    fallbackFrom,
    now: () => NOW,
    newId: () => `b${++n}`,
  });
  return { service, mem, ledger, provider };
}
