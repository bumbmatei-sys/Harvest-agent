import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';
import { CONFIRM_TOKEN_TTL_MS, confirmTokenFields, decideConsume, memoryConfirmLedger } from '@/lib/blog/confirm-token';
import {
  createBlogService,
  dispatchBlogAction,
  type BlogActor,
  type BlogAuditEvent,
  type BlogDraftInput,
  type BlogEffect,
  type BlogFailure,
  type BlogService,
  type BlogStore,
  type StoredBlogPost,
} from '@/lib/blog/service';
import { renderBlogRss, renderBlogSitemap } from '@/lib/blog/feeds';
import { isBlogPostPublic, scheduleWallClockError, wallClockToUtcIso } from '@/lib/blog/visibility';
import { ARCHIVED_ACTION_MESSAGE, TENANT_STATUS_ARCHIVED } from '@/lib/tenant-lifecycle';

const NOW = '2026-06-01T15:00:00.000Z';
const SCHEDULED_AT = '2026-07-20T16:00:00.000Z';
const ZONE = 'America/Los_Angeles';
const WALL = '2026-07-20T09:00';

interface TenantSeed {
  readonly name: string;
  readonly status?: unknown;
  readonly ownerId?: string | null;
  readonly adminEmails?: readonly string[];
}

interface Harness {
  readonly service: BlogService;
  readonly inserts: StoredBlogPost[];
  readonly saves: StoredBlogPost[];
  readonly removes: string[];
  readonly audits: BlogAuditEvent[];
  readonly ledger: ReturnType<typeof memoryConfirmLedger>;
}

function actor(over: Partial<BlogActor> = {}): BlogActor {
  return {
    uid: 'admin-1',
    email: 'admin@sample.org',
    tenantId: 'sample',
    isAdmin: true,
    isSuperAdmin: false,
    ...over,
  };
}

function samplePost(over: Partial<StoredBlogPost> & Pick<StoredBlogPost, 'id' | 'tenantId' | 'status'>): StoredBlogPost {
  return {
    title: 'Sunday reflection',
    category: 'Teaching',
    content: '<p>A sample paragraph.</p>',
    featuredImage: null,
    tags: [],
    publishedAt: null,
    scheduleTimeZone: null,
    authorId: 'author-1',
    createdAt: '2026-01-04T18:00:00.000Z',
    updatedAt: '2026-01-04T18:00:00.000Z',
    seoTitle: 'Sunday reflection',
    seoDescription: 'A sample paragraph.',
    keywords: ['sample'],
    ...over,
  };
}

function harness(opts: {
  tenants?: Record<string, TenantSeed>;
  posts?: readonly StoredBlogPost[];
  permissions?: Record<string, Record<string, boolean>>;
  skipped?: number;
  now?: string;
  clock?: () => Date;
}): Harness {
  const posts = new Map((opts.posts ?? []).map((post) => [post.id, post]));
  const inserts: StoredBlogPost[] = [];
  const saves: StoredBlogPost[] = [];
  const removes: string[] = [];
  const audits: BlogAuditEvent[] = [];
  const ledger = memoryConfirmLedger();
  const tenants = opts.tenants ?? { sample: { name: 'Sample Ministry', ownerId: 'owner-1' } };
  const store: BlogStore = {
    async getTenant(tenantId) {
      const tenant = tenants[tenantId];
      if (!tenant?.name) return null;
      return { name: tenant.name, status: tenant.status ?? 'active', ownerId: tenant.ownerId ?? null };
    },
    async getAdminEmails(tenantId) {
      return tenants[tenantId]?.adminEmails ?? [];
    },
    async getPermissions(uid) {
      return opts.permissions?.[uid] ?? {};
    },
    async getPost(id) {
      return posts.get(id) ?? null;
    },
    async insertPost(post) {
      inserts.push(post);
      posts.set(post.id, post);
    },
    async savePost(post) {
      saves.push(post);
      posts.set(post.id, post);
    },
    async removePost(id) {
      removes.push(id);
      posts.delete(id);
    },
    async listByTenant(tenantId) {
      return {
        posts: [...posts.values()].filter((post) => post.tenantId === tenantId),
        skipped: opts.skipped ?? 0,
      };
    },
    async appendAudit(event) {
      audits.push(event);
    },
  };
  return {
    service: createBlogService({
      store,
      ledger,
      now: opts.clock ?? (() => new Date(opts.now ?? NOW)),
      newId: () => 'post-new',
    }),
    inserts,
    saves,
    removes,
    audits,
    ledger,
  };
}

function tokenFrom(result: { ok: true; confirmToken?: string } | BlogFailure): string {
  if (!result.ok || !result.confirmToken) throw new Error('preview did not issue a token');
  return result.confirmToken;
}

const writer = actor();
const scheduleInput: BlogDraftInput = {
  tenantId: 'sample',
  postId: 'reflection',
  title: 'Sunday reflection',
  category: 'Teaching',
  content: '<p>A sample paragraph.</p>',
  wallClock: WALL,
  timeZone: ZONE,
};

function effectOf(result: { ok: true; preview: BlogEffect } | BlogFailure): BlogEffect {
  if (!result.ok) throw new Error(result.message);
  return result.preview;
}

describe('wall clock', () => {
  it('stores a Los Angeles morning as UTC', () => {
    expect(wallClockToUtcIso(WALL, ZONE)).toBe(SCHEDULED_AT);
  });

  it('rejects a wall clock that does not exist', () => {
    expect(wallClockToUtcIso('2026-03-08T02:30', ZONE)).toBeNull();
  });

  it('refuses a schedule with the same sentence the editor shows', async () => {
    const { service, saves } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'sample', status: 'draft' })],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const now = new Date(NOW);
    const cases = [
      { wallClock: '', timeZone: ZONE },
      { wallClock: '2020-01-01T09:00', timeZone: ZONE },
      { wallClock: WALL, timeZone: 'Not/AZone' },
      { wallClock: '2026-03-08T02:30', timeZone: ZONE },
    ];
    for (const item of cases) {
      const shown = scheduleWallClockError(item.wallClock, item.timeZone, now);
      const result = await service.schedule(writer, { ...scheduleInput, ...item }, 'confirm');
      expect(shown).toEqual(expect.any(String));
      expect(result).toMatchObject({ ok: false, message: shown });
    }
    expect(saves).toEqual([]);
  });
});

describe('permissions and tenant scope', () => {
  const actions = ['schedule', 'publishNow', 'unschedule', 'delete', 'createDraft', 'listByDateRange'] as const;

  it.each(actions)('denies %s across ministries', async (action) => {
    const { service, inserts, saves, removes } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'sample', status: 'scheduled', publishedAt: SCHEDULED_AT })],
    });
    const other = actor({ tenantId: 'other' });
    const result = await dispatchBlogAction(service, other, {
      ...scheduleInput,
      action,
      mode: 'confirm',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ ok: false, error: 'cross_tenant' });
    expect(inserts).toEqual([]);
    expect(saves).toEqual([]);
    expect(removes).toEqual([]);
  });

  it('denies an admin who lacks the articles permission', async () => {
    const { service, saves } = harness({ permissions: { 'admin-1': { manageEvents: true } } });
    const result = await service.schedule(writer, scheduleInput, 'confirm');
    expect(result).toMatchObject({ ok: false, error: 'not_authorized' });
    expect(saves).toEqual([]);
  });

  it('allows the articles permission, full access, the owner, and the roster', async () => {
    const fields = { ...scheduleInput, postId: null };
    const withArticles = harness({ permissions: { 'admin-1': { writeArticles: true } } });
    expect((await withArticles.service.schedule(writer, fields, 'preview')).ok).toBe(true);

    const withFull = harness({ permissions: { 'admin-1': { fullAccess: true } } });
    expect((await withFull.service.publishNow(writer, fields, 'preview')).ok).toBe(true);

    const owner = harness({ tenants: { sample: { name: 'Sample Ministry', ownerId: 'owner-1' } } });
    expect((await owner.service.schedule(actor({ uid: 'owner-1', isAdmin: false, email: null }), fields, 'preview')).ok).toBe(true);

    const roster = harness({
      tenants: { sample: { name: 'Sample Ministry', adminEmails: ['admin@sample.org'] } },
    });
    expect((await roster.service.schedule(actor({ isAdmin: false, email: 'Admin@Sample.org' }), fields, 'preview')).ok).toBe(true);
  });

  it('lets a super admin name the ministry, and refuses a missing one', async () => {
    const { service } = harness({});
    const named = await service.listByDateRange(
      actor({ isSuperAdmin: true, tenantId: null }),
      { tenantId: 'sample', from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
    );
    expect(named.ok).toBe(true);
    const missing = await service.schedule(actor({ isSuperAdmin: true, tenantId: null }), { ...scheduleInput, tenantId: null }, 'preview');
    expect(missing).toMatchObject({ ok: false, error: 'tenant_required' });
    const crossed = await service.schedule(actor({ tenantId: null, isAdmin: true }), scheduleInput, 'preview');
    expect(crossed).toMatchObject({ ok: false, error: 'cross_tenant' });
  });

  it('refuses a post that belongs to another ministry even when the actor names their own', async () => {
    const { service, saves } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'other', status: 'draft' })],
      tenants: {
        sample: { name: 'Sample Ministry' },
        other: { name: 'Other Ministry' },
      },
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const result = await service.publishNow(writer, scheduleInput, 'confirm');
    expect(result).toMatchObject({ ok: false, error: 'cross_tenant' });
    expect(saves).toEqual([]);
  });

  it('refuses a super admin when the post belongs to a ministry other than the one they named', async () => {
    // loadOwned compares the post's ministry with the ministry the request
    // named. A super admin skips the actor-ministry check, so deleting that
    // post comparison lets this preview succeed and the post can be rewritten
    // under the named ministry.
    const { service, saves, inserts } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'other', status: 'draft' })],
      tenants: {
        sample: { name: 'Sample Ministry' },
        other: { name: 'Other Ministry' },
      },
    });
    const result = await service.publishNow(
      actor({ isSuperAdmin: true, tenantId: null }),
      scheduleInput,
      'preview',
    );
    expect(result).toMatchObject({ ok: false, error: 'cross_tenant' });
    expect(saves).toEqual([]);
    expect(inserts).toEqual([]);
  });
});

describe('preview then confirm', () => {
  const existing = samplePost({
    id: 'reflection',
    tenantId: 'sample',
    status: 'draft',
  });

  it('schedule describes the post, the time, the ministry and the visibility, then writes only on confirm', async () => {
    const { service, inserts, saves } = harness({
      posts: [existing],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const preview = await service.schedule(writer, scheduleInput, 'preview');
    expect(inserts).toEqual([]);
    expect(saves).toEqual([]);
    const described = effectOf(preview);
    expect(described).toMatchObject({
      action: 'schedule',
      post: { id: 'reflection', title: 'Sunday reflection', status: 'scheduled' },
      church: { id: 'sample', name: 'Sample Ministry' },
      time: { publishedAt: SCHEDULED_AT, timeZone: ZONE },
      visibility: 'hidden_until',
      becomesPublicAt: SCHEDULED_AT,
    });
    expect(described.time.localLabel).toContain('2026');

    const confirmed = await service.schedule(writer, scheduleInput, 'confirm', tokenFrom(preview));
    expect(effectOf(confirmed)).toEqual(described);
    expect(saves).toHaveLength(1);
    expect(saves[0].status).toBe('scheduled');
    expect(saves[0].publishedAt).toBe(SCHEDULED_AT);
    expect(saves[0].scheduleTimeZone).toBe(ZONE);
    expect(isBlogPostPublic(saves[0], Date.parse(NOW))).toBe(false);
    expect(isBlogPostPublic(saves[0], Date.parse(SCHEDULED_AT))).toBe(true);
    expect(saves[0].status).toBe('scheduled');
  });

  it('does not mint an id while previewing a new post', async () => {
    const { service, inserts } = harness({ permissions: { 'admin-1': { writeArticles: true } } });
    const preview = await service.schedule(writer, { ...scheduleInput, postId: null }, 'preview');
    expect(effectOf(preview).post.id).toBe('');
    expect(inserts).toEqual([]);
    const confirmed = await service.schedule(writer, { ...scheduleInput, postId: null }, 'confirm', tokenFrom(preview));
    expect(effectOf(confirmed).post.id).toBe('post-new');
    expect(inserts.map((post) => post.id)).toEqual(['post-new']);
  });

  it('publish now is public immediately and keeps an already-past instant', async () => {
    const { service, saves } = harness({
      posts: [samplePost({
        id: 'welcome',
        tenantId: 'sample',
        status: 'published',
        publishedAt: '2026-01-04T18:00:00.000Z',
      })],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const input = { ...scheduleInput, postId: 'welcome', title: 'Welcome' };
    const preview = await service.publishNow(writer, input, 'preview');
    expect(saves).toEqual([]);
    expect(effectOf(preview)).toMatchObject({
      action: 'publishNow',
      visibility: 'public',
      church: { name: 'Sample Ministry' },
      time: { publishedAt: '2026-01-04T18:00:00.000Z' },
    });
    const confirmed = await service.publishNow(writer, input, 'confirm', tokenFrom(preview));
    expect(effectOf(confirmed)).toEqual(effectOf(preview));
    expect(saves[0].publishedAt).toBe('2026-01-04T18:00:00.000Z');
    expect(isBlogPostPublic(saves[0], Date.parse(NOW))).toBe(true);
  });

  it('unschedule returns the post to a draft and hides it only after confirm', async () => {
    const { service, saves } = harness({
      posts: [samplePost({
        id: 'reflection',
        tenantId: 'sample',
        status: 'scheduled',
        publishedAt: SCHEDULED_AT,
        scheduleTimeZone: ZONE,
      })],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const preview = await service.unschedule(writer, { tenantId: 'sample', postId: 'reflection' }, 'preview');
    expect(saves).toEqual([]);
    expect(effectOf(preview)).toMatchObject({
      action: 'unschedule',
      post: { id: 'reflection', status: 'draft' },
      church: { id: 'sample', name: 'Sample Ministry' },
      visibility: 'draft',
      becomesPublicAt: null,
      time: { publishedAt: null },
    });
    const confirmed = await service.unschedule(writer, { tenantId: 'sample', postId: 'reflection' }, 'confirm', tokenFrom(preview));
    expect(effectOf(confirmed)).toEqual(effectOf(preview));
    expect(saves[0].status).toBe('draft');
    expect(saves[0].publishedAt).toBeNull();
    expect(isBlogPostPublic(saves[0], Date.parse('2026-08-01T00:00:00.000Z'))).toBe(false);
  });

  it('delete names the removal and removes the post only on confirm', async () => {
    const { service, removes } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'sample', status: 'scheduled', publishedAt: SCHEDULED_AT, scheduleTimeZone: ZONE })],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const preview = await service.deletePost(writer, { tenantId: 'sample', postId: 'reflection' }, 'preview');
    expect(removes).toEqual([]);
    expect(effectOf(preview)).toMatchObject({
      action: 'delete',
      post: { id: 'reflection', title: 'Sunday reflection', status: 'removed' },
      church: { id: 'sample', name: 'Sample Ministry' },
      visibility: 'removed',
      time: { publishedAt: SCHEDULED_AT, timeZone: ZONE },
    });
    const confirmed = await service.deletePost(writer, { tenantId: 'sample', postId: 'reflection' }, 'confirm', tokenFrom(preview));
    expect(effectOf(confirmed)).toEqual(effectOf(preview));
    expect(removes).toEqual(['reflection']);
  });

  it('rejects a missing, past, or impossible schedule time before any write', async () => {
    const { service, saves, inserts } = harness({ permissions: { 'admin-1': { writeArticles: true } } });
    expect(await service.schedule(writer, { ...scheduleInput, postId: null, wallClock: '' }, 'confirm')).toMatchObject({ ok: false, error: 'time_required' });
    expect(await service.schedule(writer, { ...scheduleInput, postId: null, wallClock: '2026-06-01T07:00' }, 'confirm')).toMatchObject({ ok: false, error: 'time_not_future' });
    expect(await service.schedule(writer, { ...scheduleInput, postId: null, timeZone: 'Not/AZone' }, 'confirm')).toMatchObject({ ok: false, error: 'invalid' });
    expect(await service.schedule(writer, { ...scheduleInput, postId: null, wallClock: '2026-03-08T02:30' }, 'confirm')).toMatchObject({ ok: false, error: 'invalid' });
    expect(saves).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it('refuses a past schedule on preview, before any token exists', async () => {
    // The refusal is the comparison against now. Removing it lets the preview
    // succeed and issue a token for a time that has already passed.
    const { service, inserts, ledger } = harness({ permissions: { 'admin-1': { writeArticles: true } } });
    const past = { ...scheduleInput, postId: null, wallClock: '2026-06-01T07:00' };
    const preview = await service.schedule(writer, past, 'preview');
    expect(preview).toMatchObject({ ok: false, error: 'time_not_future' });
    expect(inserts).toEqual([]);
    expect(ledger.records.size).toBe(0);
  });
});

describe('confirm token', () => {
  const existing = samplePost({ id: 'reflection', tenantId: 'sample', status: 'draft' });

  function box(over: Parameters<typeof harness>[0] = {}) {
    return harness({
      posts: [existing],
      permissions: { 'admin-1': { writeArticles: true }, 'admin-2': { writeArticles: true } },
      tenants: { sample: { name: 'Sample Ministry' }, other: { name: 'Other Ministry' } },
      ...over,
    });
  }

  it('refuses confirm with no token and writes nothing', async () => {
    const { service, saves } = box();
    const result = await service.schedule(writer, scheduleInput, 'confirm');
    expect(result).toMatchObject({ ok: false, error: 'confirm_required' });
    expect(saves).toEqual([]);
  });

  it('refuses a payload that changed after the preview', async () => {
    const { service, saves } = box();
    const preview = await service.schedule(writer, scheduleInput, 'preview');
    const changed = await service.schedule(
      writer,
      { ...scheduleInput, title: 'A different title' },
      'confirm',
      tokenFrom(preview),
    );
    expect(changed).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(saves).toEqual([]);
  });

  it('refuses a token that was already used', async () => {
    const { service, saves } = box();
    const preview = await service.schedule(writer, scheduleInput, 'preview');
    const token = tokenFrom(preview);
    expect((await service.schedule(writer, scheduleInput, 'confirm', token)).ok).toBe(true);
    const again = await service.schedule(writer, scheduleInput, 'confirm', token);
    expect(again).toMatchObject({ ok: false, error: 'confirm_reused' });
    expect(saves).toHaveLength(1);
  });

  it('refuses a token after ten minutes', async () => {
    expect(CONFIRM_TOKEN_TTL_MS).toBe(10 * 60 * 1000);
    let clock = Date.parse(NOW);
    const { service, saves } = box({ clock: () => new Date(clock) });
    const preview = await service.schedule(writer, scheduleInput, 'preview');
    clock += CONFIRM_TOKEN_TTL_MS + 1;
    const expired = await service.schedule(writer, scheduleInput, 'confirm', tokenFrom(preview));
    expect(expired).toMatchObject({ ok: false, error: 'confirm_expired' });
    expect(saves).toEqual([]);
  });

  it.each([
    ['action', { action: 'delete' }],
    ['tenant', { tenantId: 'other' }],
    ['post', { postId: 'other-post' }],
  ] as const)('refuses a token when only the %s differs', async (_field, patch) => {
    const { service, ledger, saves } = box();
    const preview = await service.schedule(writer, scheduleInput, 'preview');
    const token = tokenFrom(preview);
    const stored = ledger.records.get(token);
    if (!stored) throw new Error('preview did not store a token');
    ledger.records.set(token, { ...stored, ...patch });
    const result = await service.schedule(writer, scheduleInput, 'confirm', token);
    expect(result).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(saves).toEqual([]);
    expect(decideConsume(
      { ...stored, ...patch },
      {
        action: 'schedule',
        tenantId: 'sample',
        uid: writer.uid,
        postId: 'reflection',
        draftHash: stored.draftHash,
      },
      Date.parse(NOW),
    )).toBe('mismatch');
  });

  it('stamps expireAt for a TTL policy this repo does not deploy', () => {
    const nowMs = Date.parse(NOW);
    const fields = confirmTokenFields({
      action: 'schedule',
      tenantId: 'sample',
      uid: writer.uid,
      postId: 'reflection',
      draftHash: 'ab'.repeat(32),
    }, nowMs);
    expect(fields.expiresAt).toBe(nowMs + CONFIRM_TOKEN_TTL_MS);
    expect(fields.expireAt.toISOString()).toBe(new Date(nowMs + CONFIRM_TOKEN_TTL_MS).toISOString());
    const raw = readFileSync(path.join(process.cwd(), 'src/lib/blog/firestore-confirm.ts'), 'utf8');
    expect(raw).toContain('not deployed');
    const ledger = stripComments(raw);
    expect(ledger).toContain('confirmTokenFields');
    const fieldsSrc = stripComments(readFileSync(path.join(process.cwd(), 'src/lib/blog/confirm-token.ts'), 'utf8'));
    expect(fieldsSrc).toContain('expireAt:');
  });

  it('refuses a token presented for another ministry, user, or action', async () => {
    const { service, saves, inserts, ledger } = box();
    const preview = await service.schedule(writer, scheduleInput, 'preview');
    const token = tokenFrom(preview);
    const stored = ledger.records.get(token);
    expect(stored).toMatchObject({
      action: 'schedule',
      tenantId: 'sample',
      uid: writer.uid,
      postId: 'reflection',
    });
    expect(stored?.draftHash).toMatch(/^[0-9a-f]{64}$/);

    const otherMinistry = await service.schedule(
      actor({ isSuperAdmin: true, tenantId: null }),
      { ...scheduleInput, postId: null, tenantId: 'other' },
      'confirm',
      token,
    );
    expect(otherMinistry).toMatchObject({ ok: false, error: 'confirm_mismatch' });

    const otherUser = await service.schedule(
      actor({ uid: 'admin-2' }),
      scheduleInput,
      'confirm',
      token,
    );
    expect(otherUser).toMatchObject({ ok: false, error: 'confirm_mismatch' });

    const otherAction = await service.publishNow(writer, scheduleInput, 'confirm', token);
    expect(otherAction).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(saves).toEqual([]);
    expect(inserts).toEqual([]);
  });
});

describe('super admin audit', () => {
  it('records a cross-ministry action and stays quiet for the admin of that ministry', async () => {
    const { service, audits, saves } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'sample', status: 'draft' })],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const outsider = actor({ isSuperAdmin: true, tenantId: null });
    const preview = await service.schedule(outsider, scheduleInput, 'preview');
    expect(audits).toEqual([]);
    const confirmed = await service.schedule(outsider, scheduleInput, 'confirm', tokenFrom(preview));
    expect(confirmed.ok).toBe(true);
    expect(audits).toEqual([{
      actorUid: outsider.uid,
      actorTenantId: null,
      tenantId: 'sample',
      action: 'schedule',
      postId: 'reflection',
      at: NOW,
    }]);

    const home = actor({ isSuperAdmin: true, tenantId: 'sample' });
    const again = await service.publishNow(home, { ...scheduleInput, title: 'Sunday reflection' }, 'preview');
    await service.publishNow(home, { ...scheduleInput, title: 'Sunday reflection' }, 'confirm', tokenFrom(again));
    expect(audits).toHaveLength(1);
    expect(saves.length).toBeGreaterThan(0);

    const local = await service.createDraft(writer, { ...scheduleInput, title: 'Draft note', postId: null });
    expect(local.ok).toBe(true);
    expect(audits).toHaveLength(1);
  });

  it('does not write the post when the audit record fails', async () => {
    const posts = new Map<string, StoredBlogPost>();
    const ledger = memoryConfirmLedger();
    const store: BlogStore = {
      async getTenant() { return { name: 'Sample Ministry', status: 'active', ownerId: null }; },
      async getAdminEmails() { return []; },
      async getPermissions() { return { writeArticles: true }; },
      async getPost(id) { return posts.get(id) ?? null; },
      async insertPost(post) { posts.set(post.id, post); },
      async savePost(post) { posts.set(post.id, post); },
      async removePost(id) { posts.delete(id); },
      async listByTenant() { return { posts: [], skipped: 0 }; },
      async appendAudit() { throw new Error('audit down'); },
    };
    const service = createBlogService({
      store,
      ledger,
      now: () => new Date(NOW),
      newId: () => 'post-new',
    });
    const outsider = actor({ isSuperAdmin: true, tenantId: null });
    await expect(service.createDraft(outsider, { ...scheduleInput, postId: null })).rejects.toThrow('audit down');
    expect(posts.size).toBe(0);
  });
});

describe('createDraft keeps a live post up', () => {
  const permissions = { 'admin-1': { writeArticles: true } };

  it('saves a published post without taking it off the ministry page', async () => {
    const { service, saves, ledger } = harness({
      posts: [samplePost({
        id: 'reflection',
        tenantId: 'sample',
        status: 'published',
        publishedAt: '2026-01-04T18:00:00.000Z',
        scheduleTimeZone: ZONE,
      })],
      permissions,
    });
    const saved = await service.createDraft(writer, {
      ...scheduleInput,
      title: 'Revised reflection',
      content: '<p>A revised paragraph.</p>',
    });
    expect(saved.ok).toBe(true);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      status: 'published',
      title: 'Revised reflection',
      publishedAt: '2026-01-04T18:00:00.000Z',
      scheduleTimeZone: ZONE,
    });
    expect(isBlogPostPublic(saves[0], Date.parse(NOW))).toBe(true);
    expect(ledger.records.size).toBe(0);
  });

  it('saves a scheduled post without clearing its instant', async () => {
    const { service, saves } = harness({
      posts: [samplePost({
        id: 'reflection',
        tenantId: 'sample',
        status: 'scheduled',
        publishedAt: SCHEDULED_AT,
        scheduleTimeZone: ZONE,
      })],
      permissions,
    });
    const saved = await service.createDraft(writer, { ...scheduleInput, title: 'Still scheduled' });
    expect(saved.ok).toBe(true);
    expect(saves[0]).toMatchObject({
      status: 'scheduled',
      title: 'Still scheduled',
      publishedAt: SCHEDULED_AT,
      scheduleTimeZone: ZONE,
    });
    expect(isBlogPostPublic(saves[0], Date.parse(NOW))).toBe(false);
  });

  it('returns a live post to a draft only through unschedule confirm', async () => {
    const { service, saves } = harness({
      posts: [samplePost({
        id: 'reflection',
        tenantId: 'sample',
        status: 'published',
        publishedAt: '2026-01-04T18:00:00.000Z',
      })],
      permissions,
    });
    await service.createDraft(writer, { ...scheduleInput, title: 'Still public' });
    expect(saves[0].status).toBe('published');
    const refused = await service.unschedule(writer, { tenantId: 'sample', postId: 'reflection' }, 'confirm');
    expect(refused).toMatchObject({ ok: false, error: 'confirm_required' });
    expect(saves).toHaveLength(1);
    const preview = await service.unschedule(writer, { tenantId: 'sample', postId: 'reflection' }, 'preview');
    const confirmed = await service.unschedule(writer, { tenantId: 'sample', postId: 'reflection' }, 'confirm', tokenFrom(preview));
    expect(confirmed.ok).toBe(true);
    expect(saves[1].status).toBe('draft');
    expect(saves[1].publishedAt).toBeNull();
    expect(isBlogPostPublic(saves[1], Date.parse(NOW))).toBe(false);
  });

  it('keeps the editor contents when a live post is taken down', async () => {
    const { service, saves } = harness({
      posts: [samplePost({
        id: 'reflection',
        tenantId: 'sample',
        status: 'published',
        publishedAt: '2026-01-04T18:00:00.000Z',
      })],
      permissions,
    });
    const input = { ...scheduleInput, title: 'Rewritten before takedown', content: '<p>New body</p>' };
    const preview = await service.unschedule(writer, input, 'preview');
    expect(effectOf(preview).post.title).toBe('Rewritten before takedown');
    const mismatched = await service.unschedule(writer, { ...input, title: 'A different title' }, 'confirm', tokenFrom(preview));
    expect(mismatched).toMatchObject({ ok: false, error: 'confirm_mismatch' });
    expect(saves).toEqual([]);
    const confirmed = await service.unschedule(writer, input, 'confirm', tokenFrom(preview));
    expect(confirmed.ok).toBe(true);
    expect(saves[0]).toMatchObject({
      status: 'draft',
      title: 'Rewritten before takedown',
      content: '<p>New body</p>',
      publishedAt: null,
    });
  });

  it('saves and takes down a post that has no category', async () => {
    const { service, saves } = harness({
      posts: [samplePost({
        id: 'reflection',
        tenantId: 'sample',
        status: 'published',
        category: '',
        publishedAt: '2026-01-04T18:00:00.000Z',
      })],
      permissions,
    });
    const input = { ...scheduleInput, category: '' };
    const saved = await service.createDraft(writer, input);
    expect(saved.ok).toBe(true);
    expect(saves[0]).toMatchObject({ status: 'published', category: '' });
    const preview = await service.unschedule(writer, input, 'preview');
    expect(preview.ok).toBe(true);
    const confirmed = await service.unschedule(writer, input, 'confirm', tokenFrom(preview));
    expect(confirmed.ok).toBe(true);
    expect(saves[1]).toMatchObject({ status: 'draft', category: '', publishedAt: null });
  });
});

describe('archived ministries', () => {
  it('can save a draft and cannot schedule or publish', async () => {
    const { service, inserts } = harness({
      tenants: { sample: { name: 'Sample Ministry', status: TENANT_STATUS_ARCHIVED } },
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const scheduled = await service.schedule(writer, { ...scheduleInput, postId: null }, 'confirm');
    expect(scheduled).toMatchObject({ ok: false, error: 'publishing_closed', message: ARCHIVED_ACTION_MESSAGE });
    const published = await service.publishNow(writer, { ...scheduleInput, postId: null }, 'preview');
    expect(published).toMatchObject({ ok: false, error: 'publishing_closed' });
    const draft = await service.createDraft(writer, { ...scheduleInput, postId: null });
    expect(draft.ok).toBe(true);
    expect(inserts[0]?.status).toBe('draft');
    expect(inserts[0]?.publishedAt).toBeNull();
  });
});

describe('date range and public visibility', () => {
  const posts = [
    samplePost({ id: 'draft', tenantId: 'sample', status: 'draft' }),
    samplePost({ id: 'future', tenantId: 'sample', status: 'scheduled', publishedAt: SCHEDULED_AT, scheduleTimeZone: ZONE, title: 'Sunday reflection' }),
    samplePost({ id: 'live', tenantId: 'sample', status: 'published', publishedAt: '2026-07-04T16:00:00.000Z', title: 'Welcome' }),
    samplePost({ id: 'early', tenantId: 'sample', status: 'published', publishedAt: '2026-01-04T18:00:00.000Z', title: 'Old note' }),
    samplePost({ id: 'undated', tenantId: 'sample', status: 'published', publishedAt: null, title: 'Undated' }),
    samplePost({ id: 'other', tenantId: 'other', status: 'published', publishedAt: '2026-07-04T16:00:00.000Z', title: 'Elsewhere' }),
    samplePost({ id: 'due', tenantId: 'sample', status: 'scheduled', publishedAt: '2026-05-01T16:00:00.000Z', title: 'Already due' }),
  ];

  it('lists scheduled and published posts in range and counts what it cannot date', async () => {
    const { service } = harness({
      posts,
      tenants: { sample: { name: 'Sample Ministry' }, other: { name: 'Other Ministry' } },
      permissions: { 'admin-1': { writeArticles: true } },
      skipped: 2,
    });
    const listed = await service.listByDateRange(writer, {
      tenantId: 'sample',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-07-20T16:00:00.000Z',
    });
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.posts.map((post) => post.id)).toEqual(['due', 'live', 'future']);
    expect(listed.posts.map((post) => post.visibility)).toEqual(['public', 'hidden_until', 'hidden_until']);
    expect(listed.posts.every((post) => post.kind === 'blog' && post.churchName === 'Sample Ministry')).toBe(true);
    expect(listed.undatedPublished).toBe(1);
    expect(listed.skipped).toBe(2);
    expect(listed.posts.some((post) => post.id === 'draft' || post.id === 'other' || post.id === 'early')).toBe(false);
  });

  it('keeps a future post off the ministry page and its feeds until the instant, without flipping status', async () => {
    const box = harness({
      posts,
      tenants: { sample: { name: 'Sample Ministry' }, other: { name: 'Other Ministry' } },
    });
    const before = await box.service.listPublic('sample', Date.parse(NOW));
    if (!before.ok) throw new Error(before.error);
    expect(before.posts.map((post) => post.id)).toEqual(['due', 'early', 'undated']);
    const origin = 'https://sample.theharvest.app';
    const rssBefore = renderBlogRss({ churchName: 'Sample Ministry', origin, posts: before.posts });
    const mapBefore = renderBlogSitemap({ origin, posts: before.posts });
    expect(rssBefore).not.toContain('/blog/future');
    expect(rssBefore).not.toContain('/blog/draft');
    expect(rssBefore).not.toContain('/blog/other');
    expect(mapBefore).not.toContain('/blog/future');
    expect(mapBefore).toContain(`${origin}/p`);

    const after = await box.service.listPublic('sample', Date.parse('2026-07-21T00:00:00.000Z'));
    if (!after.ok) throw new Error(after.error);
    expect(after.posts.map((post) => post.id)).toEqual(['future', 'live', 'due', 'early', 'undated']);
    const stored = posts.find((post) => post.id === 'future');
    expect(stored?.status).toBe('scheduled');
    const rssAfter = renderBlogRss({ churchName: 'Sample Ministry', origin, posts: after.posts });
    expect(rssAfter).toContain('/blog/future');
    expect(rssAfter).toContain('Sample Ministry');
    expect(renderBlogSitemap({ origin, posts: after.posts })).toContain('/blog/future');
    expect(await box.service.readPublic('future', Date.parse(NOW))).toBeNull();
    expect((await box.service.readPublic('future', Date.parse(SCHEDULED_AT)))?.status).toBe('scheduled');
  });

  it('fails when the ministry cannot be read instead of publishing an empty page', async () => {
    const { service } = harness({ tenants: {} });
    expect(await service.listPublic('sample')).toMatchObject({ ok: false, error: 'not_found' });
    expect(await service.listPublic('')).toMatchObject({ ok: false, error: 'tenant_required' });
  });
});

describe('thin wrappers', () => {
  const root = process.cwd();
  const source = (rel: string) => stripComments(readFileSync(path.join(root, rel), 'utf8'));

  it('the editor and the delete path call the service and do not write the collection', () => {
    const editor = source('src/components/AdminBlogPostEditor.tsx');
    const list = source('src/components/AdminBlog.tsx');
    const route = source('src/app/api/blog/actions/route.ts');
    expect(editor).toContain('/api/blog/actions');
    expect(editor).toContain("'unschedule'");
    expect(editor).toContain("takingDown && saveStatus === 'draft'");
    expect(list).toContain('/api/blog/actions');
    expect(route).toContain('dispatchBlogAction');
    for (const file of [editor, list]) {
      expect(file).not.toContain(['add', 'Doc'].join(''));
      expect(file).not.toContain(['update', 'Doc'].join(''));
      expect(file).not.toContain(['set', 'Doc'].join(''));
      expect(file).not.toContain(['delete', 'Doc'].join(''));
    }
    expect(route).not.toContain('wallClockToUtcIso');
    expect(route).not.toContain('tenantAllows');
    const ledger = source('src/lib/blog/firestore-confirm.ts');
    expect(ledger).toContain(['run', 'Transaction'].join(''));
    expect(ledger).toContain('decideConsume');
    expect(ledger).toContain('blog_confirm_tokens');
  });

  it('an omitted mode previews and does not write', async () => {
    const { service, saves } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'sample', status: 'draft' })],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const result = await dispatchBlogAction(service, writer, { ...scheduleInput, action: 'schedule' });
    expect(result.status).toBe(200);
    expect(saves).toEqual([]);
    expect(result.body).toMatchObject({ ok: true, preview: { visibility: 'hidden_until' }, requiresConfirm: true });
    expect(typeof (result.body as { confirmToken?: string }).confirmToken).toBe('string');
    const refused = await dispatchBlogAction(service, writer, { ...scheduleInput, action: 'schedule', mode: 'confirm' });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ ok: false, error: 'confirm_required' });
    expect(saves).toEqual([]);
  });

  it('maps failures to HTTP statuses', async () => {
    const { service } = harness({ permissions: { 'admin-1': { writeArticles: true } } });
    expect((await dispatchBlogAction(service, writer, { action: 'nope' })).status).toBe(400);
    expect((await dispatchBlogAction(service, writer, { action: 'delete', mode: 'confirm', tenantId: 'sample', postId: 'missing' })).status).toBe(404);
    const archived = harness({
      tenants: { sample: { name: 'Sample Ministry', status: TENANT_STATUS_ARCHIVED } },
      permissions: { 'admin-1': { writeArticles: true } },
    });
    expect((await dispatchBlogAction(archived.service, writer, { ...scheduleInput, action: 'publishNow', mode: 'confirm' })).status).toBe(403);
  });
});
