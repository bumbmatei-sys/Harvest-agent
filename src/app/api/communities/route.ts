import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { communityIdFor, DEFAULT_COMMUNITY_ID, newCommunityDraft, readCommunityEdit } from '@/lib/community/communities';
import { communitiesRef, communityLimit, isTenantIdParam, loadCommunities, requireCommunityManager } from '@/lib/community/communities-server';
import { readCommunitySettings } from '@/lib/community/settings';

export const dynamic = 'force-dynamic';

/** Every community of the ministry, for the admin Communities page. */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!isTenantIdParam(tenantId)) return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  try {
    const admin = await requireCommunityManager(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    const list = await loadCommunities(tenantId);
    if (!list) return NextResponse.json({ error: 'Ministry not found.' }, { status: 404 });
    return NextResponse.json(list);
  } catch (error) {
    captureHandledError(error, { step: 'communities-list', tenantId });
    return NextResponse.json({ error: 'Could not load communities. Please try again.' }, { status: 503 });
  }
}

class CreateError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** A new community starts as a private, free draft holding only its name. */
export async function POST(request: NextRequest) {
  let body: { tenantId?: unknown; name?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const tenantId = body?.tenantId;
  if (!isTenantIdParam(tenantId)) return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  let draft;
  try { draft = readCommunityEdit(newCommunityDraft(typeof body.name === 'string' ? body.name : '')); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  try {
    const admin = await requireCommunityManager(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const id = await adminDb.runTransaction(async tx => {
      const [tenant, settings, existing] = await Promise.all([
        tx.get(tenantRef), tx.get(tenantRef.collection('settings').doc('community')), tx.get(communitiesRef(tenantId).select()),
      ]);
      if (!tenant.exists) throw new CreateError('Ministry not found.', 404);
      const limit = communityLimit(tenant.data() ?? {});
      const others = existing.docs.filter(doc => doc.id !== DEFAULT_COMMUNITY_ID).length;
      const defaultOpen = readCommunitySettings(settings.exists ? settings.data() : undefined).closed !== true;
      if (limit !== -1 && others + (defaultOpen ? 1 : 0) >= limit) {
        throw new CreateError(limit === 0
          ? 'Your plan does not include communities. Upgrade to create one.'
          : `Your plan includes ${limit} ${limit === 1 ? 'community' : 'communities'}. Upgrade to add more.`, 403);
      }
      const next = communityIdFor(draft.name, new Set([DEFAULT_COMMUNITY_ID, ...existing.docs.map(doc => doc.id)]));
      tx.create(communitiesRef(tenantId).doc(next), {
        ...draft, status: 'draft', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: admin.uid,
      });
      return next;
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof CreateError) return NextResponse.json({ error: error.message }, { status: error.status });
    captureHandledError(error, { step: 'communities-create', tenantId });
    return NextResponse.json({ error: 'Could not create the community. Please try again.' }, { status: 503 });
  }
}
