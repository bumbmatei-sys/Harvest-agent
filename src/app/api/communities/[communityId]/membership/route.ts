import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { COMMUNITY_CONSENT_SCOPE, COMMUNITY_CONSENT_VERSION } from '@/lib/community-membership';
import { DEFAULT_COMMUNITY_ID, isCommunityId, membershipIndexId, readCommunityRecord } from '@/lib/community/communities';
import { communitiesRef, isTenantIdParam } from '@/lib/community/communities-server';

export const dynamic = 'force-dynamic';

class MembershipError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Params = { params: { communityId: string } };

/**
 * Join or leave a community other than the ministry's default one (the default
 * keeps /api/community/join and /leave). Joining needs a published, public
 * community that lets anyone in, the current consent, and an account.
 */
async function change(request: NextRequest, communityId: string, joining: boolean) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { throw new MembershipError('Invalid request.', 400); }
  const tenantId = body?.tenantId;
  if (!isTenantIdParam(tenantId) || !isCommunityId(communityId) || communityId === DEFAULT_COMMUNITY_ID) throw new MembershipError('Invalid request.', 400);
  if (joining) {
    if (body.consent !== true) throw new MembershipError('Consent is required to join this community.', 400);
    if (body.acceptedConsentVersion !== COMMUNITY_CONSENT_VERSION) throw new MembershipError('Read and accept the current community consent notice before joining.', 400);
  }
  const communityRef = communitiesRef(tenantId).doc(communityId);
  const memberRef = communityRef.collection('members').doc(user.uid);
  const indexRef = adminDb.collection('users').doc(user.uid).collection('communityMemberships').doc(membershipIndexId(tenantId, communityId));
  await adminDb.runTransaction(async tx => {
    const [community, member, person] = await Promise.all([tx.get(communityRef), tx.get(memberRef), tx.get(adminDb.collection('users').doc(user.uid))]);
    if (!community.exists) throw new MembershipError('Community not found.', 404);
    const record = readCommunityRecord(communityId, community.data() ?? {});
    const previous = member.data();
    const now = Timestamp.now();
    if (joining) {
      if (record.status !== 'published' || record.visibility !== 'public' || record.joining.mode !== 'open' || record.pricing.type !== 'free') {
        throw new MembershipError('This community is not open to join.', 403);
      }
      if (!person.exists) throw new MembershipError('Finish creating your account before joining this community.', 409);
      if (previous?.status === 'active') return;
      tx.set(memberRef, {
        uid: user.uid, tenantId, communityId, status: 'active',
        joinedAt: now, leftAt: null, updatedAt: now,
        consentAt: now, consentScope: COMMUNITY_CONSENT_SCOPE, consentVersion: COMMUNITY_CONSENT_VERSION,
      });
      tx.set(indexRef, { tenantId, communityId, status: 'active', joinedAt: now, leftAt: null });
    } else {
      if (previous?.status !== 'active') return;
      tx.set(memberRef, { status: 'left', leftAt: now, updatedAt: now }, { merge: true });
      tx.set(indexRef, { tenantId, communityId, status: 'left', joinedAt: previous.joinedAt ?? null, leftAt: now });
    }
  });
  return NextResponse.json({ ok: true });
}

async function handle(request: NextRequest, communityId: string, joining: boolean) {
  try { return await change(request, communityId, joining); }
  catch (error) {
    if (error instanceof MembershipError) return NextResponse.json({ error: error.message }, { status: error.status });
    captureHandledError(error, { step: joining ? 'community-join' : 'community-leave', ids: { communityId } });
    return NextResponse.json({ error: 'Could not update your membership. Please try again.' }, { status: 503 });
  }
}

export const POST = (request: NextRequest, { params }: Params) => handle(request, params.communityId, true);
export const DELETE = (request: NextRequest, { params }: Params) => handle(request, params.communityId, false);
