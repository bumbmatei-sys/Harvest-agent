import 'server-only';

import { adminDb } from '@/lib/firebase-admin';

/**
 * Deletes documents whose `field` is at or before `cutoff`, 400 at a time, until
 * none are left or `maxBatches` is reached. Single-field range plus the same
 * field's order, so it needs no composite index.
 */
export async function purgeWhereAtOrBefore(collection: string, field: string, cutoff: number | string | Date, maxBatches = 25): Promise<number> {
  let removed = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const snap = await adminDb.collection(collection).where(field, '<=', cutoff).orderBy(field).limit(400).get();
    if (snap.empty) break;
    const batch = adminDb.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += snap.size;
    if (snap.size < 400) break;
  }
  return removed;
}
