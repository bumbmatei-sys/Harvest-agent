import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { isTenantAdminRole } from '@/lib/roles';
import { COMMUNITY_CONSENT_VERSION, buildCommunityMember, isActiveMember, isCommunityTenantId, normaliseSource, type CommunityMember, type UserMembership } from './community-membership';
import { readCommunitySettings, requiredQuestionsAnswered } from './community/settings';
import { readCommunityDeparture, writeCommunityDeparture, readCommunityRejoin, writeCommunityRejoin } from './community-privacy';
import { upsertCommunityContact } from './community-contact';

class MembershipError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const badRequest = () => new MembershipError('Invalid community request.', 400);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function parseBody(value: unknown, joining: boolean) {
  if (!isRecord(value) || !isCommunityTenantId(value.tenantId)) throw badRequest();
  const allowed = joining ? ['tenantId', 'source', 'rulesAcceptedVersion', 'answers', 'consent', 'acceptedConsentVersion'] : ['tenantId'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw badRequest();
  if (!joining) return { tenantId: value.tenantId };
  if (value.consent !== true) throw new MembershipError('Consent is required to join this community.', 400);
  if (value.acceptedConsentVersion !== COMMUNITY_CONSENT_VERSION) throw new MembershipError('Read and accept the current community consent notice before joining.', 400);
  let source;
  try { source = normaliseSource(value.source); } catch { throw badRequest(); }
  const version = value.rulesAcceptedVersion;
  if (version !== undefined && (!Number.isSafeInteger(version) || (version as number) < 0)) throw badRequest();
  const answers = value.answers;
  if (answers !== undefined && (!isRecord(answers) || Object.keys(answers).length > 100 ||
      Object.entries(answers).some(([key, answer]) => !key || /^__.*__$/.test(key) || key.length > 128 || typeof answer !== 'string' || answer.length > 4000))) throw badRequest();
  return { tenantId: value.tenantId, source, rulesAcceptedVersion: version as number | undefined, answers: answers as Record<string, string> | undefined };
}

export async function communityMembershipRequest(request: NextRequest, joining: boolean) {
  try {
    const user = await requireAuth(request);
    if (user instanceof NextResponse) return user;
    let raw: unknown;
    try { raw = await request.json(); } catch { throw badRequest(); }
    const body = parseBody(raw, joining);
    const { tenantId } = body;
    const tenantRef = adminDb.collection('tenants').doc(tenantId);
    const personRef = adminDb.collection('users').doc(user.uid);
    const memberRef = tenantRef.collection('communityMembers').doc(user.uid);
    const indexRef = personRef.collection('memberships').doc(tenantId);
    await adminDb.runTransaction(async tx => {
      const [tenant, person, member] = await Promise.all([tx.get(tenantRef), tx.get(personRef), tx.get(memberRef)]);
      if (!tenant.exists) throw new MembershipError('Community not found.', 404);
      const tenantData = tenant.data()!;
      const profile = person.data();
      const previous = member.data() as Partial<CommunityMember<Timestamp>> | undefined;
      if (joining) {
        // Discover publishes exactly when settings.isPublic is true. Check both
        // authoritative settings and publication, never trust a stale listing.
        const [settingsDoc, listing] = await Promise.all([
          tx.get(tenantRef.collection('settings').doc('community')),
          tx.get(adminDb.collection('discovery_listings').doc(tenantId)),
        ]);
        const settings = readCommunitySettings(settingsDoc.data());
        if (!settings.isPublic || !listing.exists || listing.data()?.isPublic === false ||
            (tenantData.status !== undefined && tenantData.status !== 'active')) {
          throw new MembershipError('This community is not open to join.', 403);
        }
        if (isActiveMember(previous, profile, tenantId)) return;
        if (settings.rules.enabled && body.rulesAcceptedVersion !== settings.rules.version) {
          throw new MembershipError('Accept the current community rules before joining.', 400);
        }
        if (settings.questions.enabled && !requiredQuestionsAnswered(settings.questions.items, body.answers ?? {})) {
          throw new MembershipError('Answer the required community questions before joining.', 400);
        }
        const data = buildCommunityMember({ uid: user.uid, tenantId, source: body.source!, now: Timestamp.now(),
          previous, rulesAcceptedVersion: body.rulesAcceptedVersion, answers: body.answers });
        // Only a verified token email can clear another address's opt-out block;
        // an unverified or forged email on the token clears nothing (see B1, r3 review).
        const rejoin = previous?.status === 'left'
          ? await readCommunityRejoin(tx, tenantId, user.uid, user.emailVerified ? user.email : undefined) : null;
        if (rejoin) writeCommunityRejoin(tx, rejoin);
        const index: UserMembership<Timestamp> = { tenantId, status: data.status, joinedAt: data.joinedAt, leftAt: null };
        // Replace the complete record so submitted answers also clear the old
        // pending-questions marker instead of recursively merging it back in.
        tx.set(memberRef, data);
        tx.set(indexRef, index);
      } else {
        const privateDoc = await tx.get(adminDb.collection('tenant_private').doc(tenantId));
        const roster: unknown = privateDoc.data()?.adminEmails;
        if (roster !== undefined && (!Array.isArray(roster) || roster.some(email => typeof email !== 'string'))) {
          throw new Error('Invalid community admin roster.');
        }
        if (tenantData.ownerId === user.uid ||
            (profile?.tenantId === tenantId && isTenantAdminRole(profile.role)) ||
            (user.tenantId === tenantId && user.isAdmin) ||
            (user.email && Array.isArray(roster) && roster.some(email => typeof email === 'string' && email.toLowerCase() === user.email!.toLowerCase()))) {
          throw new MembershipError('Owners and admins cannot leave their own community.', 400);
        }
        if (!isActiveMember(previous, profile, tenantId) && previous?.status !== 'left') return;
        const departure = await readCommunityDeparture(tx, tenantId, user.uid, profile?.email);
        const now = previous?.status === 'left' && previous.leftAt ? previous.leftAt : Timestamp.now();
        writeCommunityDeparture(tx, departure, user.uid, now);
        if (previous?.status === 'left') return;
        tx.set(memberRef, { uid: user.uid, tenantId, status: 'left', leftAt: now, updatedAt: now }, { merge: true });
        const index: UserMembership<Timestamp> = { tenantId, status: 'left', joinedAt: previous?.joinedAt ?? null, leftAt: now };
        tx.set(indexRef, index);
      }
    });
    // Both retries repair CRM from the authoritative membership, including leave.
    await upsertCommunityContact({ uid: user.uid, tenantId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MembershipError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Could not update community membership. Please try again.' }, { status: 503 });
  }
}
