import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { normalizeEmail } from './donation-history';
import { communitySuppressionId } from './email/suppression-key';

export { communitySuppressionId } from './email/suppression-key';

/** Read before any transaction writes. Single-field queries need no new index. */
async function readCommunityContacts(tx: FirebaseFirestore.Transaction, tenantId: string, uid: string, email: unknown) {
  const tenant = adminDb.collection('tenants').doc(tenantId);
  const contacts = await tx.get(adminDb.collection('contacts').where('tenantId', '==', tenantId));
  const address = typeof email === 'string' ? normalizeEmail(email) : '';
  const linked = contacts.docs.filter(doc => doc.data().communityUserId === uid || doc.data().userId === uid);
  const emails = new Set(linked.map(doc => doc.data().email).filter((value): value is string => typeof value === 'string').map(normalizeEmail).filter(Boolean));
  if (address) emails.add(address);
  const blocks = await Promise.all([...emails].map(email => tx.get(tenant.collection('emailSuppressions').doc(communitySuppressionId(email)))));
  return { tenant, blocks, contacts: contacts.docs.filter(doc => linked.includes(doc) ||
    (typeof doc.data().email === 'string' && emails.has(normalizeEmail(doc.data().email)))), emails };
}

export async function readCommunityDeparture(tx: FirebaseFirestore.Transaction, tenantId: string, uid: string, email: unknown) {
  const contacts = await readCommunityContacts(tx, tenantId, uid, email);
  const channels = await tx.get(contacts.tenant.collection('channels').where('members', 'array-contains', uid));
  return { ...contacts, channels: channels.docs };
}

/** Fresh v2 consent clears only community departure blocks, and only the
 * rejoining user's OWN verified address and OWN linked contacts: a contact's
 * `email`/`userId` is admin-editable CRM data, so matching rejoin unblocks
 * against it would let a rejoining member clear a stranger's opt-out just by
 * having an admin point a contact at that stranger's address first.
 */
export async function readCommunityRejoin(tx: FirebaseFirestore.Transaction, tenantId: string, uid: string, email: string | undefined) {
  const tenant = adminDb.collection('tenants').doc(tenantId);
  const address = typeof email === 'string' ? normalizeEmail(email) : '';
  const [contacts, block] = await Promise.all([
    tx.get(adminDb.collection('contacts').where('tenantId', '==', tenantId)),
    address ? tx.get(tenant.collection('emailSuppressions').doc(communitySuppressionId(address))) : Promise.resolve(null),
  ]);
  return { tenant, address, block, contacts: contacts.docs.filter(doc => doc.data().communityUserId === uid) };
}

export function writeCommunityRejoin(tx: FirebaseFirestore.Transaction, rejoin: Awaited<ReturnType<typeof readCommunityRejoin>>) {
  const cleared = !!rejoin.block?.exists && rejoin.block.data()?.from === 'community-leave';
  if (cleared) tx.delete(rejoin.block!.ref);
  for (const contact of rejoin.contacts) {
    const data = contact.data();
    const patch = {
      communityStatus: 'active', communityLeftAt: null,
      // Joining permits owner contact; newsletter subscription still needs its own opt-in.
      ...(cleared && typeof data.email === 'string' && normalizeEmail(data.email) === rejoin.address && data.emailStatus === 'unsubscribed'
        ? { emailStatus: 'none', emailUnsubscribedAt: FieldValue.delete() } : {}),
    };
    tx.update(contact.ref, patch);
  }
}

/** Leave and suppression commit together, even if the later CRM repair fails.
 * The server-only hash also blocks duplicates and later re-imports until fresh join consent.
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
    const emailHash = communitySuppressionId(email);
    const previous = departure.blocks.find(doc => doc.id === emailHash)?.data();
    const record = previous && previous.from !== 'community-leave'
      ? { ...previous, emailHash }
      : { emailHash, status: 'unsubscribed', at: at.toDate().toISOString(), from: 'community-leave' };
    delete (record as Record<string, unknown>).email;
    tx.set(departure.tenant.collection('emailSuppressions').doc(emailHash), record);
  }
}

/** All owner-directed individual/bulk email must consult the same opt-out as
 * newsletter sends. Read failures throw before a provider is called.
 */
export async function tenantAddressSuppressed(tenantId: string, email: string): Promise<boolean> {
  const record = await adminDb.collection('tenants').doc(tenantId).collection('emailSuppressions').doc(communitySuppressionId(email)).get();
  if (record.exists) await scrubSuppressionEmail(record);
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
export async function tenantBlockedEmailHashes(tenantId: string): Promise<ReadonlySet<string>> {
  const [contacts, suppressions] = await Promise.all([
    adminDb.collection('contacts').where('tenantId', '==', tenantId).get(),
    adminDb.collection('tenants').doc(tenantId).collection('emailSuppressions').get(),
  ]);
  await Promise.all(suppressions.docs.map(scrubSuppressionEmail));
  return new Set([...suppressions.docs.map(doc => doc.id), ...contacts.docs
    .filter(doc => doc.data().communityStatus === 'left')
    .map(doc => doc.data().email).filter((email): email is string => typeof email === 'string').map(communitySuppressionId)]);
}

/** Legacy newsletter and community records already used SHA-256 document IDs.
 * Keep those keys readable and remove their old plaintext on access. Updating
 * only these fields preserves concurrent feedback; a failed scrub withholds send.
 */
export async function scrubSuppressionEmail(record: FirebaseFirestore.DocumentSnapshot) {
  if (Object.prototype.hasOwnProperty.call(record.data(), 'email')) {
    await record.ref.update({ email: FieldValue.delete(), emailHash: record.id });
  }
}
