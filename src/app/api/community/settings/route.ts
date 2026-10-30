import { NextRequest, NextResponse } from 'next/server';
import { requireTenantAdmin, requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { isTenantUploadKey } from '@/utils/r2-keys';
import { makeDiscoveryListing } from '@/lib/community/listing';
import { readReviewAggregate } from '@/lib/community/review-aggregate';
import { communitySettingsFingerprint, prepareCommunitySettings, readCommunitySettings } from '@/lib/community/settings';
import { publicSlug } from '@/lib/form-follow-up/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { tenantId?: unknown; next?: unknown; previous?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  if (!body || typeof body.tenantId !== 'string' || !body.tenantId || body.tenantId.includes('/')) {
    return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  }
  if (!body.next || !body.previous) return NextResponse.json({ error: 'Invalid community settings.' }, { status: 400 });
  const tenantId = body.tenantId;
  try {
    const admin = await requireTenantAdmin(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    // The roster is an independent admin grant and can have no tenant claim.
    if (!admin.isSuperAdmin && admin.tenantId === tenantId) {
      const permitted = await requireTenantPermission(request, tenantId, 'manageCommunity');
      if (permitted instanceof NextResponse) return permitted;
    }
    let previous, next;
    try {
      previous = readCommunitySettings(body.previous);
      next = readCommunitySettings(body.next);
      const mediaBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, '');
      for (const image of [next.logoUrl, next.coverUrl, ...next.galleryUrls].filter(Boolean)) {
        if (!mediaBase || !image.startsWith(`${mediaBase}/`) || !isTenantUploadKey(image.slice(mediaBase.length + 1), tenantId)) throw new Error('Invalid media URL.');
      }
      if (communitySettingsFingerprint(prepareCommunitySettings(previous, next)) !== communitySettingsFingerprint(next)) throw new Error('Invalid settings version.');
    } catch { return NextResponse.json({ error: 'Invalid community settings.' }, { status: 400 }); }
    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const settingsRef = tenantRef.collection('settings').doc('community');
    const groupRef = tenantRef.collection('channels').doc('all-members');
    const listingRef = adminDb.collection('discovery_listings').doc(tenantId);
    const count = next.isPublic ? (await adminDb.collection('users').where('tenantId', '==', tenantId).count().get()).data().count : 0;
    await adminDb.runTransaction(async tx => {
      const [saved, tenant, group] = await Promise.all([tx.get(settingsRef), tx.get(tenantRef), tx.get(groupRef)]);
      const current = readCommunitySettings(saved.exists ? saved.data() : undefined);
      if (communitySettingsFingerprint(current) !== communitySettingsFingerprint(previous)) throw new Error('Community settings changed elsewhere. Reload this page before saving.');
      if (!tenant.exists) throw new Error('Ministry not found.');
      if (!group.exists) tx.set(groupRef, { name: 'All members', description: '', audience: 'all', members: [], createdAt: new Date(), createdBy: admin.uid, type: 'announcement' });
      const aggregate = readReviewAggregate(saved.exists ? saved.data() : undefined);
      // A tenant with no published website has no subdomain, so it has no slug
      // for the subdomain-keyed discovery index to carry (makeDiscoveryListing
      // requires one). `isPublic` still saves — its community lives at
      // theharvest.app/c/{tenantId} instead (form-follow-up/server.ts) — it is
      // just not in `discovery_listings`, the same as a private community.
      if (next.isPublic && publicSlug(tenant.data()?.subdomain)) tx.set(listingRef, { ...makeDiscoveryListing(tenantId, tenant.data()!, next, count, new Date()), ...aggregate });
      else tx.delete(listingRef);
      tx.set(settingsRef, { ...next, ...aggregate });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('Community settings changed') || message.startsWith('Invalid community listing') || message.startsWith('Enter a valid HTTPS')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Could not save community settings.' }, { status: 500 });
  }
}
