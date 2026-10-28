import { collection, documentId, getDocs, limit, orderBy, query, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';

/** Missing tenantId fields cannot be queried and require a server-side backfill. */
export async function loadScopedUserDocs(tenantId: string, includeNull: boolean, max: number): Promise<QueryDocumentSnapshot[]> {
  const values = includeNull ? [tenantId, null, ''] : [tenantId];
  const snapshots = await Promise.all(values.map(value =>
    getDocs(query(collection(db, 'users'), where('tenantId', '==', value), orderBy(documentId()), limit(max)))
  ));
  return snapshots.flatMap(snapshot => snapshot.docs);
}
