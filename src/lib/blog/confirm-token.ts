import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Preview-then-confirm for a blog write.
 *
 * A preview issues a token. Confirm presents that same token. The token is
 * single-use, lasts ten minutes, and is bound to the action, the ministry,
 * the signed-in user, the post, and a hash of the normalized payload. A
 * confirm that arrives without that token, or with a token that does not
 * match, does not write.
 *
 * The decision is pure so the Firestore transaction and the in-memory ledger
 * the tests use cannot drift apart. The transaction itself lives in
 * firestore-confirm.ts.
 */

export const CONFIRM_TOKEN_TTL_MS = 10 * 60 * 1000;

export type BlogConfirmAction = 'schedule' | 'publishNow' | 'unschedule' | 'delete';

export interface BlogConfirmPayload {
  readonly action: BlogConfirmAction;
  readonly tenantId: string;
  readonly postId: string;
  readonly title: string;
  readonly category: string;
  readonly content: string;
  readonly featuredImage: string | null;
  readonly tags: readonly string[];
  readonly wallClock: string | null;
  readonly timeZone: string | null;
}

export interface ConfirmBinding {
  readonly action: BlogConfirmAction;
  readonly tenantId: string;
  readonly uid: string;
  readonly postId: string;
  readonly draftHash: string;
}

export interface ConfirmRecord {
  readonly action: string;
  readonly tenantId: string;
  readonly uid: string;
  readonly postId: string;
  readonly draftHash: string;
  readonly expiresAt: number;
  readonly consumed: boolean;
}

export type ConsumeDecision = 'ok' | 'missing' | 'expired' | 'reused' | 'mismatch';

export interface ConfirmLedger {
  issue(binding: ConfirmBinding, nowMs: number): Promise<string>;
  consume(token: string, binding: ConfirmBinding, nowMs: number): Promise<ConsumeDecision>;
}

export function hashBlogPayload(payload: BlogConfirmPayload): string {
  const body = {
    action: payload.action,
    tenantId: payload.tenantId,
    postId: payload.postId,
    title: payload.title,
    category: payload.category,
    content: payload.content,
    featuredImage: payload.featuredImage,
    tags: [...payload.tags].sort(),
    wallClock: payload.wallClock,
    timeZone: payload.timeZone,
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * What a consume must do, given the stored row. `missing` is a row that is
 * not there. Expiry is checked before reuse so a token that has timed out
 * cannot be spent. A mismatch is any of action, ministry, user, post or
 * payload hash.
 */
export function decideConsume(
  record: ConfirmRecord | null,
  binding: ConfirmBinding,
  nowMs: number,
): ConsumeDecision {
  if (!record) return 'missing';
  if (record.expiresAt <= nowMs) return 'expired';
  if (record.consumed) return 'reused';
  if (
    record.action !== binding.action
    || record.tenantId !== binding.tenantId
    || record.uid !== binding.uid
    || record.postId !== binding.postId
    || record.draftHash !== binding.draftHash
  ) {
    return 'mismatch';
  }
  return 'ok';
}

export function memoryConfirmLedger(): ConfirmLedger & { readonly records: Map<string, ConfirmRecord> } {
  const records = new Map<string, ConfirmRecord>();
  return {
    records,
    async issue(binding, nowMs) {
      const id = crypto.randomUUID();
      records.set(id, {
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
      const record = records.get(token) ?? null;
      const decision = decideConsume(record, binding, nowMs);
      if (decision === 'ok' && record) records.set(token, { ...record, consumed: true });
      return decision;
    },
  };
}
