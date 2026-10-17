import 'server-only';

import { tenantAllows, ARCHIVED_ACTION_MESSAGE } from '@/lib/tenant-lifecycle';
import {
  formatInstantInZone,
  isBlogPostPublic,
  isValidTimeZone,
  wallClockToUtcIso,
  type BlogStoredStatus,
} from '@/lib/blog/visibility';

/**
 * Church blog scheduling.
 *
 * One module owns every read and write an admin — or a later assistant acting
 * as that admin — can do with a blog post. Routes and the editor pass a
 * verified actor and do not decide who may publish, when a post is public, or
 * what a schedule instant means.
 *
 * publishNow, schedule, unschedule and delete each take `preview` or `confirm`.
 * Preview writes nothing and describes the post, the time, the church and the
 * visibility that confirm will produce. Confirm performs that write.
 */

export interface BlogActor {
  readonly uid: string;
  readonly email: string | null;
  readonly tenantId: string | null;
  readonly isAdmin: boolean;
  readonly isSuperAdmin: boolean;
}

export type BlogMode = 'preview' | 'confirm';

export interface BlogPostFields {
  readonly title: string;
  readonly category: string;
  readonly content: string;
  readonly featuredImage: string | null;
  readonly tags: readonly string[];
}

export interface StoredBlogPost extends BlogPostFields {
  readonly id: string;
  readonly tenantId: string;
  readonly status: BlogStoredStatus;
  readonly publishedAt: string | null;
  readonly scheduleTimeZone: string | null;
  readonly authorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly keywords: readonly string[];
}

export interface BlogStore {
  getTenant(tenantId: string): Promise<{ name: string; status: unknown; ownerId: string | null } | null>;
  getAdminEmails(tenantId: string): Promise<readonly string[]>;
  getPermissions(uid: string): Promise<Readonly<Record<string, boolean>>>;
  getPost(id: string): Promise<StoredBlogPost | null>;
  insertPost(post: StoredBlogPost): Promise<void>;
  savePost(post: StoredBlogPost): Promise<void>;
  removePost(id: string): Promise<void>;
  listByTenant(tenantId: string): Promise<{ posts: readonly StoredBlogPost[]; skipped: number }>;
}

export type BlogErrorCode =
  | 'not_authorized'
  | 'cross_tenant'
  | 'not_found'
  | 'invalid'
  | 'archived'
  | 'time_required'
  | 'time_not_future'
  | 'tenant_required';

export interface BlogFailure {
  readonly ok: false;
  readonly error: BlogErrorCode;
  readonly message: string;
}

export type BlogVisibilityOutcome = 'public' | 'hidden_until' | 'draft' | 'removed';

export interface BlogEffect {
  readonly action: 'schedule' | 'publishNow' | 'unschedule' | 'delete';
  readonly post: { readonly id: string; readonly title: string; readonly status: BlogStoredStatus | 'removed' };
  readonly church: { readonly id: string; readonly name: string };
  readonly time: {
    readonly publishedAt: string | null;
    readonly timeZone: string;
    readonly localLabel: string;
  };
  readonly visibility: BlogVisibilityOutcome;
  readonly becomesPublicAt: string | null;
}

export interface BlogCalendarItem {
  readonly id: string;
  readonly kind: 'blog';
  readonly title: string;
  readonly status: 'scheduled' | 'published';
  readonly publishedAt: string;
  readonly timeZone: string;
  readonly visibility: 'public' | 'hidden_until';
  readonly churchId: string;
  readonly churchName: string;
}

export interface BlogDraftInput {
  readonly tenantId?: string | null;
  readonly postId?: string | null;
  readonly title?: string;
  readonly category?: string;
  readonly content?: string;
  readonly featuredImage?: string | null;
  readonly tags?: readonly string[];
  readonly timeZone?: string;
  readonly wallClock?: string;
}

export interface BlogService {
  createDraft(actor: BlogActor, input: BlogDraftInput): Promise<{ ok: true; post: StoredBlogPost } | BlogFailure>;
  validate(actor: BlogActor, input: BlogDraftInput & { intent?: 'draft' | 'schedule' | 'publish' }): Promise<
    { ok: true; valid: true } | BlogFailure
  >;
  schedule(actor: BlogActor, input: BlogDraftInput, mode: BlogMode): Promise<
    { ok: true; preview: BlogEffect; post?: StoredBlogPost } | BlogFailure
  >;
  publishNow(actor: BlogActor, input: BlogDraftInput, mode: BlogMode): Promise<
    { ok: true; preview: BlogEffect; post?: StoredBlogPost } | BlogFailure
  >;
  unschedule(actor: BlogActor, input: BlogDraftInput, mode: BlogMode): Promise<
    { ok: true; preview: BlogEffect; post?: StoredBlogPost } | BlogFailure
  >;
  deletePost(actor: BlogActor, input: BlogDraftInput, mode: BlogMode): Promise<
    { ok: true; preview: BlogEffect } | BlogFailure
  >;
  listByDateRange(actor: BlogActor, input: { tenantId?: string | null; from?: string; to?: string }): Promise<
    | {
        ok: true;
        tenantId: string;
        churchName: string;
        from: string;
        to: string;
        posts: readonly BlogCalendarItem[];
        undatedPublished: number;
        skipped: number;
      }
    | BlogFailure
  >;
  listPublic(tenantId: string, nowMs?: number): Promise<
    { ok: true; posts: readonly StoredBlogPost[]; skipped: number } | BlogFailure
  >;
  readPublic(id: string, nowMs?: number): Promise<StoredBlogPost | null>;
}

const fail = (error: BlogErrorCode, message: string): BlogFailure => ({ ok: false, error, message });

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  return tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map((tag) => tag.trim());
}

function plainContent(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function fieldsFrom(input: BlogDraftInput, existing: StoredBlogPost | null): BlogPostFields | BlogFailure {
  const title = input.title !== undefined ? cleanText(input.title) : existing?.title ?? '';
  const category = input.category !== undefined ? cleanText(input.category) : existing?.category ?? '';
  const content = input.content !== undefined ? (typeof input.content === 'string' ? input.content : '') : existing?.content ?? '';
  const missing: string[] = [];
  if (!title) missing.push('Title');
  if (!category) missing.push('Category');
  if (!plainContent(content)) missing.push('Content');
  if (missing.length > 0) return fail('invalid', `Missing required fields: ${missing.join(', ')}`);
  let featuredImage: string | null;
  if (input.featuredImage === undefined) featuredImage = existing?.featuredImage ?? null;
  else if (input.featuredImage == null || cleanText(input.featuredImage) === '') featuredImage = null;
  else featuredImage = cleanText(input.featuredImage);
  const tags = input.tags !== undefined ? cleanTags(input.tags) : [...(existing?.tags ?? [])];
  return { title, category, content, featuredImage, tags };
}

function isFields(value: BlogPostFields | BlogFailure): value is BlogPostFields {
  return !('ok' in value);
}

export function createBlogService(deps: {
  store: BlogStore;
  now?: () => Date;
  newId?: () => string;
}): BlogService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const store = deps.store;

  async function resolveTenant(actor: BlogActor, requested: string | null | undefined): Promise<
    { ok: true; tenantId: string } | BlogFailure
  > {
    const tenantId = cleanText(requested) || actor.tenantId || '';
    if (!tenantId) return fail('tenant_required', 'A ministry is required.');
    if (!actor.uid) return fail('not_authorized', 'Sign in is required.');
    if (actor.isSuperAdmin) return { ok: true, tenantId };
    if (actor.tenantId && actor.tenantId !== tenantId) {
      return fail('cross_tenant', 'That post belongs to another ministry.');
    }
    if (actor.tenantId !== tenantId) return fail('cross_tenant', 'That post belongs to another ministry.');
    return { ok: true, tenantId };
  }

  async function assertWrite(actor: BlogActor, tenantId: string): Promise<true | BlogFailure> {
    if (actor.isSuperAdmin) return true;
    const tenant = await store.getTenant(tenantId);
    if (!tenant) return fail('not_authorized', 'This ministry could not be read.');
    if (tenant.ownerId && tenant.ownerId === actor.uid) return true;
    const email = (actor.email || '').toLowerCase();
    if (email) {
      const roster = await store.getAdminEmails(tenantId);
      if (roster.some((entry) => entry.toLowerCase() === email)) return true;
    }
    if (!actor.isAdmin) return fail('not_authorized', 'Blog publishing requires the articles permission.');
    const permissions = await store.getPermissions(actor.uid);
    if (permissions.fullAccess === true || permissions.writeArticles === true) return true;
    return fail('not_authorized', 'Blog publishing requires the articles permission.');
  }

  async function gate(actor: BlogActor, requested: string | null | undefined): Promise<
    { ok: true; tenantId: string; churchName: string; status: unknown } | BlogFailure
  > {
    const resolved = await resolveTenant(actor, requested);
    if (!resolved.ok) return resolved;
    const allowed = await assertWrite(actor, resolved.tenantId);
    if (allowed !== true) return allowed;
    const tenant = await store.getTenant(resolved.tenantId);
    if (!tenant) return fail('not_found', 'This ministry could not be read.');
    return { ok: true, tenantId: resolved.tenantId, churchName: tenant.name, status: tenant.status };
  }

  async function loadOwned(actor: BlogActor, tenantId: string, postId: string | null | undefined): Promise<
    { ok: true; post: StoredBlogPost | null } | BlogFailure
  > {
    if (!postId) return { ok: true, post: null };
    const post = await store.getPost(postId);
    if (!post) return fail('not_found', 'That post does not exist.');
    if (post.tenantId !== tenantId) return fail('cross_tenant', 'That post belongs to another ministry.');
    if (!actor.isSuperAdmin && actor.tenantId !== post.tenantId) {
      return fail('cross_tenant', 'That post belongs to another ministry.');
    }
    return { ok: true, post };
  }

  function effect(
    action: BlogEffect['action'],
    church: { id: string; name: string },
    post: { id: string; title: string; status: BlogEffect['post']['status'] },
    publishedAt: string | null,
    timeZone: string,
    visibility: BlogVisibilityOutcome,
  ): BlogEffect {
    return {
      action,
      post,
      church,
      time: {
        publishedAt,
        timeZone,
        localLabel: publishedAt ? formatInstantInZone(publishedAt, timeZone) : '',
      },
      visibility,
      becomesPublicAt: visibility === 'public' || visibility === 'hidden_until' ? publishedAt : null,
    };
  }

  async function publishingOpen(tenantId: string): Promise<true | BlogFailure> {
    const tenant = await store.getTenant(tenantId);
    if (!tenant) return fail('not_found', 'This ministry could not be read.');
    if (!tenantAllows(tenant.status, 'publishing')) return fail('archived', ARCHIVED_ACTION_MESSAGE);
    return true;
  }

  function stamp(existing: StoredBlogPost | null, tenantId: string, authorId: string, fields: BlogPostFields, status: BlogStoredStatus, publishedAt: string | null, timeZone: string | null, assignId: boolean): StoredBlogPost {
    const clock = now().toISOString();
    return {
      ...fields,
      id: existing?.id ?? (assignId ? newId() : ''),
      tenantId,
      status,
      publishedAt,
      scheduleTimeZone: timeZone,
      authorId: existing?.authorId || authorId,
      createdAt: existing?.createdAt ?? clock,
      updatedAt: clock,
      seoTitle: existing?.seoTitle ?? null,
      seoDescription: existing?.seoDescription ?? null,
      keywords: existing?.keywords ?? [],
    };
  }

  async function write(existing: StoredBlogPost | null, post: StoredBlogPost): Promise<void> {
    if (!post.id) throw new Error('Blog post id was not assigned.');
    if (existing) await store.savePost(post);
    else await store.insertPost(post);
  }

  return {
    async validate(actor, input) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      const fields = fieldsFrom(input, owned.post);
      if (!isFields(fields)) return fields;
      const intent = input.intent ?? 'draft';
      if (intent === 'schedule') {
        const zone = cleanText(input.timeZone);
        const wall = cleanText(input.wallClock);
        if (!wall) return fail('time_required', 'Choose a date and time.');
        if (!zone || !isValidTimeZone(zone)) return fail('invalid', 'Choose a timezone.');
        const utc = wallClockToUtcIso(wall, zone);
        if (!utc) return fail('invalid', 'That date does not exist in this timezone.');
        if (new Date(utc).getTime() <= now().getTime()) return fail('time_not_future', 'Scheduled date must be in the future.');
      }
      return { ok: true, valid: true };
    },

    async createDraft(actor, input) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      const fields = fieldsFrom(input, owned.post);
      if (!isFields(fields)) return fields;
      const post = stamp(owned.post, gated.tenantId, actor.uid, fields, 'draft', null, owned.post?.scheduleTimeZone ?? null, true);
      await write(owned.post, post);
      return { ok: true, post };
    },

    async schedule(actor, input, mode) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const open = await publishingOpen(gated.tenantId);
      if (open !== true) return open;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      const fields = fieldsFrom(input, owned.post);
      if (!isFields(fields)) return fields;
      const zone = cleanText(input.timeZone);
      const wall = cleanText(input.wallClock);
      if (!wall) return fail('time_required', 'Choose a date and time.');
      if (!zone || !isValidTimeZone(zone)) return fail('invalid', 'Choose a timezone.');
      const utc = wallClockToUtcIso(wall, zone);
      if (!utc) return fail('invalid', 'That date does not exist in this timezone.');
      if (new Date(utc).getTime() <= now().getTime()) return fail('time_not_future', 'Scheduled date must be in the future.');
      const post = stamp(owned.post, gated.tenantId, actor.uid, fields, 'scheduled', utc, zone, mode === 'confirm');
      const preview = effect(
        'schedule',
        { id: gated.tenantId, name: gated.churchName },
        { id: post.id, title: post.title, status: 'scheduled' },
        utc,
        zone,
        'hidden_until',
      );
      if (mode === 'preview') return { ok: true, preview };
      await write(owned.post, post);
      return { ok: true, preview, post };
    },

    async publishNow(actor, input, mode) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const open = await publishingOpen(gated.tenantId);
      if (open !== true) return open;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      const fields = fieldsFrom(input, owned.post);
      if (!isFields(fields)) return fields;
      const zone = cleanText(input.timeZone) || owned.post?.scheduleTimeZone || 'UTC';
      if (!isValidTimeZone(zone)) return fail('invalid', 'Choose a timezone.');
      const keep = owned.post?.status === 'published' && owned.post.publishedAt && new Date(owned.post.publishedAt).getTime() <= now().getTime()
        ? owned.post.publishedAt
        : now().toISOString();
      const post = stamp(owned.post, gated.tenantId, actor.uid, fields, 'published', keep, zone, mode === 'confirm');
      const preview = effect(
        'publishNow',
        { id: gated.tenantId, name: gated.churchName },
        { id: post.id, title: post.title, status: 'published' },
        keep,
        zone,
        'public',
      );
      if (mode === 'preview') return { ok: true, preview };
      await write(owned.post, post);
      return { ok: true, preview, post };
    },

    async unschedule(actor, input, mode) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      if (!owned.post) return fail('not_found', 'That post does not exist.');
      const zone = owned.post.scheduleTimeZone || 'UTC';
      const post = stamp(owned.post, gated.tenantId, actor.uid, {
        title: owned.post.title,
        category: owned.post.category,
        content: owned.post.content,
        featuredImage: owned.post.featuredImage,
        tags: owned.post.tags,
      }, 'draft', null, null, true);
      const preview = effect(
        'unschedule',
        { id: gated.tenantId, name: gated.churchName },
        { id: post.id, title: post.title, status: 'draft' },
        null,
        isValidTimeZone(zone) ? zone : 'UTC',
        'draft',
      );
      if (mode === 'preview') return { ok: true, preview };
      await write(owned.post, post);
      return { ok: true, preview, post };
    },

    async deletePost(actor, input, mode) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      if (!owned.post) return fail('not_found', 'That post does not exist.');
      const zone = owned.post.scheduleTimeZone && isValidTimeZone(owned.post.scheduleTimeZone)
        ? owned.post.scheduleTimeZone
        : 'UTC';
      const preview = effect(
        'delete',
        { id: gated.tenantId, name: gated.churchName },
        { id: owned.post.id, title: owned.post.title, status: 'removed' },
        owned.post.publishedAt,
        zone,
        'removed',
      );
      if (mode === 'preview') return { ok: true, preview };
      await store.removePost(owned.post.id);
      return { ok: true, preview };
    },

    async listByDateRange(actor, input) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const fromMs = Date.parse(input.from || '');
      const toMs = Date.parse(input.to || '');
      if (!input.from || !input.to || Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
        return fail('invalid', 'A start and end instant are required.');
      }
      const listed = await store.listByTenant(gated.tenantId);
      const posts: BlogCalendarItem[] = [];
      let undatedPublished = 0;
      const clock = now().getTime();
      for (const post of listed.posts) {
        if (post.tenantId !== gated.tenantId) continue;
        if (post.status === 'published' && !post.publishedAt) {
          undatedPublished += 1;
          continue;
        }
        if (post.status !== 'scheduled' && post.status !== 'published') continue;
        if (!post.publishedAt) continue;
        const at = Date.parse(post.publishedAt);
        if (Number.isNaN(at) || at < fromMs || at > toMs) continue;
        const zone = post.scheduleTimeZone && isValidTimeZone(post.scheduleTimeZone) ? post.scheduleTimeZone : 'UTC';
        posts.push({
          id: post.id,
          kind: 'blog',
          title: post.title,
          status: post.status,
          publishedAt: post.publishedAt,
          timeZone: zone,
          visibility: isBlogPostPublic(post, clock) ? 'public' : 'hidden_until',
          churchId: gated.tenantId,
          churchName: gated.churchName,
        });
      }
      posts.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
      return {
        ok: true,
        tenantId: gated.tenantId,
        churchName: gated.churchName,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        posts,
        undatedPublished,
        skipped: listed.skipped,
      };
    },

    async listPublic(tenantId, nowMs) {
      const id = cleanText(tenantId);
      if (!id) return fail('tenant_required', 'A ministry is required.');
      const tenant = await store.getTenant(id);
      if (!tenant) return fail('not_found', 'This ministry could not be read.');
      const listed = await store.listByTenant(id);
      const clock = nowMs ?? now().getTime();
      const posts = listed.posts
        .filter((post) => post.tenantId === id && isBlogPostPublic(post, clock))
        .sort((a, b) => Date.parse(b.publishedAt || b.createdAt) - Date.parse(a.publishedAt || a.createdAt));
      return { ok: true, posts, skipped: listed.skipped };
    },

    async readPublic(id, nowMs) {
      const post = await store.getPost(id);
      if (!post) return null;
      const clock = nowMs ?? now().getTime();
      if (!isBlogPostPublic(post, clock)) return null;
      return post;
    },
  };
}

export interface BlogActionBody extends BlogDraftInput {
  readonly action?: string;
  readonly mode?: BlogMode;
  readonly from?: string;
  readonly to?: string;
  readonly intent?: 'draft' | 'schedule' | 'publish';
}

export async function dispatchBlogAction(
  service: BlogService,
  actor: BlogActor,
  body: BlogActionBody,
): Promise<{ status: number; body: unknown }> {
  const mode: BlogMode = body.mode === 'confirm' ? 'confirm' : 'preview';
  switch (body.action) {
    case 'createDraft':
      return http(await service.createDraft(actor, body));
    case 'validate':
      return http(await service.validate(actor, body));
    case 'schedule':
      return http(await service.schedule(actor, body, mode));
    case 'publishNow':
      return http(await service.publishNow(actor, body, mode));
    case 'unschedule':
      return http(await service.unschedule(actor, body, mode));
    case 'delete':
      return http(await service.deletePost(actor, body, mode));
    case 'listByDateRange':
      return http(await service.listByDateRange(actor, body));
    default:
      return { status: 400, body: fail('invalid', 'Unknown blog action.') };
  }
}

function http(result: { ok: true } | BlogFailure | { ok: true; preview: BlogEffect; post?: StoredBlogPost }): { status: number; body: unknown } {
  if (result.ok) return { status: 200, body: result };
  const status = result.error === 'not_found'
    ? 404
    : result.error === 'not_authorized' || result.error === 'cross_tenant' || result.error === 'archived'
      ? 403
      : 400;
  return { status, body: result };
}
