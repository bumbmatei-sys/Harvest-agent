import 'server-only';
import { adminDb } from './firebase-admin';
import { isActiveMember } from './community-membership';

/** Community access only. Never use this to grant tenant staff or money access.
 * A transaction may supply its reader so review writes recheck leave atomically.
 * Read failures propagate; they must never become an empty membership.
 */
export async function isActiveCommunityMember(
  uid: string,
  tenantId: string,
  transaction?: FirebaseFirestore.Transaction,
): Promise<boolean> {
  const personRef = adminDb.collection('users').doc(uid);
  const memberRef = adminDb.collection('tenants').doc(tenantId).collection('communityMembers').doc(uid);
  const [person, member] = await Promise.all([
    transaction ? transaction.get(personRef) : personRef.get(),
    transaction ? transaction.get(memberRef) : memberRef.get(),
  ]);
  return isActiveMember(member.data(), person.data(), tenantId);
}

/** Complete union for the community directory/count. Profiles are projected by
 * the caller; a community admin must not receive another tenant's user record.
 */
export async function communityPeople(tenantId: string, includeNull = false) {
  const [primary, members, ...legacy] = await Promise.all([
    adminDb.collection('users').where('tenantId', '==', tenantId).get(),
    adminDb.collection('tenants').doc(tenantId).collection('communityMembers').get(),
    ...(includeNull ? [null, ''].map(value => adminDb.collection('users').where('tenantId', '==', value).get()) : []),
  ]);
  const profiles = new Map(primary.docs.map(doc => [doc.id, doc.data()]));
  const entries = new Map(members.docs.map(doc => [doc.id, doc.data()]));
  const joined = members.docs.filter(doc => doc.data().status === 'active' && !profiles.has(doc.id));
  const fetched = await Promise.all(joined.map(doc => adminDb.collection('users').doc(doc.id).get()));
  for (const doc of fetched) {
    if (!doc.exists) throw new Error('Community member profile missing');
    profiles.set(doc.id, doc.data()!);
  }
  const result = [...profiles].filter(([uid, profile]) => isActiveMember(entries.get(uid), profile, tenantId));
  // Platform-only legacy roster, an existing super-admin directory capability.
  for (const snapshot of legacy) for (const doc of snapshot.docs) {
    if (!profiles.has(doc.id) && !entries.has(doc.id)) result.push([doc.id, doc.data()]);
  }
  return result.sort(([a], [b]) => a.localeCompare(b));
}
