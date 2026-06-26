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

  const snap = await ref.get();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const data = {
    name: 'Harvest',
    subdomain: 'harvest',
    adminEmails: ['bumbmatei@proton.me', 'bumbmatei@zohomail.eu'],
    plan: 'ministry',
    status: 'active',
    updatedAt: now,
  };
  if (!snap.exists) {
    data.createdAt = now;
  }

  await ref.set(data, { merge: true });
  console.log(`tenants/${TENANT_ID} ${snap.exists ? 'updated' : 'created'} successfully.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
