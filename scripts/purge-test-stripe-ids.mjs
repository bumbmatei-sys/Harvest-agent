/**
 * Purge TEST-MODE Stripe IDs from Firestore ahead of go-live (audit §3 / S3).
 *
 * BACKGROUND
 * Stripe test and live modes are completely separate: Connect accounts,
 * customers, subscriptions and transfers created with a TEST key do not exist
 * under a LIVE key. Every Stripe id currently stored in Firestore was written
 * while the app ran on a test key, so at go-live these become live-key API
 * calls against `acct_`/`cus_`/`sub_` ids that don't exist in live mode.
 *
 * The three that cause real failures at go-live (the audit's HIGHs):
 *   - tenants.stripeConnectAccountId        → donations/event payouts (transfer_data.destination)
 *   - users.affiliateStripeAccountId        → affiliate payout destination
 *   - affiliate_commissions (status=pending)→ the daily payout cron
 *       (src/app/api/affiliate/retry-transfers/route.ts) keeps retrying
 *       transfers to a dead test account FOREVER. This is the worst one (S3).
 *
 * WHY WE CANNOT KEY OFF THE ID PREFIX
 * The audit assumes test vs live ids are "distinguishable by prefix". They are
 * NOT for the fields in this schema. `acct_`, `cus_`, `sub_`, `tr_`, `si_` ids
 * are opaque and identical in shape across modes — only KEYS (`sk_test_`/
 * `sk_live_`, `pk_*`, `rk_*`) and Checkout Session ids (`cs_test_`/`cs_live_`)
 * embed the mode, and none of those are stored in these fields. So this script
 * classifies by id SHAPE (is it a well-formed Stripe id of the expected type?)
 * and relies on the PRE-GO-LIVE PREMISE that every stored id is test-mode. As a
 * safety net it hard-SKIPS (never writes) any value that carries a live marker
 * or that doesn't match the expected shape, and reports it for manual review.
 *   ⇒ Before running with --commit, confirm no LIVE Stripe key has ever been
 *     used to write these fields. If one has, STOP — this script can't tell.
 *
 * WHAT IT DOES
 *   tenants / users : deletes the stale id field (and its paired *Status field)
 *                     with FieldValue.delete(). The code reads these with `?.`
 *                     truthiness checks, so an absent field == "not connected".
 *   affiliate_commissions : MARKS pending rows terminal (status → 'cancelled')
 *                     rather than deleting them — see the note below. The stored
 *                     stripeSubscriptionId/stripeTransferId are LEFT as history.
 *
 * DELETE vs. MARK-TERMINAL for affiliate_commissions — why 'cancelled':
 *   The retry cron and the real-time sweep both query ONLY status == 'pending'
 *   (retry-transfers/route.ts:33-36; lib/affiliate-payout.ts:76-83), and the
 *   affiliate earnings view already EXCLUDES status == 'cancelled'
 *   (api/affiliate/status/route.ts:68). So flipping pending → 'cancelled' is a
 *   status the codebase already treats as terminal: it stops every retry path
 *   AND keeps the referral record (referrerId/tenantId/amount) as history, which
 *   deletion would destroy. 'cancelled' is therefore safe and preferred here.
 *
 * OUT OF SCOPE (reported, never mutated — need a human decision):
 *   users.aiAssistantSubscriptionItemId   entitlement pointer; clearing it
 *                                          silently strips a paid AI-assistant.
 *   churches.stripeSubscriptionItemId     a line item on the tenant's parent
 *                                          subscription; drop the pointer and the
 *                                          billable item is orphaned. Use the
 *                                          existing remove-billing route instead.
 *   This script does NOT delete test tenants/users/subscriptions (tenant
 *   deletion already has its own cascade path). It touches Stripe id fields only.
 *
 * USAGE
 *   Dry run (default — NO writes; this output IS the review gate):
 *     node scripts/purge-test-stripe-ids.mjs
 *   Scope to one collection at a time (recommended):
 *     node scripts/purge-test-stripe-ids.mjs --collection=affiliate_commissions
 *     node scripts/purge-test-stripe-ids.mjs --collection=tenants,users
 *   Apply, after reviewing the dry run:
 *     node scripts/purge-test-stripe-ids.mjs --collection=tenants --commit
 *
 * CREDENTIALS (keep any key OUTSIDE the repo, referenced by env var only):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/purge-test-stripe-ids.mjs
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/purge-test-stripe-ids.mjs
 *   — or — run inside Firebase Cloud Shell with Application Default Credentials.
 *
 * CAUTION: --commit permanently clears fields / cancels commissions. Always run
 * the dry run first, paste it for review, and scope with --collection=.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');

function argValue(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null; // strip "--<name>="
}

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) return cert(JSON.parse(raw));
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC (Cloud Shell, no key file).
  return applicationDefault();
}

// Collections whose Stripe id fields are cleared with FieldValue.delete().
// `pairedStatus` is deleted alongside the id so the record fully resets to
// "not connected" (leaving e.g. stripeConnectStatus:'active' with no account id
// would be an inconsistent state the UI/onboard routes could misread).
const CLEAR_TARGETS = {
  tenants: [
    { field: 'stripeConnectAccountId', shape: /^acct_/, label: 'Connect account (acct_)', pairedStatus: 'stripeConnectStatus' },
    { field: 'stripeCustomerId', shape: /^cus_/, label: 'customer (cus_)' },
    { field: 'stripeSubscriptionId', shape: /^sub_/, label: 'subscription (sub_)' },
  ],
  users: [
    { field: 'affiliateStripeAccountId', shape: /^acct_/, label: 'affiliate Connect account (acct_)', pairedStatus: 'affiliateConnectStatus' },
  ],
};

// Fields we deliberately do NOT automate; surfaced in the report so the reviewer
// sees the full inventory. { collection: [{ field, why }] }
const REPORT_ONLY = {
  users: [{ field: 'aiAssistantSubscriptionItemId', why: 'entitlement pointer — clearing strips a paid AI-assistant; needs owner decision' }],
  churches: [{ field: 'stripeSubscriptionItemId', why: 'line item on the parent subscription — use the remove-billing route, do not blind-clear' }],
};

const ALL_COLLECTIONS = ['tenants', 'users', 'affiliate_commissions'];

// A value we must never touch: it carries an explicit live-mode marker. Rare for
// the opaque ids here, but it's the safe asymmetry — skip anything live-looking.
const looksLive = (s) => /_live_/.test(s) || /^(sk|pk|rk)_live/.test(s) || /^cs_live_/.test(s);

function classify(value, shape) {
  if (value == null || value === '') return { kind: 'absent' };
  const s = String(value);
  if (looksLive(s)) return { kind: 'skip', value: s, reason: 'LIVE-mode marker present' };
  if (shape.test(s)) return { kind: 'clear', value: s };
  return { kind: 'skip', value: s, reason: 'unrecognized id shape (not a test-mode ' + shape.source + ' id)' };
}

async function main() {
  const scopeArg = argValue('collection');
  const scope = scopeArg
    ? scopeArg.split(',').map((s) => s.trim()).filter(Boolean)
    : ALL_COLLECTIONS;
  const unknown = scope.filter((c) => !ALL_COLLECTIONS.includes(c));
  if (unknown.length) {
    console.error(`Unknown --collection value(s): ${unknown.join(', ')}. Valid: ${ALL_COLLECTIONS.join(', ')}`);
    process.exit(1);
  }

  initializeApp({ credential: loadCredential() });
  const db = getFirestore();

  console.log(`\nPurge test-mode Stripe IDs — ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`Collections in scope: ${scope.join(', ')}`);
  console.log(
    '\n⚠ Stripe account/customer/subscription IDs do NOT encode test-vs-live in\n' +
    '  the ID string. This purge is valid ONLY if every stored ID was written\n' +
    '  with a TEST key. Values with a live marker or an unexpected shape are\n' +
    '  always SKIPPED and reported — never written.\n',
  );

  const writes = []; // { ref, data } — applied only with --commit
  let clearCount = 0;
  let cancelCount = 0;
  const skipped = []; // { path, field, value, reason }

  // ── tenants / users : clear stale id fields ──────────────────────────────
  for (const coll of scope) {
    const targets = CLEAR_TARGETS[coll];
    if (!targets) continue;
    const snap = await db.collection(coll).get();
    let collFields = 0;
    let collDocs = 0;
    console.log(`── ${coll} ─────────────────────────────────────────────`);
    for (const doc of snap.docs) {
      const d = doc.data();
      const update = {};
      const lines = [];
      for (const t of targets) {
        const res = classify(d[t.field], t.shape);
        if (res.kind === 'absent') continue;
        if (res.kind === 'skip') {
          skipped.push({ path: `${coll}/${doc.id}`, field: t.field, value: res.value, reason: res.reason });
          continue;
        }
        // clear
        update[t.field] = FieldValue.delete();
        let extra = '';
        if (t.pairedStatus && d[t.pairedStatus] !== undefined) {
          update[t.pairedStatus] = FieldValue.delete();
          extra = ` + ${t.pairedStatus}`;
        }
        lines.push(`    ${t.field} = ${res.value}  [${t.label}]  → CLEAR field${extra}`);
        clearCount++;
        collFields++;
      }
      if (Object.keys(update).length) {
        update.updatedAt = new Date().toISOString();
        writes.push({ ref: doc.ref, data: update });
        collDocs++;
        console.log(`  ${coll}/${doc.id}`);
        lines.forEach((l) => console.log(l));
      }
    }
    console.log(`  Subtotal: ${collFields} field(s) across ${collDocs} doc(s) to clear.\n`);
  }

  // ── affiliate_commissions : cancel pending rows (stop the retry cron) ─────
  if (scope.includes('affiliate_commissions')) {
    console.log('── affiliate_commissions ───────────────────────────────────');
    console.log('  (pending rows only — the retry cron transfers these to dead test accounts)');
    const pendingSnap = await db.collection('affiliate_commissions').where('status', '==', 'pending').get();
    let nonPendingNote = '';
    for (const doc of pendingSnap.docs) {
      const c = doc.data();
      // Safety: a pending row whose stored ids look live is anomalous — skip it.
      const sub = c.stripeSubscriptionId ? String(c.stripeSubscriptionId) : '';
      const tr = c.stripeTransferId ? String(c.stripeTransferId) : '';
      if (looksLive(sub) || looksLive(tr)) {
        skipped.push({ path: `affiliate_commissions/${doc.id}`, field: 'stripeSubscriptionId/stripeTransferId', value: sub || tr, reason: 'LIVE-mode marker on a pending commission' });
        continue;
      }
      console.log(
        `  affiliate_commissions/${doc.id}\n` +
        `    status=pending  commission=${c.commission}  referrerId=${c.referrerId}  sub=${sub || '(none)'}\n` +
        `      → SET status='cancelled' (stops retry cron; keeps referral history)`,
      );
      writes.push({
        ref: doc.ref,
        data: { status: 'cancelled', cancelReason: 'test-stripe-purge', updatedAt: new Date().toISOString() },
      });
      cancelCount++;
    }
    // Report (never touch) the inert non-pending rows so the count is complete.
    const allSnap = await db.collection('affiliate_commissions').get();
    const nonPending = allSnap.size - pendingSnap.size;
    nonPendingNote = `${nonPending} non-pending row(s) left as history`;
    console.log(`  Subtotal: ${cancelCount} pending row(s) to cancel; ${nonPendingNote}.\n`);
  }

  // ── Report-only fields found in scope (inventory completeness) ────────────
  const reportRows = [];
  for (const coll of Object.keys(REPORT_ONLY)) {
    // churches isn't a scope option; always scan it for the inventory note.
    if (coll !== 'churches' && !scope.includes(coll)) continue;
    const snap = await db.collection(coll).get();
    for (const spec of REPORT_ONLY[coll]) {
      let n = 0;
      snap.forEach((doc) => { if (doc.data()[spec.field]) n++; });
      if (n) reportRows.push({ coll, field: spec.field, n, why: spec.why });
    }
  }
  if (reportRows.length) {
    console.log('── OTHER test-mode Stripe IDs found (reported, NOT purged) ──');
    for (const r of reportRows) console.log(`  ${r.coll}.${r.field}: ${r.n} doc(s) — ${r.why}`);
    console.log('');
  }

  // ── Skipped (unclassifiable / live-looking — never written) ──────────────
  if (skipped.length) {
    console.log('── SKIPPED (not touched — could not classify as test-mode) ──');
    for (const s of skipped) console.log(`  ${s.path} ${s.field} = ${s.value}  → ${s.reason}`);
    console.log('');
  }

  console.log(`TOTAL: ${clearCount} field(s) to clear, ${cancelCount} commission(s) to cancel, ${skipped.length} skipped.`);

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit (keep --collection scoped) to apply.');
    process.exit(0);
  }

  // ── Apply, batched (Firestore batch limit 500) ───────────────────────────
  let applied = 0;
  const BATCH = 450;
  for (let i = 0; i < writes.length; i += BATCH) {
    const slice = writes.slice(i, i + BATCH);
    const batch = db.batch();
    for (const w of slice) batch.update(w.ref, w.data);
    await batch.commit();
    applied += slice.length;
    console.log(`  applied ${applied}/${writes.length}…`);
  }
  console.log(`\nAPPLIED (--commit). Mutated ${applied} doc(s): cleared ${clearCount} field(s), cancelled ${cancelCount} commission(s).`);
  if (skipped.length) console.log(`NOTE: ${skipped.length} value(s) were skipped and left untouched — review them manually.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
