import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { DEFAULT_COMMUNITY_ID, isCommunityId, PAID_COMING_SOON_MESSAGE, PAID_COMMUNITIES_ENABLED, publishBlocker, readCommunityEdit, readCommunityRecord } from '@/lib/community/communities';
import { communitiesRef, communityLimit, isTenantIdParam, requireCommunityManager } from '@/lib/community/communities-server';
import { readCommunitySettings } from '@/lib/community/settings';
import { communityListingId, makeCommunitySpaceListing } from '@/lib/community/listing';

export const dynamic = 'force-dynamic';

class RouteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Params = { params: { communityId: string } };

async function parse(request: NextRequest) {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

/**
 * Edit a community's setup, or reopen the default community after a delete.
 * The default community's own setup stays on its existing settings screen.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const body = await parse(request);
  const tenantId = body?.tenantId;
  const id = params.communityId;
  if (!body || !isTenantIdParam(tenantId) || !isCommunityId(id)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const admin = await requireCommunityManager(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    if (id === DEFAULT_COMMUNITY_ID) {
      if (body.restore !== true) return NextResponse.json({ error: 'Edit the default community in its setup.' }, { status: 400 });
      const tenantRef = adminDb.collection('tenants').doc(tenantId);
      const settingsRef = tenantRef.collection('settings').doc('community');
      await adminDb.runTransaction(async tx => {
        const [tenant, others] = await Promise.all([tx.get(tenantRef), tx.get(communitiesRef(tenantId).select())]);
        if (!tenant.exists) throw new RouteError('Ministry not found.', 404);
        const limit = communityLimit(tenant.data() ?? {});
        const count = others.docs.filter(doc => doc.id !== DEFAULT_COMMUNITY_ID).length;
        if (limit !== -1 && count >= limit) throw new RouteError('Your plan has no room for another community. Delete one or upgrade first.', 403);
        // Reopened private: the admin publishes it again from its setup, which relists it.
        tx.set(settingsRef, { closed: false, isPublic: false }, { merge: true });
      });
      return NextResponse.json({ ok: true });
    }
    let edit;
    try { edit = readCommunityEdit(body.community); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    if (edit.pricing.type === 'paid' && !PAID_COMMUNITIES_ENABLED) return NextResponse.json({ error: PAID_COMING_SOON_MESSAGE }, { status: 400 });
    if (body.status !== undefined && body.status !== 'published' && body.status !== 'draft') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    const ref = communitiesRef(tenantId).doc(id);
    const general = ref.collection('channels').doc('general');
    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const listingRef = adminDb.collection('discovery_listings').doc(communityListingId(tenantId, id));
    await adminDb.runTransaction(async tx => {
      const [saved, channel, tenant, active] = await Promise.all([
        tx.get(ref), tx.get(general), tx.get(tenantRef),
        tx.get(ref.collection('members').where('status', '==', 'active').select()),
      ]);
      if (!saved.exists) throw new RouteError('Community not found.', 404);
      const current = readCommunityRecord(id, saved.data() ?? {});
      const status = body.status ?? current.status;
      // #576: a free community that lets anyone in can go live. A live
      // community cannot be edited into a setup that could not be published.
      const blocker = status === 'published' ? publishBlocker(edit) : null;
      if (blocker) throw new RouteError(blocker, 409);
      tx.update(ref, {
        ...edit, status, updatedAt: FieldValue.serverTimestamp(),
        ...(status === 'published' && current.status !== 'published' ? { publishedAt: FieldValue.serverTimestamp() } : {}),
      });
      // Every live community opens with one chat everybody is in.
      if (status === 'published' && !channel.exists) {
        tx.create(general, { name: 'General', description: '', audience: 'all', members: [], type: 'chat', createdAt: FieldValue.serverTimestamp(), createdBy: admin.uid });
      }
      // A live public community is on Discover; anything else is not.
      if (status === 'published' && edit.visibility === 'public') {
        const record = { id, ...edit, status, isDefault: false } as const;
        tx.set(listingRef, makeCommunitySpaceListing(tenantId, tenant.data() ?? {}, record, active.docs.length, new Date()));
      } else {
        tx.delete(listingRef);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    captureHandledError(error, { step: 'communities-edit', tenantId, ids: { communityId: id } });
    return NextResponse.json({ error: 'Could not save the community. Please try again.' }, { status: 503 });
  }
}

/**
 * Delete a community. The default one is closed rather than erased: members
 * see it closed, it leaves Discover, and its posts and members stay so an
 * admin can reopen it.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  const id = params.communityId;
  if (!isTenantIdParam(tenantId) || !isCommunityId(id)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const admin = await requireCommunityManager(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    if (id === DEFAULT_COMMUNITY_ID) {
      const tenantRef = adminDb.collection('tenants').doc(tenantId);
      const settingsRef = tenantRef.collection('settings').doc('community');
      await adminDb.runTransaction(async tx => {
        const saved = await tx.get(settingsRef);
        readCommunitySettings(saved.exists ? saved.data() : undefined);
        tx.set(settingsRef, { closed: true, isPublic: false }, { merge: true });
        tx.delete(adminDb.collection('discovery_listings').doc(tenantId));
      });
      return NextResponse.json({ ok: true });
    }
    const ref = communitiesRef(tenantId).doc(id);
    await adminDb.runTransaction(async tx => {
      const saved = await tx.get(ref);
      if (!saved.exists) throw new RouteError('Community not found.', 404);
      tx.delete(ref);
      tx.delete(adminDb.collection('discovery_listings').doc(communityListingId(tenantId, id)));
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    captureHandledError(error, { step: 'communities-delete', tenantId, ids: { communityId: id } });
    return NextResponse.json({ error: 'Could not delete the community. Please try again.' }, { status: 503 });
  }
}
