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
    // THE-218 — the PLAN ID 'max', not the display name 'Ministry'.
    //
    // 🔴 This field is a `TenantPlan` id: 'free' | 'plus' | 'pro' | 'max'
    // (src/types/tenant.types.ts). 'ministry' is what the `max` tier is CALLED
    // on the pricing screen (PLAN_DISPLAY_NAMES), and writing the label where
    // the id belongs produced a value no lookup recognises. Every resolver then
    // fell through to its unknown-plan default, which is INDIVIDUAL — the most
    // restrictive paid tier — so Harvest's own tenant ran on the caps and
    // features of a $49 church:
    //
    //   getPlanFeatures('ministry') -> PLAN_FEATURES.plus   (plan-features.ts)
    //   getPlanLimits('ministry')   -> PLAN_LIMITS.plus     (planLimits.ts)
    //   toTenantPlan('ministry')    -> 'plus'               (plan-features.ts)
    //
    // ⚠️ FIXED AT THE SEED, NOT AT READ TIME. A special case teaching one
    // resolver that 'ministry' means 'max' would leave the other two wrong and
    // add a cell nothing else honours — the defect `plan-features.ts` records
    // three deleted cells for. The seed is the only writer of this field on the
    // platform tenant, so correcting it here corrects every reader at once.
    //
    // 🔴 THIS SCRIPT MUST BE RE-RUN for the fix to reach production: the live
    // `tenants/harvest` document still holds 'ministry' until the "Seed Platform
    // Tenant" workflow (workflow_dispatch) is dispatched again. It is
    // idempotent and merges, so re-running is safe.
    plan: 'max',
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
