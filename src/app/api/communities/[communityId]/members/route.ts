import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireTenantAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { DEFAULT_COMMUNITY_ID, isCommunityId } from '@/lib/community/communities';
import { communitiesRef, isTenantIdParam } from '@/lib/community/communities-server';
import { MEMBER_LIST_LIMIT, memberListEntry } from '@/lib/community/members';

export const dynamic = 'force-dynamic';

type Params = { params: { communityId: string } };

/**
 * #576: who is in a community other than the ministry's default one, for its
 * members and the ministry's admins. Names and photos only: a member's email
 * and answers stay with the ministry's CRM.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  const communityId = params.communityId;
  if (!isTenantIdParam(tenantId) || !isCommunityId(communityId) || communityId === DEFAULT_COMMUNITY_ID) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  try {
    const user = await requireAuth(request);
    if (user instanceof NextResponse) return user;
    const community = communitiesRef(tenantId).doc(communityId);
    const [record, own] = await Promise.all([community.get(), community.collection('members').doc(user.uid).get()]);
    if (!record.exists) return NextResponse.json({ error: 'Community not found.' }, { status: 404 });
    if (own.data()?.status !== 'active') {
      const admin = await requireTenantAdmin(request, tenantId);
      if (admin instanceof NextResponse) return NextResponse.json({ error: 'Join this community to see its members.' }, { status: 403 });
    }
    const active = await community.collection('members').where('status', '==', 'active').limit(MEMBER_LIST_LIMIT).get();
    const people = active.docs.length
      ? await adminDb.getAll(...active.docs.map(doc => adminDb.collection('users').doc(doc.id)))
      : [];
    const members = active.docs
      .map((doc, index) => memberListEntry(doc.id, doc.data(), people[index]?.exists ? people[index].data() : undefined))
      .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
    return NextResponse.json({ members, truncated: active.docs.length === MEMBER_LIST_LIMIT });
  } catch (error) {
    captureHandledError(error, { step: 'community-members', tenantId, ids: { communityId } });
    return NextResponse.json({ error: 'Could not load members. Please try again.' }, { status: 503 });
  }
}
