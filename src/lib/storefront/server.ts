import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import { firestoreBlogStore } from '@/lib/blog/firestore-store';
import { isBlogPostPublic } from '@/lib/blog/visibility';
import { readStorefront, type Storefront } from './storefront';

/**
 * Storefront reads and writes, through the Admin SDK only. The document is
 * storefronts/{tenantId}; the public page reads it server-side the way
 * /giving and /calendar read theirs, so no Firestore rule opens it.
 */
const storefrontRef = (tenantId: string) => adminDb.collection('storefronts').doc(tenantId);

export async function loadStorefront(tenantId: string, fallbackName: string): Promise<Storefront> {
  const snap = await storefrontRef(tenantId).get();
  return readStorefront(snap.exists ? snap.data() : null, fallbackName);
}

export async function saveStorefront(tenantId: string, storefront: Storefront, uid: string): Promise<void> {
  await storefrontRef(tenantId).set({ ...storefront, tenantId, updatedAt: new Date().toISOString(), updatedBy: uid });
}

export interface StorefrontArticle {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly excerpt: string;
  readonly image: string | null;
  readonly publishedAt: string | null;
}

export interface StorefrontEvent {
  readonly id: string;
  readonly title: string;
  readonly startDate: string | null;
  readonly location: string | null;
  readonly image: string | null;
}

const excerptOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

/** Every public Harvest article of the ministry, newest first. */
export async function loadStorefrontArticles(tenantId: string, now = Date.now()): Promise<StorefrontArticle[]> {
  const list = await firestoreBlogStore.listByTenant(tenantId);
  return list.posts
    .filter((post) => isBlogPostPublic(post, now))
    .sort((a, b) => Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt))
    .map((post) => ({
      id: post.id,
      title: post.title,
      category: post.category,
      excerpt: excerptOf(post.content),
      image: post.featuredImage,
      publishedAt: post.publishedAt ?? post.createdAt,
    }));
}

/** The ministry's next published public events, soonest first; the same filter as /calendar. */
export async function loadStorefrontEvents(tenantId: string, limit: number, now = new Date()): Promise<StorefrontEvent[]> {
  const snap = await adminDb.collection('tenants').doc(tenantId).collection('events').where('status', '==', 'published').limit(100).get();
  const toIso = (value: unknown) => (value && typeof (value as { toDate?: () => Date }).toDate === 'function' ? (value as { toDate: () => Date }).toDate().toISOString() : null);
  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
    .filter(({ data }) => {
      const cutoff = toIso(data.endDate) ?? toIso(data.startDate);
      if (cutoff && Date.parse(cutoff) < now.getTime()) return false;
      return data.showOnPublicCalendar !== false;
    })
    .map(({ id, data }) => ({
      id,
      title: typeof data.title === 'string' ? data.title : 'Event',
      startDate: toIso(data.startDate),
      location: typeof data.location === 'string' ? data.location : null,
      image: typeof data.coverImage === 'string' ? data.coverImage : null,
    }))
    .sort((a, b) => (a.startDate ? Date.parse(a.startDate) : Infinity) - (b.startDate ? Date.parse(b.startDate) : Infinity))
    .slice(0, limit);
}
