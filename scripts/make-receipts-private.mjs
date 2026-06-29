/**
 * One-time cleanup: revoke public access on financial PDFs that were made public
 * before the security fix (annual tax receipts, giving statements, subscription
 * invoices). Removing makePublic() in the app stops NEW files from being public;
 * files already made public stay public until their ACL is revoked here.
 *
 * Dry run (default):  node scripts/make-receipts-private.mjs
 * Apply:              node scripts/make-receipts-private.mjs --commit
 *
 * Credentials (keep the key OUTSIDE the repo, referenced by env var only):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/make-receipts-private.mjs
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/make-receipts-private.mjs
 *
 * Bucket: defaults to the bucket the app/functions write to (harvest-receipts-233a1).
 * Override with RECEIPTS_BUCKET if needed.
 *
 * CAUTION: --commit calls makePrivate() on live production files. Run the dry run
 * first, confirm the count, then re-run with --commit.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const COMMIT = process.argv.includes('--commit');
const BUCKET = process.env.RECEIPTS_BUCKET || 'harvest-receipts-233a1';

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) {
    return cert(JSON.parse(raw));
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC.
  return applicationDefault();
}

initializeApp({ credential: loadCredential(), storageBucket: BUCKET });
const bucket = getStorage().bucket(BUCKET);

const prefixes = ['receipts/', 'tenants/']; // tenants/ covers invoices + annual-receipts

let scanned = 0, madePrivate = 0, failed = 0;
for (const prefix of prefixes) {
  const [files] = await bucket.getFiles({ prefix });
  for (const f of files) {
    if (!f.name.endsWith('.pdf')) continue;
    scanned++;
    if (COMMIT) {
      // Count successes and failures separately — for a one-time security
      // remediation the operator needs to know what was NOT revoked.
      try { await f.makePrivate(); madePrivate++; }
      catch (e) { failed++; console.warn(`  failed: ${f.name} — ${e?.message || e}`); }
    }
  }
}
console.log(
  COMMIT
    ? `Bucket ${BUCKET}: scanned ${scanned} PDFs. Made ${madePrivate} private, ${failed} failed.`
    : `Bucket ${BUCKET}: scanned ${scanned} PDFs. DRY RUN — re-run with --commit to apply.`
);
process.exit(failed > 0 ? 1 : 0);
