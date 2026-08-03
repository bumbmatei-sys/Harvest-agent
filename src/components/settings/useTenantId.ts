import { auth, db } from '../../firebase';
import { doc, getDoc } from 'firebase/firestore';

let _cachedTenantId: string | null | undefined = undefined;
let _cachedUid: string | null = null;

export async function getTenantId(): Promise<string | null> {
  if (!auth.currentUser) return null;
  if (_cachedTenantId !== undefined && _cachedUid === auth.currentUser.uid) return _cachedTenantId;
  try {
    const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
    if (userDoc.exists()) {
      // Via a typed local: the cache slot is `string | null | undefined`
      // (undefined = "not yet loaded"), which is wider than what this function
      // returns. Assigning through `tenantId` keeps the return type honest.
      const tenantId: string | null = userDoc.data().tenantId || null;
      _cachedTenantId = tenantId;
      _cachedUid = auth.currentUser.uid;
      return tenantId;
    }
  } catch (e) {
    console.error('Failed to get tenantId:', e);
  }
  _cachedTenantId = null;
  _cachedUid = auth.currentUser?.uid || null;
  return null;
}
