import { adminAuth, adminDb } from './firebase-admin';

/**
 * Set custom claims on a Firebase Auth user for Firestore security rules.
 * Claims: { tenantId, admin, superAdmin }
 * 
 * Call this after:
 * - User registration (sets tenantId)
 * - Role change in admin panel (sets admin/superAdmin)
 * - Tenant assignment change
 */
export async function setCustomClaims(uid: string) {
  try {
    // Fetch user doc to get current role and tenantId
    const userDoc = await adminDb.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      console.error(`setCustomClaims: user doc not found for uid=${uid}`);
      return;
    }

    const userData = userDoc.data()!;
    const role = userData.role || 'user';
    const tenantId = userData.tenantId || null;

    const claims: Record<string, any> = {};

    // Set tenantId if user belongs to a tenant
    if (tenantId) {
      claims.tenantId = tenantId;
    }

    // Set admin claims based on role
    if (role === 'super_admin') {
      claims.admin = true;
      claims.superAdmin = true;
    } else if (role === 'admin') {
      claims.admin = true;
    }

    // Get existing claims to avoid unnecessary token revocation
    const existingUser = await adminAuth.getUser(uid);
    const existingClaims = existingUser.customClaims || {};

    // Only update if claims actually changed — check ALL claim keys, not just new ones
    const allKeys = ['tenantId', 'admin', 'superAdmin'];
    const normalizedExisting = Object.fromEntries(allKeys.map(k => [k, existingClaims[k] ?? undefined]));
    const normalizedNew = Object.fromEntries(allKeys.map(k => [k, claims[k] ?? undefined]));
    const claimsChanged = JSON.stringify(normalizedNew) !== JSON.stringify(normalizedExisting);

    if (claimsChanged) {
      await adminAuth.setCustomUserClaims(uid, claims);
      console.log(`Custom claims set for ${uid}:`, claims);
    }
  } catch (error) {
    console.error(`Failed to set custom claims for ${uid}:`, error);
  }
}

/**
 * Bulk set claims for all users in a tenant.
 * Useful when tenant admin role changes or tenant is created.
 */
export async function setClaimsForTenant(tenantId: string) {
  try {
    const usersSnap = await adminDb.collection('users')
      .where('tenantId', '==', tenantId)
      .get();

    // Batch in chunks of 10 to avoid overwhelming Firebase Admin SDK
    const BATCH_SIZE = 10;
    const docs = usersSnap.docs;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const chunk = docs.slice(i, i + BATCH_SIZE);
      await Promise.all(chunk.map(doc => setCustomClaims(doc.id)));
    }
    console.log(`Claims updated for ${usersSnap.size} users in tenant ${tenantId}`);
  } catch (error) {
    console.error(`Failed to set claims for tenant ${tenantId}:`, error);
  }
}

/**
 * Remove tenant claims when user is removed from tenant.
 */
export async function removeTenantClaims(uid: string) {
  try {
    const existingUser = await adminAuth.getUser(uid);
    const claims = { ...existingUser.customClaims };
    delete claims.tenantId;
    delete claims.admin;
    delete claims.superAdmin;
    await adminAuth.setCustomUserClaims(uid, claims);
    console.log(`Tenant claims removed for ${uid}`);
  } catch (error) {
    console.error(`Failed to remove tenant claims for ${uid}:`, error);
  }
}
