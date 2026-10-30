import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { readPublicListing } from '@/lib/community/public-listing';
import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import { stripHtml } from '@/utils/stripHtml';
import { isRestrictedCourse } from '@/lib/courses/access';
import { parseFollowUp, type FollowUp } from './model';
import type { Listing } from '@/components/community/DiscoveryViews';

export class InvalidFollowUp extends Error {}
export type FollowUpItem = FollowUp & { listing: Listing; href: string };
/** A tenant gets a subdomain only once it has a published website (founder decision, #562 r2). Everything else lives on theharvest.app. */
export const publicSlug = (slug: unknown): slug is string => typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) && !isNonTenantSubdomain(slug);

/**
 * The public community is the tenant itself; course products carry their tenant explicitly.
 *
 * A tenant with no published website (every Free tenant, and a hostless paid one) has no
 * subdomain, so its public page lives on theharvest.app instead of `{slug}.theharvest.app`.
 * The `discovery_listings` index is keyed by subdomain (`makeDiscoveryListing` requires one)
 * and stays exactly as it was for a tenant that has one; a hostless tenant's community is
 * built straight from its own settings doc instead of going through that index.
 */
export async function validateFollowUp(tenantId: string, value: unknown): Promise<FollowUpItem | null> {
  let selection;
  try { selection = parseFollowUp(value); } catch { throw new InvalidFollowUp('Invalid follow-up selection.'); }
  if (!selection) return null;
  if (selection.type === 'community') {
    if (selection.id !== tenantId) throw new InvalidFollowUp('Choose a public community from this ministry.');
    const [snapshot, settings, tenant] = await Promise.all([
      adminDb.collection('discovery_listings').doc(selection.id).get(),
      adminDb.collection('tenants').doc(tenantId).collection('settings').doc('community').get(),
      adminDb.collection('tenants').doc(tenantId).get(),
    ]);
    if (settings.data()?.isPublic !== true || !tenant.exists) throw new InvalidFollowUp('This community is no longer public.');
    const tenantData = tenant.data()!;
    // A tenant that CLAIMS a subdomain (even an invalid one — bad data is a
    // rejection, not a quiet downgrade to hostless) is held to the existing,
    // unrelaxed rule below. Only a tenant with NO subdomain at all — every
    // Free tenant, and a hostless paid one — reaches the branch beneath it.
    const hasSubdomain = typeof tenantData.subdomain === 'string' && tenantData.subdomain.length > 0;
    if (hasSubdomain) {
      if (!publicSlug(tenantData.subdomain) || !snapshot.exists || !publicSlug(snapshot.data()?.slug)) throw new InvalidFollowUp('This community has no public page.');
      const listing = readPublicListing(snapshot.data()!);
      if (listing.tenantId !== tenantId || listing.isPublic !== true || tenantData.subdomain !== listing.slug) throw new InvalidFollowUp('Choose a public community from this ministry.');
      return { ...selection, listing, href: `https://${listing.slug}.theharvest.app` };
    }
    // Hostless — no subdomain means no entry in the subdomain-keyed discovery
    // index (see community/settings route), so the listing is read straight
    // off the settings doc that gates this branch, field by field with the
    // same defaults readCommunitySettings applies, rather than off the index.
    if (typeof tenantData.name !== 'string' || !tenantData.name.trim()) throw new InvalidFollowUp('This community is no longer public.');
    const raw = (settings.data() ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => typeof v === 'string' ? v : '';
    const memberCount = (await adminDb.collection('users').where('tenantId', '==', tenantId).count().get()).data().count;
    const listing: Listing = {
      tenantId, slug: '', name: tenantData.name.trim(), logoUrl: str(raw.logoUrl), brandColor: str(raw.brandColor) || undefined,
      shortDescription: str(raw.shortDescription), memberCount, coverUrl: str(raw.coverUrl),
      galleryUrls: Array.isArray(raw.galleryUrls) ? raw.galleryUrls.filter((u): u is string => typeof u === 'string') : [],
      longDescription: str(raw.longDescription), ownerName: str(raw.ownerName), isPublic: true,
    };
    return { ...selection, listing, href: `https://theharvest.app/c/${encodeURIComponent(tenantId)}` };
  }
  const snapshot = selection.productKind === 'digital'
    ? await adminDb.collection('tenants').doc(tenantId).collection('digitalProducts').doc(selection.id).get()
    : await adminDb.collection('courses').doc(selection.id).get();
  const course = snapshot.data();
  if (!snapshot.exists || (selection.productKind !== 'digital' && course?.tenantId !== tenantId) || course?.status !== 'published') throw new InvalidFollowUp('Choose a published product from this ministry.');
  if (selection.productKind !== 'digital' && isRestrictedCourse(course)) throw new InvalidFollowUp('Choose a course open to everyone in this ministry.');
  const tenant = (await adminDb.collection('tenants').doc(tenantId).get()).data();
  const slug = tenant?.subdomain;
  const hasSubdomain = typeof slug === 'string' && slug.length > 0;
  // Same distinction as the community branch above: a tenant that claims a
  // subdomain is held to it exactly as before — only a genuinely hostless
  // tenant (no subdomain at all) gets the theharvest.app fallback.
  if (hasSubdomain && !publicSlug(slug)) throw new InvalidFollowUp('This product has no public page.');
  if (typeof course.title !== 'string' || !course.title.trim() || (course.description !== undefined && typeof course.description !== 'string')) throw new Error('Invalid product data');
  const kind = selection.productKind === 'digital' ? 'products' : 'courses';
  const href = hasSubdomain
    ? `https://${slug}.theharvest.app/${kind}/${encodeURIComponent(selection.id)}`
    : `https://theharvest.app/${kind}/${encodeURIComponent(selection.id)}?t=${encodeURIComponent(tenantId)}`;
  return { ...selection, href, listing: {
    tenantId, slug: hasSubdomain ? slug : '', name: course.title, shortDescription: stripHtml(course.description === undefined ? '' : course.description), logoUrl: '', memberCount: 0,
    coverUrl: selection.productKind === 'digital' ? course.coverUrl : course.coverImage || course.thumbnail || '',
  } };
}
