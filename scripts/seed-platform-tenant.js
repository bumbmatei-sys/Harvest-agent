/**
 * Seed (or update) the platform tenant document `tenants/harvest` using the
 * Firebase Admin SDK. Idempotent: safe to run repeatedly — createdAt is only
 * written when the document does not yet exist; updatedAt is always refreshed.
 *
 * Credentials are read from the FIREBASE_SERVICE_ACCOUNT env var (a JSON string)
 * or, failing that, from application default credentials
 * (GOOGLE_APPLICATION_CREDENTIALS).
 *
 * Run via the "Seed Platform Tenant" GitHub Action (workflow_dispatch), or
 * locally:  FIREBASE_SERVICE_ACCOUNT="$(cat sa.json)" node scripts/seed-platform-tenant.js
 */
const admin = require('firebase-admin');

const TENANT_ID = process.env.PLATFORM_TENANT_ID || 'harvest';

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) {
    return admin.credential.cert(JSON.parse(raw));
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC.
  return admin.credential.applicationDefault();
}

async function main() {
  admin.initializeApp({ credential: loadCredential() });
  const db = admin.firestore();
  const ref = db.collection('tenants').doc(TENANT_ID);
  // Dual-write target: the adminEmails roster also lives on the server-only
  // tenant_private/{id} doc (see src/lib/tenant-private.ts). One batch, so the
  // two locations can't diverge.
  const privateRef = db.collection('tenant_private').doc(TENANT_ID);

  const snap = await ref.get();
  const privateSnap = await privateRef.get();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const adminEmails = ['bumbmatei@proton.me', 'bumbmatei@zohomail.eu'];
  // The roster lives ONLY on the server-only tenant_private doc — never on the
  // world-readable tenants doc.
  const data = {
    name: 'Harvest',
    subdomain: 'harvest',
    // The PLAN ID 'ministry', the top tier Harvest's own tenant is entitled to.
    //
    // History (THE-218): this field once held the DISPLAY NAME 'Ministry' while
    // the id of that tier was 'max', so no lookup recognised it and every resolver
    // fell through to the unknown-plan default, the cheapest paid tier. The
    // repricing renamed the tiers so that the id and the name are the same word:
    // 'ministry' is now the id itself, and the retired 'max' still resolves to it
    // at read time (src/utils/plan-id.ts). Writing the id here means the platform
    // tenant never depends on that alias.
    //
    // 🔴 THIS SCRIPT MUST BE RE-RUN to rewrite the stored value: the live
    // `tenants/harvest` document is untouched by a merge. Until the "Seed Platform
    // Tenant" workflow (workflow_dispatch) is dispatched again it keeps whatever
    // it holds, and both 'max' and 'ministry' already resolve to Ministry. It is
    // idempotent and merges, so re-running is safe.
    plan: 'ministry',
    status: 'active',
    updatedAt: now,
  };
  if (!snap.exists) {
    data.createdAt = now;
  }
  const privateData = { adminEmails, updatedAt: now };
  if (!privateSnap.exists) {
    privateData.createdAt = now;
  }

  const batch = db.batch();
  batch.set(ref, data, { merge: true });
  batch.set(privateRef, privateData, { merge: true });
  await batch.commit();
  console.log(`tenants/${TENANT_ID} ${snap.exists ? 'updated' : 'created'} successfully.`);
  console.log(`tenant_private/${TENANT_ID} ${privateSnap.exists ? 'updated' : 'created'} successfully.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
