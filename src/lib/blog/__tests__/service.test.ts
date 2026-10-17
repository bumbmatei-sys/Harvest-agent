import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';
import {
  createBlogService,
  dispatchBlogAction,
  type BlogActor,
  type BlogDraftInput,
  type BlogEffect,
  type BlogFailure,
  type BlogService,
  type BlogStore,
  type StoredBlogPost,
} from '@/lib/blog/service';
import { renderBlogRss, renderBlogSitemap } from '@/lib/blog/feeds';
import { isBlogPostPublic, wallClockToUtcIso } from '@/lib/blog/visibility';
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
}): Harness {
  const posts = new Map((opts.posts ?? []).map((post) => [post.id, post]));
  const inserts: StoredBlogPost[] = [];
  const saves: StoredBlogPost[] = [];
  const removes: string[] = [];
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
  };
  return {
    service: createBlogService({
      store,
      now: () => new Date(opts.now ?? NOW),
      newId: () => 'post-new',
    }),
    inserts,
    saves,
    removes,
  };
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

    const confirmed = await service.schedule(writer, scheduleInput, 'confirm');
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
    const confirmed = await service.schedule(writer, { ...scheduleInput, postId: null }, 'confirm');
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
    const confirmed = await service.publishNow(writer, input, 'confirm');
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
    const confirmed = await service.unschedule(writer, { tenantId: 'sample', postId: 'reflection' }, 'confirm');
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
    const confirmed = await service.deletePost(writer, { tenantId: 'sample', postId: 'reflection' }, 'confirm');
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
  });

  it('an omitted mode previews and does not write', async () => {
    const { service, saves } = harness({
      posts: [samplePost({ id: 'reflection', tenantId: 'sample', status: 'draft' })],
      permissions: { 'admin-1': { writeArticles: true } },
    });
    const result = await dispatchBlogAction(service, writer, { ...scheduleInput, action: 'schedule' });
    expect(result.status).toBe(200);
    expect(saves).toEqual([]);
    expect(result.body).toMatchObject({ ok: true, preview: { visibility: 'hidden_until' } });
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
