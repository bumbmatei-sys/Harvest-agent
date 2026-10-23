import { collection, documentId, getDocs, limit, orderBy, query, where } from 'firebase/firestore';

import { db } from '@/firebase';

import type { ReadDocs } from './sources';

/**
 * The one place the palette touches Firestore. Client SDK, as the signed-in
 * admin, so firestore.rules answer exactly as they do for the screen that owns
 * each collection.
 *
 * - Ordered by document id: Firestore has no default order, and an unordered
 *   `limit` returns arbitrary rows.
 * - `cap + 1` documents are requested and the extra one is dropped, so
 *   `truncated` is exact rather than a guess at "we got exactly the cap".
 * - No composite index: one equality filter plus `__name__` ordering is served
 *   by the automatic indexes.
 * - A rejected read is thrown, not turned into an empty list. The caller shows
 *   which list could not be searched.
 */
export const readDocsFromFirestore: ReadDocs = async (spec, tenantId) => {
  const base = collection(db, spec.path[0], ...spec.path.slice(1));
  const constraints = spec.byTenantField ? [where('tenantId', '==', tenantId)] : [];
  const snap = await getDocs(query(base, ...constraints, orderBy(documentId()), limit(spec.cap + 1)));
  const docs = snap.docs.slice(0, spec.cap).map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  return { docs, truncated: snap.docs.length > spec.cap };
};
