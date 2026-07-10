import { collection, query, where, getDocs, addDoc, serverTimestamp, limit } from 'firebase/firestore';
import { db } from '../firebase';

export interface DmParticipant {
  uid: string;
  name: string;
  role: string;
}

/**
 * Find an existing 1:1 DM between two tenant members, or create one.
 * Mirrors UserMessages.tsx's original startDm create-or-open logic so every
 * caller (UserMessages, the feed's "Message privately") shares one DM data
 * model instead of re-deriving the participants/participantRoles/participantNames
 * shape — tenants/{tenantId}/directMessages, keyed to tenants/{tenantId}/dmMessages
 * by dmId.
 */
export async function getOrCreateDm(
  tenantId: string,
  currentUser: DmParticipant,
  otherUser: DmParticipant
): Promise<string> {
  const q = query(
    collection(db, 'tenants', tenantId, 'directMessages'),
    where('participants', 'array-contains', currentUser.uid),
    limit(200)
  );
  const snap = await getDocs(q);
  const existing = snap.docs.find(d => (d.data().participants || []).includes(otherUser.uid));
  if (existing) return existing.id;

  const ref = await addDoc(collection(db, 'tenants', tenantId, 'directMessages'), {
    participants: [currentUser.uid, otherUser.uid],
    participantRoles: { [currentUser.uid]: currentUser.role, [otherUser.uid]: otherUser.role },
    participantNames: { [currentUser.uid]: currentUser.name, [otherUser.uid]: otherUser.name },
    createdAt: serverTimestamp(),
    lastMessage: '',
    lastMessageAt: serverTimestamp(),
    initiatedBy: currentUser.uid,
  });
  return ref.id;
}
