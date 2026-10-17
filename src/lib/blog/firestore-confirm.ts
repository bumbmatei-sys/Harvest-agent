import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import {
  CONFIRM_TOKEN_TTL_MS,
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
 */
export function firestoreConfirmLedger(): ConfirmLedger {
  return {
    async issue(binding: ConfirmBinding, nowMs: number) {
      const id = crypto.randomUUID();
      await adminDb.collection(BLOG_CONFIRM_TOKENS).doc(id).set({
        action: binding.action,
        tenantId: binding.tenantId,
        uid: binding.uid,
        postId: binding.postId,
        draftHash: binding.draftHash,
        expiresAt: nowMs + CONFIRM_TOKEN_TTL_MS,
        consumed: false,
      });
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
