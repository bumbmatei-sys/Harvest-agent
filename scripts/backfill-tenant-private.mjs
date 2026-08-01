/**
 * Backfill + parity verification for the tenant_private/{tenantId} move.
 *
 * BACKGROUND
 * tenants/{id} is world-readable (`allow read: if true` — pre-auth subdomain
 * resolution needs name/subdomain/branding), but it also carried adminEmails
 * (the roster the rules trust for admin access — and a harvestable phishing
 * target list) plus the Stripe identifiers. Those five fields are moving to
 * the server-only tenant_private/{tenantId} doc:
 *   adminEmails, stripeCustomerId, stripeSubscriptionId, stripePriceId,
 *   stripeConnectAccountId
 * (keep in sync with TENANT_PRIVATE_FIELDS in src/lib/tenant-private.ts).
 *
 * WHY THIS SCRIPT GATES THE RULES PR — READ BEFORE MERGING
 * The rules' roster read (inTenantAdminEmails) switches to
 * tenant_private/{id}.adminEmails with a default of [] when the doc/field is
 * missing. That default makes an INCOMPLETE backfill silent: any tenant
 * without its tenant_private doc simply has an empty roster, and every
 * roster-based admin of that tenant loses all access the moment the rules
 * deploy (which happens automatically on merge to main). So:
 *
 * RUN ORDER (IMPORTANT — the rules auto-deploy on merge to main):
 *   1. Merge PR 1 (dual-write) so no new tenant is created without a mirror.
 *   2. Run the DRY RUN, review the counts.
 *   3. Run with --commit. Re-run until "failed: 0".
 *   4. Run with --verify and confirm "MISMATCH: 0, MISSING: 0" for ALL tenants.
 *   5. ONLY THEN merge the rules PR (PR 2). Verification, not the rules'
 *      [] default, is the lockout safety mechanism.
 * Idempotent: writes are field-for-field copies of the public doc; re-runs
 * simply converge. Safe to run any number of times.
 *
 * USAGE
 *   Dry run (default):  node scripts/backfill-tenant-private.mjs
 *   Apply:              node scripts/backfill-tenant-private.mjs --commit
 *   Verify parity:      node scripts/backfill-tenant-private.mjs --verify
 *   Scrub public docs:  node scripts/backfill-tenant-private.mjs --scrub-public [--commit]
 *
 * SCRUB (PR 3, and ONLY after it): --scrub-public DELETES the five moved
 * fields from every world-readable tenants/{id} doc — the step that actually
 * removes the leaked roster from public view. Run it only after the PR that
 * repoints every reader (rules AND server code) to tenant_private is deployed;
 * scrubbing earlier reintroduces the lockout. It refuses to run unless
 * --verify passes first (parity means nothing is lost by deleting).
 *
 * CREDENTIALS (keep the key OUTSIDE the repo, referenced by env var only):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/backfill-tenant-private.mjs
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/backfill-tenant-private.mjs
 *   (Cloud Shell: ADC works out of the box.)
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');
const VERIFY = process.argv.includes('--verify');
const SCRUB = process.argv.includes('--scrub-public');

// Keep in sync with TENANT_PRIVATE_FIELDS in src/lib/tenant-private.ts.
const MOVED_FIELDS = [
  'adminEmails',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'stripePriceId',
  'stripeConnectAccountId',
];

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) return cert(JSON.parse(raw));
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC.
  return applicationDefault();
}

initializeApp({ credential: loadCredential() });
const db = getFirestore();

/** The private-doc payload for one public tenant doc: only fields that exist. */
function privatePayload(tenantData) {
  const out = {};
  for (const f of MOVED_FIELDS) {
    if (tenantData[f] !== undefined) out[f] = tenantData[f];
  }
  return out;
}

/** Deep equality good enough for these fields (arrays of strings + scalars). */
function fieldEqual(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

/** VERIFY as a reusable pass; returns true when every tenant is in parity. */
async function verifyParity(tenantsSnap) {
  let ok = 0;
  const missing = [];
  const mismatches = [];
  for (const doc of tenantsSnap.docs) {
    const tData = doc.data();
    const privSnap = await db.collection('tenant_private').doc(doc.id).get();
    if (!privSnap.exists) {
      if (Object.keys(privatePayload(tData)).length === 0) { ok++; continue; }
      missing.push(doc.id);
      continue;
    }
    const pData = privSnap.data();
    let bad = false;
    for (const f of MOVED_FIELDS) {
      // A field absent from the PUBLIC doc is fine post-scrub — the private doc
      // is authoritative. Parity only requires: every public value matches.
      if (tData[f] !== undefined && !fieldEqual(tData[f], pData[f])) {
        bad = true;
        mismatches.push(`${doc.id}.${f}: public=${JSON.stringify(tData[f])} private=${JSON.stringify(pData[f])}`);
      }
    }
    if (!bad) ok++;
  }
  console.log(`\nVERIFY RESULT: ${ok}/${tenantsSnap.size} tenants in parity.`);
  console.log(`MISSING: ${missing.length}${missing.length ? ' — ' + missing.join(', ') : ''}`);
  console.log(`MISMATCH: ${mismatches.length}`);
  for (const m of mismatches) console.log(`  ${m}`);
  return missing.length === 0 && mismatches.length === 0;
}

async function main() {
  const tenantsSnap = await db.collection('tenants').get();
  console.log(`${tenantsSnap.size} tenant docs found.`);

  if (SCRUB) {
    // ── SCRUB: delete the moved fields from the world-readable docs ─────────
    // Refuses unless parity holds — deleting a public field that never made it
    // to the private doc would destroy the only copy.
    const parityOk = await verifyParity(tenantsSnap);
    if (!parityOk) {
      console.log('\n❌ NOT scrubbing: parity failed. Run --commit, then --verify, then retry.');
      process.exit(1);
    }
    let scrubbed = 0;
    let clean = 0;
    const failed = [];
    for (const doc of tenantsSnap.docs) {
      const tData = doc.data();
      const stale = MOVED_FIELDS.filter((f) => tData[f] !== undefined);
      if (stale.length === 0) { clean++; continue; }
      if (!COMMIT) { scrubbed++; continue; }
      try {
        const deletes = Object.fromEntries(stale.map((f) => [f, FieldValue.delete()]));
        await doc.ref.update({ ...deletes, updatedAt: new Date().toISOString() });
        scrubbed++;
      } catch (err) {
        failed.push(`${doc.id}: ${err?.message || err}`);
      }
    }
    console.log(`\n${COMMIT ? 'SCRUBBED' : 'DRY RUN — would scrub'}: ${scrubbed} tenants`);
    console.log(`already clean: ${clean}`);
    console.log(`failed: ${failed.length}`);
    for (const f of failed) console.log(`  ${f}`);
    if (!COMMIT) console.log('\nRe-run with --scrub-public --commit to apply.');
    process.exit(failed.length ? 1 : 0);
  }

  if (VERIFY) {
    // ── VERIFY: for every tenant, public fields and private doc match exactly ──
    const parityOk = await verifyParity(tenantsSnap);
    if (!parityOk) {
      console.log('\n❌ NOT SAFE to merge the rules PR: an incomplete backfill is silent');
      console.log('   (missing roster ⇒ empty roster ⇒ every roster admin of that tenant locked out).');
      console.log('   Re-run with --commit, then --verify again.');
      process.exit(1);
    }
    console.log('\n✅ Parity verified for every tenant. Safe to merge the rules PR.');
    process.exit(0);
  }

  // ── BACKFILL (dry run unless --commit) ────────────────────────────────────
  let written = 0;
  let skippedEmpty = 0;
  const failed = []; // tenants whose write errored
  for (const doc of tenantsSnap.docs) {
    const payload = privatePayload(doc.data());
    if (Object.keys(payload).length === 0) {
      skippedEmpty++;
      continue; // nothing to protect for this tenant
    }
    if (!COMMIT) {
      written++;
      continue;
    }
    try {
      await db.collection('tenant_private').doc(doc.id)
        .set({ ...payload, updatedAt: new Date().toISOString() }, { merge: true });
      written++;
    } catch (err) {
      failed.push(`${doc.id}: ${err?.message || err}`);
    }
  }
  console.log(`\n${COMMIT ? 'BACKFILLED' : 'DRY RUN — would backfill'}: ${written} tenants`);
  console.log(`skipped (no moved fields present): ${skippedEmpty}`);
  console.log(`failed: ${failed.length}`);
  for (const f of failed) console.log(`  ${f}`);
  if (!COMMIT) console.log('\nRe-run with --commit to apply, then --verify to prove parity.');
  else console.log('\nNow run with --verify — the rules PR must not merge until verify passes.');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
