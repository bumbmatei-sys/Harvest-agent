import { adminDb } from '@/lib/firebase-admin';

export const DIGITAL_URL_TTL_SECONDS = 300;
export const SAFE_DIGITAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export function digitalKeyPrefix(tenantId: string, productId: string): string {
  if (!SAFE_DIGITAL_ID.test(tenantId) || !SAFE_DIGITAL_ID.test(productId)) throw new Error('Invalid product identity');
  return `private/tenants/${tenantId}/digital-products/${productId}/`;
}

export function isDigitalKey(key: unknown, tenantId: string, productId: string): key is string {
  return typeof key === 'string' && key.startsWith(digitalKeyPrefix(tenantId, productId)) && /^[a-f0-9-]+\.pdf$/.test(key.slice(digitalKeyPrefix(tenantId, productId).length));
}

export async function hasDigitalEntitlement(tenantId: string, productId: string, uid: string): Promise<boolean> {
  if (![tenantId, productId, uid].every((id) => SAFE_DIGITAL_ID.test(id))) return false;
  const doc = await adminDb.collection('tenants').doc(tenantId).collection('digitalProducts').doc(productId).collection('entitlements').doc(uid).get();
  return doc.exists && doc.data()?.active === true;
}
