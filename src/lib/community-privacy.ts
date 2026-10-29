import 'server-only';
import { createHash } from 'node:crypto';
import { adminDb } from './firebase-admin';
import { normalizeEmail } from './donation-history';

export const communitySuppressionId = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex');

/** Read before any transaction writes. Single-field queries need no new index. */
export async function readCommunityDeparture(tx: FirebaseFirestore.Transaction, tenantId: string, uid: string, email: unknown) {
  const tenant = adminDb.collection('tenants').doc(tenantId);
  const [contacts, channels] = await Promise.all([
    tx.get(adminDb.collection('contacts').where('tenantId', '==', tenantId)),
    tx.get(tenant.collection('channels').where('members', 'array-contains', uid)),
  ]);
  const address = typeof email === 'string' ? normalizeEmail(email) : '';
  const linked = contacts.docs.filter(doc => doc.data().communityUserId === uid || doc.data().userId === uid);
  const emails = new Set(linked.map(doc => doc.data().email).filter((value): value is string => typeof value === 'string').map(normalizeEmail).filter(Boolean));
  if (address) emails.add(address);
  return { tenant, channels: channels.docs, contacts: contacts.docs.filter(doc => linked.includes(doc) ||
    (typeof doc.data().email === 'string' && emails.has(normalizeEmail(doc.data().email)))), emails };
}

/** Leave and suppression commit together, even if the later CRM repair fails.
 * The server-only address record also blocks duplicates and later re-imports.
 * Rejoining never silently re-subscribes someone who left.
 */
export function writeCommunityDeparture(tx: FirebaseFirestore.Transaction, departure: Awaited<ReturnType<typeof readCommunityDeparture>>, uid: string, at: FirebaseFirestore.Timestamp) {
  for (const channel of departure.channels) {
    tx.update(channel.ref, { members: channel.data().members.filter((member: unknown) => member !== uid) });
  }
  for (const contact of departure.contacts) {
    tx.update(contact.ref, { emailStatus: 'unsubscribed', emailUnsubscribedAt: at.toDate().toISOString(),
      ...(contact.data().communityUserId === uid ? { communityStatus: 'left', communityLeftAt: at } : {}) });
  }
  for (const email of departure.emails) {
    tx.set(departure.tenant.collection('emailSuppressions').doc(communitySuppressionId(email)), {
      email, status: 'unsubscribed', at: at.toDate().toISOString(), from: 'community-leave',
    }, { merge: true });
  }
}

/** All owner-directed individual/bulk email must consult the same opt-out as
 * newsletter sends. Read failures throw before a provider is called.
 */
export async function tenantAddressSuppressed(tenantId: string, email: string): Promise<boolean> {
  const record = await adminDb.collection('tenants').doc(tenantId).collection('emailSuppressions').doc(communitySuppressionId(email)).get();
  return record.exists;
}

export async function tenantEmailBlocked(tenantId: string, email: string): Promise<boolean> {
  if (await tenantAddressSuppressed(tenantId, email)) return true;
  const contacts = await adminDb.collection('contacts').where('tenantId', '==', tenantId).get();
  return contacts.docs.some(doc => doc.data().communityStatus === 'left' &&
    typeof doc.data().email === 'string' && normalizeEmail(doc.data().email) === normalizeEmail(email));
}

/** Bulk fallback resolves the complete block list once, then uses point reads
 * before transport. Avoid scanning the whole CRM once per announcement recipient.
 */
export async function tenantBlockedEmails(tenantId: string): Promise<ReadonlySet<string>> {
  const [contacts, suppressions] = await Promise.all([
    adminDb.collection('contacts').where('tenantId', '==', tenantId).get(),
    adminDb.collection('tenants').doc(tenantId).collection('emailSuppressions').get(),
  ]);
  const addresses = [...suppressions.docs, ...contacts.docs.filter(doc => doc.data().communityStatus === 'left')];
  return new Set(addresses.map(doc => doc.data().email).filter((email): email is string => typeof email === 'string').map(normalizeEmail));
}
