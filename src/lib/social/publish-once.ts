import { adminDb } from '@/lib/firebase-admin';
import type { SocialPost } from './types';

const memory = new Map<string, SocialPost>();
const inflight = new Map<string, Promise<SocialPost | null>>();

/** A crashed publish must not pin the key forever. Two minutes covers a live call. */
const PENDING_TTL_MS = 2 * 60 * 1000;

export function resetPublishOnce(): void {
  memory.clear();
  inflight.clear();
}

function scope(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}

/**
 * One provider create per publish key.
 *
 * The map is set before the first await, so two calls in this process share
 * one create. Production also records the post on `social_publish_keys` so a
 * second instance replays it instead of posting again.
 */
export async function oncePublish(
  tenantId: string,
  key: string,
  live: boolean,
  create: () => Promise<SocialPost | null>,
): Promise<SocialPost | null> {
  const id = scope(tenantId, key);
  if (!live) {
    const cached = memory.get(id);
    if (cached) return cached;
    const pending = inflight.get(id);
    if (pending) return pending;
    const run = create().then((post) => {
      inflight.delete(id);
      if (post) memory.set(id, post);
      return post;
    }, (error: unknown) => {
      inflight.delete(id);
      throw error;
    });
    inflight.set(id, run);
    return run;
  }

  const ref = adminDb.collection('social_publish_keys').doc(`${tenantId}_${key}`);
  const gate = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    if (data.post && typeof data.post === 'object') {
      return { kind: 'replay' as const, post: data.post as SocialPost };
    }
    const pendingAt = typeof data.pendingAt === 'number' ? data.pendingAt : 0;
    if (data.pending === true && Date.now() - pendingAt < PENDING_TTL_MS) {
      return { kind: 'pending' as const };
    }
    tx.set(ref, { pending: true, pendingAt: Date.now() }, { merge: true });
    return { kind: 'fresh' as const };
  });
  if (gate.kind === 'replay') return gate.post;
  if (gate.kind === 'pending') return null;

  let post: SocialPost | null;
  try {
    post = await create();
  } catch (error) {
    console.error('Social scheduling publish did not finish', error);
    await ref.set({ pending: false }, { merge: true });
    return null;
  }
  if (!post) {
    await ref.set({ pending: false }, { merge: true });
    return null;
  }
  await ref.set({ pending: false, post }, { merge: true });
  return post;
}
