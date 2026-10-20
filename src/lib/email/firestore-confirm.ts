import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import {
  EMAIL_CONFIRM_TTL_MS,
  decideConsume,
  type EmailConfirmBinding,
  type EmailConfirmLedger,
  type EmailConfirmRecord,
} from '@/lib/email/confirm';

/** Server-only. No client rule reads or writes this collection. */
export const EMAIL_CONFIRM_TOKENS = 'email_confirm_tokens';

export function firestoreEmailLedger(): EmailConfirmLedger {
  return {
    async issue(binding, nowMs) {
      const id = crypto.randomUUID();
      const expiresAt = nowMs + EMAIL_CONFIRM_TTL_MS;
      await adminDb.collection(EMAIL_CONFIRM_TOKENS).doc(id).set({ ...binding, expiresAt, expireAt: new Date(expiresAt), consumed: false });
      return id;
    },
    async consume(token, binding: EmailConfirmBinding, nowMs) {
      const ref = adminDb.collection(EMAIL_CONFIRM_TOKENS).doc(token);
      return adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? (snap.data() as EmailConfirmRecord) : null;
        const decision = decideConsume(data, binding, nowMs);
        if (decision === 'ok') tx.update(ref, { consumed: true });
        return decision;
      });
    },
  };
}
