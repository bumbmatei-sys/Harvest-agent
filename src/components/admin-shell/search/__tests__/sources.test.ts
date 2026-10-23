import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildContentIndex,
  clearContentIndex,
  ensureContentIndex,
  INDEX_TTL_MS,
  indexKey,
  peekContentIndex,
} from '../content-index';
import { searchIndexed } from '../match';
import { CONTENT_SOURCES, READ_CAPS, type RawDoc, type ReadDocs, type ReadSpec } from '../sources';

/**
 * A stand-in for Firestore. `collections` is keyed by the collection path
 * ("docs", "tenants/grace/events"); a read of a path nobody stocked is a read
 * of an empty collection. Every call is recorded so a test can say what was
 * and was not read.
 */
function fakeFirestore(collections: Record<string, RawDoc[]>, overrides: Record<string, () => Promise<never>> = {}) {
  const calls: ReadSpec[] = [];
  const read: ReadDocs = vi.fn(async (spec: ReadSpec, tenantId: string) => {
    calls.push(spec);
    const key = spec.path.join('/');
    if (overrides[key]) return overrides[key]();
    // Like Firestore, a top-level read is narrowed by the query's tenant filter.
    // Rows are returned as stocked otherwise, so a test can plant a stray one.
    const stocked = collections[key] ?? [];
    return { docs: stocked.slice(0, spec.cap), truncated: stocked.length > spec.cap };
  });
  return { read, calls, paths: () => calls.map((c) => c.path.join('/')) };
}

const doc = (id: string, data: Record<string, unknown>): RawDoc => ({ id, data });
const ALL = new Set(['crm', 'newsletter', 'docs', 'courses', 'events', 'forms', 'blog', 'services', 'fundraising', 'community', 'churches', 'ai', 'checkin']);

const searchTitles = async (access: Set<string>, fs: ReturnType<typeof fakeFirestore>, query: string, tenantId = 'grace') => {
  const index = await buildContentIndex({ tenantId, access, read: fs.read });
  return searchIndexed(index.items, query).map((h) => `${h.entry.type}:${h.entry.title}`);
};

describe('tenant scope', () => {
  const stocked = () =>
    fakeFirestore({
      docs: [
        doc('n1', { tenantId: 'grace', title: 'Grace welcome plan', content: '<p>hello</p>' }),
        doc('n2', { tenantId: 'other', title: 'Other ministry welcome plan', content: '' }),
        doc('n3', { title: 'Untenanted welcome plan' }),
      ],
      contacts: [
        doc('c1', { tenantId: 'grace', firstName: 'Anna', lastName: 'Welcome', email: 'anna@grace.org' }),
        doc('c2', { tenantId: 'other', firstName: 'Mallory', lastName: 'Welcome', email: 'mallory@other.org' }),
      ],
      users: [
        doc('u1', { tenantId: 'grace', displayName: 'Grace Member Welcome', email: 'gm@grace.org' }),
        doc('u2', { tenantId: 'other', displayName: 'Other Member Welcome', email: 'om@other.org' }),
      ],
      courses: [
        doc('k1', { tenantId: 'grace', title: 'Welcome course', levels: [] }),
        doc('k2', { tenantId: 'other', title: 'Other welcome course', levels: [] }),
      ],
      blog_posts: [doc('b1', { tenantId: 'other', title: 'Other welcome post' })],
      campaigns: [doc('f1', { tenantId: 'other', title: 'Other welcome fund' })],
      churches: [doc('ch1', { tenantId: 'other', name: 'Other welcome campus' })],
      rag_sources: [doc('r1', { tenantId: 'other', title: 'Other welcome source' })],
      'tenants/grace/events': [doc('e1', { title: 'Grace welcome lunch' })],
      'tenants/other/events': [doc('e2', { title: 'Other welcome lunch' })],
    });

  it('never returns a document that belongs to another tenant', async () => {
    const found = await searchTitles(ALL, stocked(), 'welcome');
    expect(found.join('\n')).not.toMatch(/other|mallory|untenanted/i);
    expect(found).toEqual(
      expect.arrayContaining([
        'note:Grace welcome plan',
        'person:Anna Welcome',
        'person:Grace Member Welcome',
        'course:Welcome course',
        'event:Grace welcome lunch',
      ]),
    );
  });

  it('only reads under the current tenant: every path is its own, and top-level reads carry the tenant filter', async () => {
    const fs = stocked();
    await searchTitles(ALL, fs, 'welcome');
    for (const spec of fs.calls) {
      if (spec.path[0] === 'tenants') expect(spec.path[1]).toBe('grace');
      else expect(spec.byTenantField, `${spec.path.join('/')} is a top-level read without the tenant filter`).toBe(true);
    }
  });

  it('does not leak between tenants when the same viewer switches ministry', async () => {
    const fs = stocked();
    const graceIndex = await buildContentIndex({ tenantId: 'grace', access: ALL, read: fs.read });
    const otherIndex = await buildContentIndex({ tenantId: 'other', access: ALL, read: fs.read });
    const graceTitles = searchIndexed(graceIndex.items, 'welcome').map((h) => h.entry.title);
    const otherTitles = searchIndexed(otherIndex.items, 'welcome').map((h) => h.entry.title);
    expect(graceTitles.some((t) => /other/i.test(t))).toBe(false);
    expect(otherTitles).toEqual(expect.arrayContaining(['Other welcome lunch', 'Other welcome course']));
    expect(otherTitles.some((t) => /^grace/i.test(t))).toBe(false);
  });
});

describe('what a role without the tab gets', () => {
  const stocked = () =>
    fakeFirestore({
      docs: [doc('n1', { tenantId: 'grace', title: 'Staff handbook' })],
      contacts: [doc('c1', { tenantId: 'grace', firstName: 'Staff', lastName: 'Person', email: 's@grace.org', emailStatus: 'subscribed' })],
      users: [],
      'tenants/grace/forms': [doc('f1', { title: 'Staff survey' })],
      courses: [doc('k1', { tenantId: 'grace', title: 'Staff training', levels: [] })],
    });

  it('a staff role with only the Events tab reads and shows nothing from notes, people, forms or courses', async () => {
    const fs = stocked();
    const found = await searchTitles(new Set(['events']), fs, 'staff');
    expect(found).toEqual([]);
    expect(fs.paths()).toEqual(['tenants/grace/events']);
  });

  it('a role with Notes and Forms but not the CRM sees those and never reads contacts', async () => {
    const fs = stocked();
    const found = await searchTitles(new Set(['docs', 'forms']), fs, 'staff');
    expect(found.sort()).toEqual(['form:Staff survey', 'note:Staff handbook']);
    expect(fs.paths()).not.toContain('contacts');
    expect(fs.paths()).not.toContain('users');
  });

  it('a role with the Newsletter tab but not the CRM finds subscribers only, as subscribers', async () => {
    const fs = fakeFirestore({
      contacts: [
        doc('c1', { tenantId: 'grace', firstName: 'Opt', lastName: 'In', emailStatus: 'subscribed', email: 'in@grace.org' }),
        doc('c2', { tenantId: 'grace', firstName: 'Opt', lastName: 'Out', emailStatus: 'unsubscribed', email: 'out@grace.org' }),
        doc('c3', { tenantId: 'grace', firstName: 'Opt', lastName: 'Never', email: 'never@grace.org' }),
      ],
    });
    const found = await searchTitles(new Set(['newsletter']), fs, 'opt');
    expect(found).toEqual(['subscriber:Opt In']);
    expect(fs.paths()).toEqual(['contacts']);
  });

  it('a role with the CRM sees people as people, not as subscribers', async () => {
    const fs = stocked();
    const found = await searchTitles(new Set(['crm', 'newsletter']), fs, 'staff');
    expect(found).toEqual(['person:Staff Person']);
  });

  it('a viewer with no tabs at all reads nothing', async () => {
    const fs = stocked();
    const index = await buildContentIndex({ tenantId: 'grace', access: new Set(), read: fs.read });
    expect(index.items).toHaveLength(0);
    expect(fs.calls).toHaveLength(0);
  });
});

describe('what each source indexes', () => {
  it('indexes lessons from the course outline and points them at their course', async () => {
    const fs = fakeFirestore({
      courses: [
        doc('k1', {
          tenantId: 'grace',
          title: 'Foundations',
          status: 'published',
          levels: [{ id: 'l1', title: 'L', sections: [{ id: 's1', title: 'S', lessons: [{ id: 'a', title: 'Faith and works' }, { id: 'b', title: 'Grace alone' }] }] }],
        }),
      ],
    });
    const index = await buildContentIndex({ tenantId: 'grace', access: new Set(['courses']), read: fs.read });
    const hits = searchIndexed(index.items, 'faith');
    expect(hits.map((h) => [h.entry.type, h.entry.title, h.entry.subtitle, h.entry.itemId])).toEqual([
      ['lesson', 'Faith and works', 'Foundations', 'k1'],
    ]);
    const course = searchIndexed(index.items, 'foundations')[0].entry;
    expect(course).toMatchObject({ type: 'course', subtitle: 'Published · 2 lessons' });
  });

  it('survives malformed documents: no title, odd shapes, a lesson outline that is not an array', async () => {
    const fs = fakeFirestore({
      courses: [doc('k1', { tenantId: 'grace', levels: 'nope' }), doc('k2', { tenantId: 'grace', title: 7, levels: [{ sections: [null, { lessons: [null, { title: 3 }] }] }] })],
      docs: [doc('n1', { tenantId: 'grace', content: 12 })],
    });
    const index = await buildContentIndex({ tenantId: 'grace', access: new Set(['courses', 'docs']), read: fs.read });
    expect(index.failures).toEqual([]);
    expect(index.items.map((i) => i.entry.title).sort()).toEqual(['Untitled', 'Untitled course', 'Untitled course']);
  });

  it('folds an app member into the contact they already have, as the CRM does', async () => {
    const fs = fakeFirestore({
      contacts: [doc('c1', { tenantId: 'grace', firstName: 'Ana', lastName: 'Pop', email: 'Ana@Grace.org' })],
      users: [doc('u1', { tenantId: 'grace', displayName: 'Ana Pop', email: ' ana@grace.org ' }), doc('u2', { tenantId: 'grace', displayName: 'Bogdan Ilie', email: 'b@grace.org' })],
    });
    const index = await buildContentIndex({ tenantId: 'grace', access: new Set(['crm']), read: fs.read });
    expect(index.items.map((i) => [i.entry.id, i.entry.title]).sort()).toEqual([['c1', 'Ana Pop'], ['u2', 'Bogdan Ilie']]);
  });

  it('keeps notes, tags and addresses out of the people index', async () => {
    const fs = fakeFirestore({
      contacts: [doc('c1', { tenantId: 'grace', firstName: 'Ana', lastName: 'Pop', notes: 'secret pastoral note', tags: ['counselling'], address: { street: '1 Hidden Lane' } })],
      users: [],
    });
    const index = await buildContentIndex({ tenantId: 'grace', access: new Set(['crm']), read: fs.read });
    expect(JSON.stringify(index.items)).not.toMatch(/secret|counselling|Hidden/);
  });

  it('matches a note by the start of its body', async () => {
    const fs = fakeFirestore({ docs: [doc('n1', { tenantId: 'grace', title: 'Rota', content: '<p>Volunteers meet at <b>nine</b></p>' })] });
    expect(await searchTitles(new Set(['docs']), fs, 'volunteers meet')).toEqual(['note:Rota']);
  });
});

describe('failure and size', () => {
  it('reports a list that could not be read and keeps every other list', async () => {
    const denied = Object.assign(new Error('nope'), { code: 'permission-denied' });
    const fs = fakeFirestore(
      { docs: [doc('n1', { tenantId: 'grace', title: 'Still here' })] },
      { 'tenants/grace/forms': () => Promise.reject(denied), 'tenants/grace/events': () => Promise.reject(new Error('offline')) },
    );
    const index = await buildContentIndex({ tenantId: 'grace', access: new Set(['docs', 'forms', 'events']), read: fs.read });
    expect(index.items.map((i) => i.entry.title)).toEqual(['Still here']);
    expect(index.failures).toEqual([
      { source: 'events', label: 'Events', reason: 'failed' },
      { source: 'forms', label: 'Forms', reason: 'denied' },
    ]);
  });

  it('says so when a list was only partly read', async () => {
    const many = Array.from({ length: READ_CAPS.docs + 1 }, (_, i) => doc(`n${i}`, { tenantId: 'grace', title: `Note ${i}` }));
    const fs = fakeFirestore({ docs: many });
    const index = await buildContentIndex({ tenantId: 'grace', access: new Set(['docs']), read: fs.read });
    expect(index.items).toHaveLength(READ_CAPS.docs);
    expect(index.truncated).toEqual([{ label: 'Notes' }]);
  });

  it('puts a ceiling on a cold open: every read is capped and the worst case is the sum of the caps', async () => {
    const fs = fakeFirestore({});
    await buildContentIndex({ tenantId: 'grace', access: ALL, read: fs.read });
    expect(fs.calls.length).toBeGreaterThan(0);
    for (const spec of fs.calls) expect(Number.isFinite(spec.cap) && spec.cap > 0).toBe(true);
    const worstCase = fs.calls.reduce((sum, spec) => sum + spec.cap + 1, 0);
    expect(worstCase).toBeLessThanOrEqual(3000);
    expect(CONTENT_SOURCES.length).toBe(13);
  });
});

describe('session cache', () => {
  beforeEach(() => clearContentIndex());

  const opts = (fs: ReturnType<typeof fakeFirestore>, now: () => number) => ({ tenantId: 'grace', access: new Set(['docs']), read: fs.read, now });
  const key = indexKey('grace', 'u1', new Set(['docs']));
  const notes = () => fakeFirestore({ docs: [doc('n1', { tenantId: 'grace', title: 'One' })] });

  it('reads once, and serves the held index until it is older than the refresh window', async () => {
    const fs = notes();
    let clock = 1_000;
    await ensureContentIndex(key, opts(fs, () => clock));
    clock += INDEX_TTL_MS - 1;
    await ensureContentIndex(key, opts(fs, () => clock));
    expect(fs.calls).toHaveLength(1);
    clock += 2;
    await ensureContentIndex(key, opts(fs, () => clock));
    expect(fs.calls).toHaveLength(2);
  });

  it('shares one load between callers that ask while it is running', async () => {
    const fs = notes();
    const [a, b] = await Promise.all([ensureContentIndex(key, opts(fs, () => 1)), ensureContentIndex(key, opts(fs, () => 1))]);
    expect(a).toBe(b);
    expect(fs.calls).toHaveLength(1);
  });

  it('drops the held index when another user or tenant asks', async () => {
    const fs = notes();
    await ensureContentIndex(key, opts(fs, () => 1));
    expect(peekContentIndex(key)).not.toBeNull();
    await ensureContentIndex(indexKey('grace', 'u2', new Set(['docs'])), opts(fs, () => 1));
    expect(peekContentIndex(key)).toBeNull();
  });

  it('retries a list that failed on the next open instead of serving the gap for five minutes', async () => {
    let failing = true;
    const read: ReadDocs = vi.fn(async () => {
      if (failing) throw new Error('offline');
      return { docs: [doc('n1', { tenantId: 'grace', title: 'One' })], truncated: false };
    });
    const first = await ensureContentIndex(key, { tenantId: 'grace', access: new Set(['docs']), read, now: () => 1 });
    expect(first.failures).toHaveLength(1);
    failing = false;
    const second = await ensureContentIndex(key, { tenantId: 'grace', access: new Set(['docs']), read, now: () => 2 });
    expect(second.failures).toEqual([]);
    expect(second.items).toHaveLength(1);
  });

  it('keys on the tabs that matter, so an unrelated nav change does not evict', () => {
    expect(indexKey('t', 'u', new Set(['docs', 'dashboard', 'branding']))).toBe(indexKey('t', 'u', new Set(['docs'])));
    expect(indexKey('t', 'u', new Set(['docs', 'crm']))).not.toBe(indexKey('t', 'u', new Set(['docs'])));
  });
});
