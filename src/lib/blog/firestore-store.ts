import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import type { BlogAuditEvent, BlogStore, StoredBlogPost } from '@/lib/blog/service';
import type { BlogStoredStatus } from '@/lib/blog/visibility';

function asStatus(value: unknown): BlogStoredStatus | null {
  if (value === 'draft' || value === 'scheduled' || value === 'published') return value;
  return null;
}

function asIso(value: unknown): string | null {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function readPost(id: string, data: Record<string, unknown>): StoredBlogPost | null {
  const status = asStatus(data.status);
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : '';
  if (!status || !tenantId) return null;
  if (typeof data.title !== 'string' || typeof data.content !== 'string') return null;
  const createdAt = asIso(data.createdAt);
  const updatedAt = asIso(data.updatedAt);
  if (!createdAt || !updatedAt) return null;
  const tags = Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  return {
    id,
    tenantId,
    status,
    title: data.title,
    category: typeof data.category === 'string' ? data.category : '',
    content: data.content,
    featuredImage: typeof data.featuredImage === 'string' && data.featuredImage ? data.featuredImage : null,
    tags,
    publishedAt: asIso(data.publishedAt),
    scheduleTimeZone: typeof data.scheduleTimeZone === 'string' ? data.scheduleTimeZone : null,
    authorId: typeof data.authorId === 'string' ? data.authorId : '',
    createdAt,
    updatedAt,
    seoTitle: typeof data.seoTitle === 'string' ? data.seoTitle : null,
    seoDescription: typeof data.seoDescription === 'string' ? data.seoDescription : null,
    keywords: Array.isArray(data.keywords) ? data.keywords.filter((word): word is string => typeof word === 'string') : [],
  };
}

function writePayload(post: StoredBlogPost, insert: boolean): Record<string, unknown> {
  const publishedAt = post.publishedAt ?? (insert ? null : FieldValue.delete());
  const scheduleTimeZone = post.scheduleTimeZone ?? (insert ? null : FieldValue.delete());
  return {
    title: post.title,
    category: post.category,
    content: post.content,
    featuredImage: post.featuredImage,
    tags: [...post.tags],
    status: post.status,
    ...(publishedAt == null ? {} : { publishedAt }),
    ...(scheduleTimeZone == null ? {} : { scheduleTimeZone }),
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    keywords: [...post.keywords],
    authorId: post.authorId,
    tenantId: post.tenantId,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export const firestoreBlogStore: BlogStore = {
  async getTenant(tenantId) {
    const snap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '';
    if (!name) return null;
    return {
      name,
      status: data.status,
      ownerId: typeof data.ownerId === 'string' ? data.ownerId : null,
    };
  },

  async getAdminEmails(tenantId) {
    const data = await getTenantPrivate(tenantId);
    return Array.isArray(data.adminEmails)
      ? data.adminEmails.filter((email): email is string => typeof email === 'string')
      : [];
  },

  async getPermissions(uid) {
    const snap = await adminDb.collection('users').doc(uid).get();
    if (!snap.exists) return {};
    const permissions = snap.data()?.permissions;
    if (!permissions || typeof permissions !== 'object') return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(permissions as Record<string, unknown>)) {
      if (value === true) out[key] = true;
    }
    return out;
  },

  async getPost(id) {
    const snap = await adminDb.collection('blog_posts').doc(id).get();
    if (!snap.exists) return null;
    return readPost(snap.id, (snap.data() || {}) as Record<string, unknown>);
  },

  async insertPost(post) {
    await adminDb.collection('blog_posts').doc(post.id).set(writePayload(post, true));
  },

  async savePost(post) {
    await adminDb.collection('blog_posts').doc(post.id).update(writePayload(post, false));
  },

  async removePost(id) {
    await adminDb.collection('blog_posts').doc(id).delete();
  },

  async appendAudit(event: BlogAuditEvent) {
    await adminDb.collection('blog_admin_audit').add({
      actorUid: event.actorUid,
      actorTenantId: event.actorTenantId,
      tenantId: event.tenantId,
      action: event.action,
      postId: event.postId,
      at: event.at,
    });
  },

  async listByTenant(tenantId) {
    const snap = await adminDb.collection('blog_posts').where('tenantId', '==', tenantId).get();
    const posts: StoredBlogPost[] = [];
    let skipped = 0;
    for (const doc of snap.docs) {
      const post = readPost(doc.id, doc.data() as Record<string, unknown>);
      if (post) posts.push(post);
      else skipped += 1;
    }
    return { posts, skipped };
  },
};
