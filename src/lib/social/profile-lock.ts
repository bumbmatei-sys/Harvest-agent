import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { tenantPrivateRef } from '@/lib/tenant-private';

/** A claim older than this can be taken over. A live claim cannot. */
const CLAIM_TTL_MS = 30_000;

export type ProfileReservation =
  | { readonly status: 'ready'; readonly profileId: string }
  | { readonly status: 'create'; readonly claim: string; readonly profileName: string }
  | { readonly status: 'busy' };

/**
 * One Zernio profile per ministry.
 *
 * The transaction either returns the id already stored, or writes a claim
 * the other caller will see when Firestore retries it. Only the claim holder
 * may call the provider. The profile name is a random id: the tenant id is
 * not part of it.
 */
export async function reserveZernioProfile(
  tenantId: string,
  now = Date.now(),
): Promise<ProfileReservation> {
  const ref = tenantPrivateRef(tenantId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const existing = data.zernioProfileId;
    if (typeof existing === 'string' && existing.trim()) {
      return { status: 'ready', profileId: existing };
    }
    const claim = data.zernioProfileClaim;
    const claimedAt = typeof data.zernioProfileClaimedAt === 'number' ? data.zernioProfileClaimedAt : 0;
    if (typeof claim === 'string' && claim && now - claimedAt < CLAIM_TTL_MS) {
      return { status: 'busy' };
    }
    const nextClaim = randomUUID();
    const profileName = randomUUID();
    tx.set(ref, {
      zernioProfileClaim: nextClaim,
      zernioProfileClaimedAt: now,
      zernioProfileName: profileName,
    }, { merge: true });
    return { status: 'create', claim: nextClaim, profileName };
  });
}

/** Store the provider id if this claim still holds it. Returns the id that won. */
export async function commitZernioProfile(
  tenantId: string,
  claim: string,
  profileId: string,
): Promise<string | null> {
  const ref = tenantPrivateRef(tenantId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    if (typeof data.zernioProfileId === 'string' && data.zernioProfileId.trim()) {
      return data.zernioProfileId;
    }
    if (data.zernioProfileClaim !== claim) return null;
    tx.set(ref, {
      zernioProfileId: profileId,
      zernioProfileClaim: null,
      zernioProfileClaimedAt: null,
    }, { merge: true });
    return profileId;
  });
}

/** Drop a claim whose provider call failed, so the next request can try. */
export async function releaseZernioProfileClaim(tenantId: string, claim: string): Promise<void> {
  const ref = tenantPrivateRef(tenantId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    if (typeof data.zernioProfileId === 'string' && data.zernioProfileId.trim()) return;
    if (data.zernioProfileClaim !== claim) return;
    tx.set(ref, { zernioProfileClaim: null, zernioProfileClaimedAt: null }, { merge: true });
  });
}
