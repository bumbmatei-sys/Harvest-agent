import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { isCommunityTenantId } from '@/lib/community-membership';
import { readCommunityDeparture, writeCommunityDeparture } from '@/lib/community-privacy';

class ErasureError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Owner or the member's own authenticated account. Never deletes Auth, the
 * profile, another ministry's records, or financial records. Retain only the
 * access-revocation tombstone and email opt-out after erasing CRM and answers.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth(request);
    if (actor instanceof NextResponse) return actor;
    let raw: unknown;
    try { raw = await request.json(); } catch { throw new ErasureError('Invalid request.', 400); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ErasureError('Invalid request.', 400);
    const body = raw as Record<string, unknown>;
    if (!isCommunityTenantId(body.tenantId) ||
        Object.keys(body).some(key => !['tenantId', 'uid'].includes(key)) ||
        (body.uid !== undefined && (typeof body.uid !== 'string' || !body.uid || body.uid.length > 128 || body.uid.includes('/')))) {
      throw new ErasureError('Invalid request.', 400);
    }
    const { tenantId } = body;
    const uid = typeof body.uid === 'string' ? body.uid : actor.uid;
    await adminDb.runTransaction(async tx => {
      const tenantRef = adminDb.collection('tenants').doc(tenantId);
      const memberRef = tenantRef.collection('communityMembers').doc(uid);
      const personRef = adminDb.collection('users').doc(uid);
      const [tenant, member, person] = await Promise.all([tx.get(tenantRef), tx.get(memberRef), tx.get(personRef)]);
      if (!tenant.exists) throw new ErasureError('Community not found.', 404);
      if (uid !== actor.uid && tenant.data()!.ownerId !== actor.uid) throw new ErasureError('Only the owner or the member can delete this contact data.', 403);
      const departure = await readCommunityDeparture(tx, tenantId, uid, person.data()?.email);
      const linked = departure.contacts.filter(doc => doc.data().communityUserId === uid);
      if (!member.exists && linked.length === 0) throw new ErasureError('Community contact not found.', 404);
      const activities = await tx.get(adminDb.collection('contactActivities').where('tenantId', '==', tenantId));
      const ids = new Set(linked.map(doc => doc.id));
      const at = member.data()?.leftAt ?? Timestamp.now();
      writeCommunityDeparture(tx, departure, uid, at);
      for (const contact of linked) tx.delete(contact.ref);
      for (const activity of activities.docs) if (ids.has(activity.data().contactId)) tx.delete(activity.ref);
      // Replace, not merge: answers, consent and retained onboarding are erased.
      tx.set(memberRef, { uid, tenantId, status: 'left', leftAt: at, updatedAt: at, dataDeletedAt: Timestamp.now() });
      tx.delete(personRef.collection('memberships').doc(tenantId));
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ErasureError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Could not delete community contact data. Please try again.' }, { status: 503 });
  }
}
