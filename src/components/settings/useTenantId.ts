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
      _cachedTenantId = userDoc.data().tenantId || null;
      _cachedUid = auth.currentUser.uid;
      return _cachedTenantId;
    }
  } catch (e) {
    console.error('Failed to get tenantId:', e);
  }
  _cachedTenantId = null;
  _cachedUid = auth.currentUser?.uid || null;
  return null;
}
