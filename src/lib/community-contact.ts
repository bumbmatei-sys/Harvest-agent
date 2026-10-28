import 'server-only';

/**
 * Chunk (c) integration point. Implement an idempotent CRM upsert here.
 * Called after the membership transaction, including active-join retries, so a
 * failed future upsert can be retried without changing membership timestamps.
 * No contact is written in chunk (a).
 */
export async function upsertCommunityContact(_input: { uid: string; tenantId: string }): Promise<void> {
  // Intentionally reserved for chunk (c).
}
