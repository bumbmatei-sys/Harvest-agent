import 'server-only';

import { tenantAllows, ARCHIVED_ACTION_MESSAGE } from '@/lib/tenant-lifecycle';
import {
  hashBlogPayload,
  type BlogConfirmAction,
  type BlogConfirmPayload,
  type ConfirmLedger,
} from '@/lib/blog/confirm-token';
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
 * Preview writes nothing. It describes the post, the time, the church and the
 * visibility, and it returns a single-use token bound to that description.
 * Confirm presents the token. The ledger checks it and spends it before the
 * write. `mode: 'confirm'` on its own does not write.
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
  appendAudit(event: BlogAuditEvent): Promise<void>;
}

/** A super admin acting on a ministry that is not their own. */
export interface BlogAuditEvent {
  readonly actorUid: string;
  readonly actorTenantId: string | null;
  readonly tenantId: string;
  readonly action: string;
  readonly postId: string | null;
  readonly at: string;
}

export type BlogErrorCode =
  | 'not_authorized'
  | 'cross_tenant'
  | 'not_found'
  | 'invalid'
  | 'publishing_closed'
  | 'time_required'
  | 'time_not_future'
  | 'tenant_required'
  | 'confirm_required'
  | 'confirm_expired'
  | 'confirm_reused'
  | 'confirm_mismatch';

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

export type BlogCommitResult =
  | { ok: true; preview: BlogEffect; requiresConfirm: true; confirmToken: string }
  | { ok: true; preview: BlogEffect; post?: StoredBlogPost }
  | BlogFailure;

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
  schedule(actor: BlogActor, input: BlogDraftInput, mode: BlogMode, confirmToken?: string | null): Promise<BlogCommitResult>;
  publishNow(actor: BlogActor, input: BlogDraftInput, mode: BlogMode, confirmToken?: string | null): Promise<BlogCommitResult>;
  unschedule(actor: BlogActor, input: BlogDraftInput, mode: BlogMode, confirmToken?: string | null): Promise<BlogCommitResult>;
  deletePost(actor: BlogActor, input: BlogDraftInput, mode: BlogMode, confirmToken?: string | null): Promise<
    { ok: true; preview: BlogEffect; requiresConfirm?: true; confirmToken?: string } | BlogFailure
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
  ledger?: ConfirmLedger;
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
    // The code is publishing_closed on purpose. tenantAllows is the status
    // check; quoting the archived status word here trips the lifecycle sweep
    // that owns that literal.
    if (!tenantAllows(tenant.status, 'publishing')) return fail('publishing_closed', ARCHIVED_ACTION_MESSAGE);
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

  function ledgerOrThrow(): ConfirmLedger {
    if (!deps.ledger) throw new Error('Blog confirmations have no ledger.');
    return deps.ledger;
  }

  async function noteCrossChurch(actor: BlogActor, tenantId: string, action: string, postId: string | null): Promise<void> {
    if (!actor.isSuperAdmin) return;
    if (actor.tenantId === tenantId) return;
    await store.appendAudit({
      actorUid: actor.uid,
      actorTenantId: actor.tenantId,
      tenantId,
      action,
      postId,
      at: now().toISOString(),
    });
  }

  function bindingFor(
    action: BlogConfirmAction,
    actor: BlogActor,
    tenantId: string,
    postId: string,
    fields: BlogPostFields,
    wallClock: string | null,
    timeZone: string | null,
  ) {
    const payload: BlogConfirmPayload = {
      action,
      tenantId,
      postId,
      title: fields.title,
      category: fields.category,
      content: fields.content,
      featuredImage: fields.featuredImage,
      tags: fields.tags,
      wallClock,
      timeZone,
    };
    return {
      action,
      tenantId,
      uid: actor.uid,
      postId,
      draftHash: hashBlogPayload(payload),
    };
  }

  async function openOrSpend(
    actor: BlogActor,
    mode: BlogMode,
    confirmToken: string | null | undefined,
    binding: ReturnType<typeof bindingFor>,
    preview: BlogEffect,
    persist: () => Promise<StoredBlogPost | void>,
  ): Promise<BlogCommitResult> {
    if (mode !== 'confirm') {
      const issued = await ledgerOrThrow().issue(binding, now().getTime());
      return { ok: true, preview, requiresConfirm: true, confirmToken: issued };
    }
    const presented = cleanText(confirmToken);
    if (!presented) return fail('confirm_required', 'Preview this change and confirm it before it is saved.');
    const decision = await ledgerOrThrow().consume(presented, binding, now().getTime());
    if (decision === 'expired') return fail('confirm_expired', 'That confirmation expired. Preview the change again.');
    if (decision === 'reused') return fail('confirm_reused', 'That confirmation was already used.');
    if (decision !== 'ok') return fail('confirm_mismatch', 'That confirmation does not match this change.');
    const stored = await persist();
    if (stored) return { ok: true, preview: { ...preview, post: { ...preview.post, id: stored.id } }, post: stored };
    return { ok: true, preview };
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
      // A published or scheduled post keeps its status. Saving the body is
      // not a takedown. Returning it to a draft is `unschedule`, which
      // previews and confirms.
      const existing = owned.post;
      const live = existing?.status === 'published' || existing?.status === 'scheduled';
      const status: BlogStoredStatus = live && existing ? existing.status : 'draft';
      const publishedAt = live && existing ? existing.publishedAt : null;
      const zone = live && existing ? existing.scheduleTimeZone : null;
      const post = stamp(existing, gated.tenantId, actor.uid, fields, status, publishedAt, zone, true);
      await noteCrossChurch(actor, gated.tenantId, 'createDraft', post.id);
      await write(existing, post);
      return { ok: true, post };
    },

    async schedule(actor, input, mode, confirmToken) {
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
      const described = stamp(owned.post, gated.tenantId, actor.uid, fields, 'scheduled', utc, zone, false);
      const preview = effect(
        'schedule',
        { id: gated.tenantId, name: gated.churchName },
        { id: described.id, title: described.title, status: 'scheduled' },
        utc,
        zone,
        'hidden_until',
      );
      const postId = cleanText(input.postId);
      return openOrSpend(actor, mode, confirmToken, bindingFor('schedule', actor, gated.tenantId, postId, fields, wall, zone), preview, async () => {
        const post = stamp(owned.post, gated.tenantId, actor.uid, fields, 'scheduled', utc, zone, true);
        await noteCrossChurch(actor, gated.tenantId, 'schedule', post.id);
        await write(owned.post, post);
        return post;
      });
    },

    async publishNow(actor, input, mode, confirmToken) {
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
      const described = stamp(owned.post, gated.tenantId, actor.uid, fields, 'published', keep, zone, false);
      const preview = effect(
        'publishNow',
        { id: gated.tenantId, name: gated.churchName },
        { id: described.id, title: described.title, status: 'published' },
        keep,
        zone,
        'public',
      );
      return openOrSpend(actor, mode, confirmToken, bindingFor('publishNow', actor, gated.tenantId, cleanText(input.postId), fields, null, zone), preview, async () => {
        const post = stamp(owned.post, gated.tenantId, actor.uid, fields, 'published', keep, zone, true);
        await noteCrossChurch(actor, gated.tenantId, 'publishNow', post.id);
        await write(owned.post, post);
        return post;
      });
    },

    async unschedule(actor, input, mode, confirmToken) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      if (!owned.post) return fail('not_found', 'That post does not exist.');
      const zone = owned.post.scheduleTimeZone || 'UTC';
      const fields: BlogPostFields = {
        title: owned.post.title,
        category: owned.post.category,
        content: owned.post.content,
        featuredImage: owned.post.featuredImage,
        tags: owned.post.tags,
      };
      const preview = effect(
        'unschedule',
        { id: gated.tenantId, name: gated.churchName },
        { id: owned.post.id, title: owned.post.title, status: 'draft' },
        null,
        isValidTimeZone(zone) ? zone : 'UTC',
        'draft',
      );
      return openOrSpend(actor, mode, confirmToken, bindingFor('unschedule', actor, gated.tenantId, owned.post.id, fields, null, null), preview, async () => {
        const post = stamp(owned.post, gated.tenantId, actor.uid, fields, 'draft', null, null, true);
        await noteCrossChurch(actor, gated.tenantId, 'unschedule', post.id);
        await write(owned.post, post);
        return post;
      });
    },

    async deletePost(actor, input, mode, confirmToken) {
      const gated = await gate(actor, input.tenantId);
      if (!gated.ok) return gated;
      const owned = await loadOwned(actor, gated.tenantId, input.postId);
      if (!owned.ok) return owned;
      if (!owned.post) return fail('not_found', 'That post does not exist.');
      const target = owned.post;
      const zone = target.scheduleTimeZone && isValidTimeZone(target.scheduleTimeZone)
        ? target.scheduleTimeZone
        : 'UTC';
      const fields: BlogPostFields = {
        title: target.title,
        category: target.category,
        content: target.content,
        featuredImage: target.featuredImage,
        tags: target.tags,
      };
      const preview = effect(
        'delete',
        { id: gated.tenantId, name: gated.churchName },
        { id: target.id, title: target.title, status: 'removed' },
        target.publishedAt,
        zone,
        'removed',
      );
      const spent = await openOrSpend(actor, mode, confirmToken, bindingFor('delete', actor, gated.tenantId, target.id, fields, null, null), preview, async () => {
        await noteCrossChurch(actor, gated.tenantId, 'delete', target.id);
        await store.removePost(target.id);
      });
      if (!spent.ok) return spent;
      if ('confirmToken' in spent) {
        return { ok: true, preview: spent.preview, requiresConfirm: true as const, confirmToken: spent.confirmToken };
      }
      return { ok: true, preview: spent.preview };
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
  readonly confirmToken?: string | null;
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
  const confirmToken = typeof body.confirmToken === 'string' ? body.confirmToken : null;
  switch (body.action) {
    case 'createDraft':
      return http(await service.createDraft(actor, body));
    case 'validate':
      return http(await service.validate(actor, body));
    case 'schedule':
      return http(await service.schedule(actor, body, mode, confirmToken));
    case 'publishNow':
      return http(await service.publishNow(actor, body, mode, confirmToken));
    case 'unschedule':
      return http(await service.unschedule(actor, body, mode, confirmToken));
    case 'delete':
      return http(await service.deletePost(actor, body, mode, confirmToken));
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
    : result.error === 'not_authorized' || result.error === 'cross_tenant' || result.error === 'publishing_closed'
      ? 403
      : 400;
  return { status, body: result };
}
