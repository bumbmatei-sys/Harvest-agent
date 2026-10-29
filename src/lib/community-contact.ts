import 'server-only';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { normaliseSource } from './community-membership';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const emailKey = (value: unknown) => text(value).toLowerCase();

/**
 * Only the consented name/email cross into CRM. Scan this tenant's complete
 * contact set in the transaction: old email fields are not normalised, and a
 * compound query would need an index that this repo cannot deploy.
 * Prefer an existing UID link, then the lexically first normalised-email match.
 * Preserve its owner-entered fields. Never merge/delete pre-existing duplicates.
 * The deterministic fallback and transactional query make concurrent retries safe.
 */
export async function upsertCommunityContact({ uid, tenantId }: { uid: string; tenantId: string }): Promise<void> {
  const contacts = adminDb.collection('contacts');
  const id = `community_${tenantId}_${createHash('sha256').update(uid).digest('hex')}`;
  await adminDb.runTransaction(async tx => {
    const [memberDoc, profileDoc, rows] = await Promise.all([
      tx.get(adminDb.collection('tenants').doc(tenantId).collection('communityMembers').doc(uid)),
      tx.get(adminDb.collection('users').doc(uid)),
      tx.get(contacts.where('tenantId', '==', tenantId)),
    ]);
    const member = memberDoc.data();
    // Legacy membership has no sharing consent. Do not fabricate it on retries
    // or leave. The next explicit rejoin records consent through the join API.
    if (!member) return;
    if (member.dataDeletedAt) return;
    if (!member.consentAt) {
      if (member.source !== undefined || member.joinedAt !== undefined) throw new Error('Missing community sharing consent.');
      return;
    }
    if (!['active', 'left'].includes(member.status) || !member.joinedAt ||
        (member.status === 'left' && !member.leftAt)) throw new Error('Invalid community contact membership.');
    const source = normaliseSource(member.source);
    const sorted = [...rows.docs].sort((a, b) => a.id.localeCompare(b.id));
    const linked = sorted.find(doc => doc.data().communityUserId === uid || doc.id === id);
    const profile = profileDoc.data();
    let name = text(profile?.name) || text(profile?.displayName);
    let email = emailKey(profile?.email);
    if (!linked && (!name || !email)) {
      const account = await adminAuth.getUser(uid);
      name ||= text(account.displayName);
      email ||= emailKey(account.email);
    }
    const existing = linked || (email ? sorted.find(doc => emailKey(doc.data().email) === email) : undefined);
    if (!existing && (!name || !email)) throw new Error('A name and email are required to share a community contact.');
    if (existing?.data().communityUserId && existing.data().communityUserId !== uid) {
      throw new Error('This email is already linked to another community member.');
    }
    const ref = existing?.ref || contacts.doc(id);
    // Re-read the deterministic destination even when it was outside the tenant
    // query: a malformed/foreign row must never be overwritten across tenants.
    const destination = await tx.get(ref);
    if (destination.exists && destination.data()?.tenantId !== tenantId) throw new Error('Contact tenant mismatch.');
    const now = Timestamp.now();
    const metadata = {
      // Never invent scope/version for a historical timestamp-only consent.
      ...(member.consentScope !== undefined ? { consentScope: member.consentScope } : {}),
      ...(member.consentVersion !== undefined ? { consentVersion: member.consentVersion } : {}),
      consentAt: member.consentAt,
      ...(member.status === 'left' ? { emailStatus: 'unsubscribed' } : {}),
      source: 'community', communityUserId: uid, communitySource: source,
      communityStatus: member.status, communityJoinedAt: member.joinedAt,
      communityLeftAt: member.status === 'left' ? member.leftAt : null,
    };
    if (destination.exists) {
      tx.set(ref, metadata, { merge: true });
    } else {
      const [firstName, ...rest] = name.split(/\s+/);
      tx.set(ref, {
        tenantId, name, firstName, lastName: rest.join(' '), email,
        userId: uid, phone: '', type: 'member', notes: '', tags: [],
        totalDonated: 0, lastDonationAt: null, memberSince: member.joinedAt,
        createdAt: now, updatedAt: now, createdBy: uid, ...metadata,
      });
    }
  });
}
