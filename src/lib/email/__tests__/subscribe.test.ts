import { describe, expect, it, vi } from 'vitest';

import type { EmailStatus } from '@/lib/email/audience';
import { resolveAudience } from '@/lib/email/audience';
import {
  CONFIRM_TTL_MS,
  buildToken,
  confirmSubscription,
  hashSecret,
  parseToken,
  requestSubscription,
  splitName,
  type SubscribeStore,
} from '@/lib/email/subscribe';
import { SUBSCRIBE_PATH, buildSubscribePageUrl } from '@/lib/email/subscribe-link';

vi.mock('server-only', () => ({}));

interface Row { id: string; tenantId: string; email: string; status: EmailStatus; tokenHash: string | null; expiresAt: string | null; firstName: string; lastName: string; optInSource?: string }

function memoryStore(seed: Row[] = [], tenant: { name: string } | null = { name: 'Grace Church' }) {
  const rows = [...seed];
  let n = 0;
  const store: SubscribeStore = {
    getTenant: async () => tenant,
    findContacts: async (tenantId, email) => rows.filter((r) => r.tenantId === tenantId && r.email === email).map((r) => ({ id: r.id, status: r.status, pending: r.tokenHash !== null })),
    createPending: async (tenantId, input) => {
      const id = `c${++n}`;
      rows.push({ id, tenantId, email: input.email, status: 'none', tokenHash: input.tokenHash, expiresAt: input.expiresAt, firstName: input.firstName, lastName: input.lastName });
      return id;
    },
    refreshPending: async (tenantId, id, input) => {
      const r = rows.find((x) => x.id === id && x.tenantId === tenantId)!;
      r.tokenHash = input.tokenHash;
      r.expiresAt = input.expiresAt;
    },
    getPending: async (tenantId, id) => {
      const r = rows.find((x) => x.id === id && x.tenantId === tenantId);
      return r ? { status: r.status, tokenHash: r.tokenHash, expiresAt: r.expiresAt } : null;
    },
    confirm: async (tenantId, id) => {
      const r = rows.find((x) => x.id === id && x.tenantId === tenantId)!;
      r.status = 'subscribed';
      r.optInSource = 'form';
      r.tokenHash = null;
      r.expiresAt = null;
    },
  };
  return { store, rows };
}

const NOW = new Date('2031-03-10T12:00:00.000Z');

function setup(seed: Row[] = [], opts: { send?: () => Promise<{ ok: boolean; error?: string }>; tenant?: { name: string } | null } = {}) {
  const mem = memoryStore(seed, opts.tenant === undefined ? { name: 'Grace Church' } : opts.tenant);
  const sent: { to: string; tenantName: string; confirmUrl: string }[] = [];
  const deps = {
    store: mem.store,
    origin: 'https://grace.theharvest.app',
    now: () => NOW,
    newSecret: () => 'abc123',
    sendConfirmation: async (input: { to: string; tenantName: string; confirmUrl: string }) => {
      sent.push(input);
      return opts.send ? opts.send() : { ok: true };
    },
  };
  return { ...mem, deps, sent };
}

const row = (over: Partial<Row>): Row => ({ id: 'x1', tenantId: 'grace', email: 'ana@x.org', status: 'none', tokenHash: null, expiresAt: null, firstName: 'Ana', lastName: '', ...over });

describe('requestSubscription: double opt-in', () => {
  it('creates a CRM contact that is NOT subscribed, and mails a confirmation link', async () => {
    const t = setup();
    const result = await requestSubscription(t.deps, { tenantId: 'grace', name: '  Ana   Rivera ', email: ' Ana@X.org ' });
    expect(result).toEqual({ ok: true, sent: true });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ tenantId: 'grace', email: 'ana@x.org', status: 'none', firstName: 'Ana', lastName: 'Rivera' });
    expect(t.rows[0].tokenHash).toBe(hashSecret('abc123'));
    expect(t.rows[0].expiresAt).toBe(new Date(NOW.getTime() + CONFIRM_TTL_MS).toISOString());
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toBe('ana@x.org');
    expect(t.sent[0].tenantName).toBe('Grace Church');
    expect(t.sent[0].confirmUrl).toBe(`https://grace.theharvest.app/api/email/subscribe/confirm?token=${encodeURIComponent('grace.c1.abc123')}`);
  });

  it('never stores the secret, only its hash', async () => {
    const t = setup();
    await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' });
    expect(JSON.stringify(t.rows)).not.toContain('abc123');
  });

  it('a pending contact is not reachable by a broadcast: resolveAudience skips it', async () => {
    const t = setup();
    await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' });
    const audience = resolveAudience([{ id: 'c1', email: 'ana@x.org', name: 'Ana', status: t.rows[0].status, tags: [], groups: [], source: '', joinedAt: '' }], []);
    expect(audience.recipients).toHaveLength(0);
    expect(audience.skipped.notOptedIn).toBe(1);
  });

  it.each([
    ['', 'ana@x.org', 'invalid_name'],
    ['x'.repeat(81), 'ana@x.org', 'invalid_name'],
    ['Ana', '', 'invalid_email'],
    ['Ana', 'not-an-email', 'invalid_email'],
    ['Ana', `${'a'.repeat(200)}@x.org`, 'invalid_email'],
  ])('refuses %j / %j with %s and writes nothing', async (name, email, code) => {
    const t = setup();
    const result = await requestSubscription(t.deps, { tenantId: 'grace', name, email });
    expect(result).toMatchObject({ ok: false, code });
    expect(t.rows).toHaveLength(0);
    expect(t.sent).toHaveLength(0);
  });

  it('refuses a ministry that is not taking sign-ups, and writes nothing', async () => {
    const t = setup([], { tenant: null });
    expect(await requestSubscription(t.deps, { tenantId: 'ghost', name: 'Ana', email: 'ana@x.org' })).toMatchObject({ ok: false, code: 'tenant_unavailable' });
    expect(t.rows).toHaveLength(0);
  });

  it('says so when the confirmation email did not go out, rather than telling the visitor to check their inbox', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = setup([], { send: async () => ({ ok: false, error: 'Email is not configured on this deployment, so nothing was sent.' }) });
    const result = await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' });
    expect(result).toMatchObject({ ok: false, code: 'send_failed' });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('an address already subscribed answers success and sends nothing, so the form cannot reveal who subscribes', async () => {
    const t = setup([row({ status: 'subscribed' })]);
    expect(await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' })).toEqual({ ok: true, sent: false });
    expect(t.sent).toHaveLength(0);
    expect(t.rows).toHaveLength(1);
  });

  it.each(['unsubscribed', 'bounced', 'complained'] as const)('a %s address is never re-enrolled by the form', async (status) => {
    const t = setup([row({ status })]);
    expect(await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' })).toEqual({ ok: true, sent: false });
    expect(t.sent).toHaveLength(0);
    expect(t.rows[0].status).toBe(status);
  });

  it('asking twice reuses the pending contact and replaces the link', async () => {
    const t = setup([row({ id: 'p1', tokenHash: hashSecret('old'), expiresAt: '2031-03-01T00:00:00.000Z' })]);
    await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].tokenHash).toBe(hashSecret('abc123'));
    expect(t.sent[0].confirmUrl).toContain(encodeURIComponent('grace.p1.abc123'));
  });

  it("another ministry's contact with the same address does not count as this ministry's subscriber", async () => {
    const t = setup([row({ tenantId: 'other', status: 'subscribed' })]);
    expect(await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' })).toEqual({ ok: true, sent: true });
    expect(t.rows.filter((r) => r.tenantId === 'grace')).toHaveLength(1);
  });
});

describe('confirmSubscription', () => {
  async function pending() {
    const t = setup();
    await requestSubscription(t.deps, { tenantId: 'grace', name: 'Ana', email: 'ana@x.org' });
    return t;
  }

  it('opening the link subscribes the contact with source form and clears the token', async () => {
    const t = await pending();
    expect(await confirmSubscription(t.deps, 'grace.c1.abc123')).toBe('confirmed');
    expect(t.rows[0]).toMatchObject({ status: 'subscribed', optInSource: 'form', tokenHash: null });
  });

  it('the same link a second time says the address is already subscribed', async () => {
    const t = await pending();
    await confirmSubscription(t.deps, 'grace.c1.abc123');
    expect(await confirmSubscription(t.deps, 'grace.c1.abc123')).toBe('already');
  });

  it('a wrong secret changes nothing', async () => {
    const t = await pending();
    expect(await confirmSubscription(t.deps, 'grace.c1.nope')).toBe('invalid');
    expect(t.rows[0].status).toBe('none');
  });

  it("a link cannot be replayed against another ministry's contact", async () => {
    const t = await pending();
    expect(await confirmSubscription(t.deps, 'other.c1.abc123')).toBe('invalid');
    expect(t.rows[0].status).toBe('none');
  });

  it('an expired link does not subscribe', async () => {
    const t = await pending();
    const later = { ...t.deps, now: () => new Date(NOW.getTime() + CONFIRM_TTL_MS + 1000) };
    expect(await confirmSubscription(later, 'grace.c1.abc123')).toBe('expired');
    expect(t.rows[0].status).toBe('none');
  });

  it('a contact who unsubscribed in the meantime stays unsubscribed', async () => {
    const t = await pending();
    t.rows[0].status = 'unsubscribed';
    expect(await confirmSubscription(t.deps, 'grace.c1.abc123')).toBe('invalid');
    expect(t.rows[0].status).toBe('unsubscribed');
  });

  it.each([undefined, null, '', 'abc', 'a.b', 'a.b.c.d', 'a..c', 42])('rejects the malformed token %j', async (token) => {
    const t = await pending();
    expect(await confirmSubscription(t.deps, token)).toBe('invalid');
  });
});

describe('helpers', () => {
  it('token round-trips', () => {
    expect(parseToken(buildToken('grace', 'c1', 'abc'))).toEqual({ tenantId: 'grace', contactId: 'c1', secret: 'abc' });
  });
  it('splits a name on whitespace', () => {
    expect(splitName('Ana')).toEqual({ firstName: 'Ana', lastName: '' });
    expect(splitName('Ana Maria Rivera')).toEqual({ firstName: 'Ana', lastName: 'Maria Rivera' });
  });
});

describe('buildSubscribePageUrl', () => {
  it('builds the shareable link on the ministry subdomain', () => {
    expect(buildSubscribePageUrl('grace')).toBe(`https://grace.theharvest.app${SUBSCRIBE_PATH}`);
    expect(buildSubscribePageUrl(' Grace ')).toBe('https://grace.theharvest.app/subscribe');
  });
  it.each([null, undefined, '', 'a.b', 'evil.com/x', 'a b', '-x', 'x'.repeat(64), 42])('gives no link for %j', (id) => {
    expect(buildSubscribePageUrl(id)).toBeNull();
  });
});
