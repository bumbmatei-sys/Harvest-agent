import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import {
  confirmTokenFields,
  decideConsume,
  type ConfirmBinding,
  type ConfirmLedger,
  type ConfirmRecord,
} from '@/lib/blog/confirm-token';

/** Server-only. Clients have no rule that can read or write this collection. */
export const BLOG_CONFIRM_TOKENS = 'blog_confirm_tokens';

function asRecord(data: Record<string, unknown> | undefined): ConfirmRecord | null {
  if (!data) return null;
  if (typeof data.expiresAt !== 'number' || typeof data.draftHash !== 'string') return null;
  return {
    action: typeof data.action === 'string' ? data.action : '',
    tenantId: typeof data.tenantId === 'string' ? data.tenantId : '',
    uid: typeof data.uid === 'string' ? data.uid : '',
    postId: typeof data.postId === 'string' ? data.postId : '',
    draftHash: data.draftHash,
    expiresAt: data.expiresAt,
    consumed: data.consumed === true,
  };
}

/**
 * Issues a token and spends it inside a transaction so two confirms cannot
 * both observe `consumed: false` and both write.
 *
 * The written row includes `expireAt`, a Firestore timestamp. A TTL policy
 * on `blog_confirm_tokens.expireAt` can delete the row after that instant.
 * The policy is not deployed from this repo. Creating it is a separate
 * founder go, and this module does not call anything that would create it.
 */
export function firestoreConfirmLedger(): ConfirmLedger {
  return {
    async issue(binding: ConfirmBinding, nowMs: number) {
      const id = crypto.randomUUID();
      await adminDb.collection(BLOG_CONFIRM_TOKENS).doc(id).set(confirmTokenFields(binding, nowMs));
      return id;
    },
    async consume(token, binding, nowMs) {
      const ref = adminDb.collection(BLOG_CONFIRM_TOKENS).doc(token);
      return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const decision = decideConsume(
          snap.exists ? asRecord(snap.data() as Record<string, unknown>) : null,
          binding,
          nowMs,
        );
        if (decision === 'ok') tx.update(ref, { consumed: true });
        return decision;
      });
    },
  };
}
