import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { readPublicListing } from '@/lib/community/public-listing';
import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import { stripHtml } from '@/utils/stripHtml';
import { parseFollowUp, type FollowUp } from './model';
import type { Listing } from '@/components/community/DiscoveryViews';

export class InvalidFollowUp extends Error {}
export type FollowUpItem = FollowUp & { listing: Listing; href: string };

/** The public community is the tenant itself; course products carry their tenant explicitly. */
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
    if (!snapshot.exists || settings.data()?.isPublic !== true) throw new InvalidFollowUp('This community is no longer public.');
    const listing = readPublicListing(snapshot.data()!);
    if (listing.tenantId !== tenantId || listing.isPublic !== true || !tenant.exists || tenant.data()?.plan === 'free' || tenant.data()?.subdomain !== listing.slug) throw new InvalidFollowUp('Choose a public community from this ministry.');
    return { ...selection, listing, href: `https://${listing.slug}.theharvest.app` };
  }
  const snapshot = selection.productKind === 'digital'
    ? await adminDb.collection('tenants').doc(tenantId).collection('digitalProducts').doc(selection.id).get()
    : await adminDb.collection('courses').doc(selection.id).get();
  const course = snapshot.data();
  if (!snapshot.exists || (selection.productKind !== 'digital' && course?.tenantId !== tenantId) || course?.status !== 'published') throw new InvalidFollowUp('Choose a published product from this ministry.');
  const tenant = (await adminDb.collection('tenants').doc(tenantId).get()).data();
  const slug = tenant?.subdomain;
  if (tenant?.plan === 'free' || typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || isNonTenantSubdomain(slug)) throw new InvalidFollowUp('This product has no public page.');
  if (typeof course.title !== 'string' || !course.title.trim() || (course.description !== undefined && typeof course.description !== 'string')) throw new Error('Invalid product data');
  return { ...selection, href: `https://${slug}.theharvest.app/${selection.productKind === 'digital' ? 'products' : 'courses'}/${encodeURIComponent(selection.id)}`, listing: {
    tenantId, slug, name: course.title, shortDescription: stripHtml(course.description === undefined ? '' : course.description), logoUrl: '', memberCount: 0,
    coverUrl: selection.productKind === 'digital' ? course.coverUrl : course.coverImage || course.thumbnail || '',
  } };
}
