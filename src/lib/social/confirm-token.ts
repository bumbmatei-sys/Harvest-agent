import 'server-only';

import { createHash, randomUUID } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { firebaseAdminCredentialsAvailable } from '@/lib/firebase-admin-credentials';
import { socialMode } from './mode';
import type { SocialPost, SocialPostDraft } from './types';

/** Long enough to read the preview, short enough that a leaked token dies. */
export const CONFIRM_TOKEN_TTL_MS = 10 * 60 * 1000;

const COLLECTION = 'social_confirm_tokens';

export type ConfirmAction = 'schedule' | 'publish' | 'update' | 'cancel';

export interface ConfirmBinding {
  readonly action: ConfirmAction;
  readonly tenantId: string;
  readonly uid: string;
  readonly postId: string | null;
  readonly draftHash: string;
}

export type ConfirmGate = 'ok' | 'missing' | 'mismatch' | 'expired' | 'reused';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stable(record[key]);
      return acc;
    }, {});
  }
  return value;
}

/** Hash of the post that will be written or deleted. Order of keys does not matter. */
export function hashSocialDraft(draft: Pick<SocialPostDraft, 'content' | 'scheduledFor' | 'publishNow' | 'timezone' | 'targets' | 'media'>): string {
  const targets = [...draft.targets]
    .map((target) => ({
      platform: target.platform,
      accountId: target.accountId,
      text: target.text,
      fields: target.fields,
      madeWithAi: target.madeWithAi,
    }))
    .sort((left, right) => left.platform.localeCompare(right.platform) || left.accountId.localeCompare(right.accountId));
  const normalized = stable({
    content: draft.content,
    scheduledFor: draft.scheduledFor,
    publishNow: draft.publishNow,
    timezone: draft.timezone,
    targets,
    media: draft.media,
  });
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function hashCancelledPost(post: SocialPost): string {
  return hashSocialDraft({
    content: post.content,
    scheduledFor: post.scheduledFor,
    publishNow: false,
    timezone: post.timezone,
    targets: post.targets,
    media: post.media,
  });
}

function sameBinding(stored: Record<string, unknown>, binding: ConfirmBinding): boolean {
  return stored.action === binding.action
    && stored.tenantId === binding.tenantId
    && stored.uid === binding.uid
    && (typeof stored.postId === 'string' ? stored.postId : null) === binding.postId
    && stored.draftHash === binding.draftHash;
}

interface StoredToken {
  action: ConfirmAction;
  tenantId: string;
  uid: string;
  postId: string | null;
  draftHash: string;
  expiresAt: number;
  consumed: boolean;
}

/**
 * Preview has no Firebase Admin credentials, so a Firestore write would 503
 * and the sample ministry could never confirm. The memory map is only for
 * that mock. Production still writes `social_confirm_tokens`.
 */
const memoryTokens = new Map<string, StoredToken>();

function memoryStore(): boolean {
  return socialMode() === 'mock' && !firebaseAdminCredentialsAvailable();
}

function record(binding: ConfirmBinding, now: number): StoredToken {
  return {
    action: binding.action,
    tenantId: binding.tenantId,
    uid: binding.uid,
    postId: binding.postId,
    draftHash: binding.draftHash,
    expiresAt: now + CONFIRM_TOKEN_TTL_MS,
    consumed: false,
  };
}

function gateFor(data: Record<string, unknown> | StoredToken | undefined, binding: ConfirmBinding, now: number): ConfirmGate | 'spend' {
  if (!data) return 'missing';
  const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : 0;
  if (expiresAt <= now) return 'expired';
  if (data.consumed === true) return 'reused';
  if (!sameBinding(data as Record<string, unknown>, binding)) return 'mismatch';
  return 'spend';
}

/**
 * Preview writes one token and nothing else. Confirm presents that token.
 * The transaction checks the binding and marks the token consumed, so a
 * second confirm, a different draft, or another person cannot spend it.
 * `expireAt` is a Firestore timestamp for a later TTL policy. This code
 * does not deploy that policy; `expiresAt` is what the check reads.
 */
export async function issueConfirmToken(binding: ConfirmBinding, now = Date.now()): Promise<string | null> {
  const token = randomUUID();
  const stored = record(binding, now);
  if (memoryStore()) {
    memoryTokens.set(token, stored);
    return token;
  }
  try {
    await adminDb.collection(COLLECTION).doc(token).set({
      ...stored,
      expireAt: Timestamp.fromMillis(stored.expiresAt),
    });
    return token;
  } catch (error) {
    console.error('Social scheduling could not store a confirm token', error);
    return null;
  }
}

export async function consumeConfirmToken(
  token: string,
  binding: ConfirmBinding,
  now = Date.now(),
): Promise<ConfirmGate> {
  if (memoryStore()) {
    const current = memoryTokens.get(token);
    const gate = gateFor(current, binding, now);
    if (gate !== 'spend' || !current) return gate === 'spend' ? 'missing' : gate;
    memoryTokens.set(token, { ...current, consumed: true });
    return 'ok';
  }
  const ref = adminDb.collection(COLLECTION).doc(token);
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'missing';
      const data = (snap.data() || {}) as Record<string, unknown>;
      const gate = gateFor(data, binding, now);
      if (gate !== 'spend') return gate;
      tx.update(ref, { consumed: true });
      return 'ok';
    });
  } catch (error) {
    console.error('Social scheduling could not consume a confirm token', error);
    return 'missing';
  }
}
