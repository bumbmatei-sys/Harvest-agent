import 'server-only';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { normaliseSource } from './community-membership';
import { DEFAULT_COMMUNITY_ID } from './community/communities';

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
/**
 * One CRM across every community of the ministry (#573). The contact carries a
 * `communities` map keyed by community id ('default' for the ministry's own),
 * each entry its name, status and dates, so one person in three communities is
 * one contact with three entries. The flat community* fields stay for the
 * default community, which the existing badge and rules read.
 */
export async function upsertCommunityContact({ uid, tenantId, communityId = DEFAULT_COMMUNITY_ID }: { uid: string; tenantId: string; communityId?: string }): Promise<void> {
  const contacts = adminDb.collection('contacts');
  const id = `community_${tenantId}_${createHash('sha256').update(uid).digest('hex')}`;
  const isDefault = communityId === DEFAULT_COMMUNITY_ID;
  const tenantRef = adminDb.collection('tenants').doc(tenantId);
  await adminDb.runTransaction(async tx => {
    const [memberDoc, profileDoc, rows, tenantDoc, communityDoc] = await Promise.all([
      tx.get(isDefault ? tenantRef.collection('communityMembers').doc(uid) : tenantRef.collection('communities').doc(communityId).collection('members').doc(uid)),
      tx.get(adminDb.collection('users').doc(uid)),
      tx.get(contacts.where('tenantId', '==', tenantId)),
      tx.get(tenantRef),
      tx.get(isDefault ? tenantRef : tenantRef.collection('communities').doc(communityId)),
    ]);
    const member = memberDoc.data();
    const communityName = text((isDefault ? tenantDoc : communityDoc).data()?.name) || 'Community';
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
    const source = isDefault ? normaliseSource(member.source) : null;
    const sorted = [...rows.docs].sort((a, b) => a.id.localeCompare(b.id));
    const linked = sorted.find(doc => doc.data().communityUserId === uid || doc.id === id);
    const profile = profileDoc.data();
    let name = text(profile?.name) || text(profile?.displayName);
    let email = emailKey(profile?.email);
    let account: Awaited<ReturnType<typeof adminAuth.getUser>> | undefined;
    if (!linked && (!name || !email)) {
      account = await adminAuth.getUser(uid);
      name ||= text(account.displayName);
      email ||= emailKey(account.email);
    }
    let emailMatch = !linked && email ? sorted.find(doc => emailKey(doc.data().email) === email) : undefined;
    if (emailMatch) {
      // An existing contact can hold gifts, notes and history, and the link is
      // permanent. Bind it only to an account that has proved it owns the
      // address; anyone else gets a contact of their own.
      account ??= await adminAuth.getUser(uid);
      if (account.emailVerified !== true || emailKey(account.email) !== email) emailMatch = undefined;
    }
    const existing = linked || emailMatch;
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
    const saved = destination.exists ? destination.data()! : {};
    const communities = {
      ...(saved.communities && typeof saved.communities === 'object' ? saved.communities : {}),
      [communityId]: { name: communityName, status: member.status, joinedAt: member.joinedAt, leftAt: member.status === 'left' ? member.leftAt : null },
    };
    // Leaving a community never unsubscribes a newsletter subscriber (Matei's
    // decision, #573): the subscription was its own opt-in. Someone who never
    // subscribed only had the join consent, which leaving the default withdraws.
    const unsubscribe = isDefault && member.status === 'left' && saved.emailStatus !== 'subscribed';
    const metadata = {
      // Never invent scope/version for a historical timestamp-only consent.
      ...(member.consentScope !== undefined ? { consentScope: member.consentScope } : {}),
      ...(member.consentVersion !== undefined ? { consentVersion: member.consentVersion } : {}),
      consentAt: member.consentAt,
      ...(unsubscribe ? { emailStatus: 'unsubscribed' } : {}),
      source: 'community', communityUserId: uid, communities,
      ...(isDefault ? {
        communitySource: source,
        communityStatus: member.status, communityJoinedAt: member.joinedAt,
        communityLeftAt: member.status === 'left' ? member.leftAt : null,
      } : {}),
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
