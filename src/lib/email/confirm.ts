import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Preview-then-confirm for a send or a schedule, the same contract as the blog
 * (#531): a preview issues a single-use token, valid ten minutes, bound to the
 * action, ministry, user, broadcast and a hash of exactly what will go out.
 * A confirm without a matching token does not send.
 */

export const EMAIL_CONFIRM_TTL_MS = 10 * 60 * 1000;

export type EmailConfirmAction = 'send' | 'schedule';

export interface EmailConfirmBinding {
  readonly action: EmailConfirmAction;
  readonly tenantId: string;
  readonly uid: string;
  readonly broadcastId: string;
  readonly payloadHash: string;
}

export interface EmailConfirmRecord extends EmailConfirmBinding {
  readonly expiresAt: number;
  readonly consumed: boolean;
}

export type ConsumeDecision = 'ok' | 'missing' | 'expired' | 'reused' | 'mismatch';

export interface EmailConfirmLedger {
  issue(binding: EmailConfirmBinding, nowMs: number): Promise<string>;
  consume(token: string, binding: EmailConfirmBinding, nowMs: number): Promise<ConsumeDecision>;
  /** Deletes tokens past their expiry, used or not. Returns how many went. */
  purgeExpired(nowMs: number): Promise<number>;
}

export interface EmailPayloadFacts {
  readonly subject: string;
  readonly subjectB: string | null;
  readonly preheader: string;
  readonly bodyHtml: string;
  readonly filters: readonly { kind: string; value: string }[];
  readonly at: string | null;
  readonly recipientCount: number;
}

export function hashEmailPayload(facts: EmailPayloadFacts): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

export function decideConsume(
  record: EmailConfirmRecord | null,
  binding: EmailConfirmBinding,
  nowMs: number,
): ConsumeDecision {
  if (!record) return 'missing';
  if (record.expiresAt <= nowMs) return 'expired';
  if (record.consumed) return 'reused';
  if (
    record.action !== binding.action
    || record.tenantId !== binding.tenantId
    || record.uid !== binding.uid
    || record.broadcastId !== binding.broadcastId
    || record.payloadHash !== binding.payloadHash
  ) return 'mismatch';
  return 'ok';
}

export function memoryEmailLedger(): EmailConfirmLedger & { readonly records: Map<string, EmailConfirmRecord> } {
  const records = new Map<string, EmailConfirmRecord>();
  return {
    records,
    async issue(binding, nowMs) {
      const id = crypto.randomUUID();
      records.set(id, { ...binding, expiresAt: nowMs + EMAIL_CONFIRM_TTL_MS, consumed: false });
      return id;
    },
    async consume(token, binding, nowMs) {
      const record = records.get(token) ?? null;
      const decision = decideConsume(record, binding, nowMs);
      if (decision === 'ok' && record) records.set(token, { ...record, consumed: true });
      return decision;
    },
    async purgeExpired(nowMs) {
      let removed = 0;
      for (const [id, record] of records) {
        if (record.expiresAt <= nowMs) { records.delete(id); removed += 1; }
      }
      return removed;
    },
  };
}
