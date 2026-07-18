/**
 * Purge TEST-MODE Stripe IDs from Firestore ahead of go-live (audit §3 / S3).
 *
 * ============================================================================
 * ⛔ RUN-WINDOW CONSTRAINT — READ BEFORE USING --commit
 * ============================================================================
 * This script classifies Stripe ids by SHAPE (`acct_`, `cus_`, `sub_`, `si_`,
 * `pi_`, `in_`, `price_`, `tr_`), NOT by test-vs-live — because those ids are
 * OPAQUE and IDENTICAL across modes. (Only price ids differ per environment and
 * only KEYS `sk_/pk_/rk_` and Checkout Sessions `cs_test_/cs_live_` embed the
 * mode — none of those are stored in these fields.)
 *
 * Therefore the purge is safe ONLY on the premise that NO LIVE KEY HAS EVER
 * WRITTEN THIS DATA:
 *   • TRUE today  — pre-go-live, every id in Firestore came from the TEST key.
 *   • FALSE the instant the app flips to a live key — a shape-matching `acct_`
 *     could then be a REAL connected account, and purging it would break a
 *     paying tenant.
 *
 * RUN THIS AFTER test data is confirmed and BEFORE the first live write — never
 * after launch. The dry run may run anytime; `--commit` REQUIRES the explicit
 * `--i-am-pre-go-live` acknowledgement flag (hard gate below).
 * ============================================================================
 *
 * WHY IT EXISTS
 * Stripe test and live modes are fully separate: a test `acct_`/`cus_`/`sub_`
 * id does not exist under a live key, so every stored id becomes a failing
 * live-key API call at go-live. The worst is the audit's S3 — pending
 * `affiliate_commissions` make the daily payout cron
 * (src/app/api/affiliate/retry-transfers/route.ts) retry transfers to dead test
 * accounts forever.
 *
 * WHAT IT DOES (fields verified against the writers in the repo)
 *   tenants / users / invoices / registrations : clears the stale id field
 *       (and any paired field) with FieldValue.delete(). Code reads these with
 *       `?.` truthiness checks, so an absent field == "not connected".
 *   affiliate_commissions : MARKS pending rows terminal (status → 'cancelled')
 *       rather than deleting — the retry cron and sweep both query only
 *       status=='pending' (retry-transfers/route.ts:33-36; affiliate-payout.ts
 *       :76-83) and the earnings view already excludes 'cancelled'
 *       (api/affiliate/status/route.ts:68), so this stops every retry path AND
 *       preserves the referral record. The stored sub_/in_/tr_ ids are LEFT as
 *       history. Deleting would destroy real referral records.
 *
 * URGENCY TIERS (which fields --commit touches)
 *   Default --commit = HIGH only. Add `--include=med,low` to widen.
 *     HIGH  tenants.stripeConnectAccountId(+stripeConnectStatus);
 *           users.affiliateStripeAccountId(+affiliateConnectStatus);
 *           affiliate_commissions pending rows → cancelled.
 *     MED   tenants.stripeSubscriptionId, tenants.stripePriceId (S2 — see B1),
 *           tenants.addOnAiAssistant; users.aiAssistantCustomerId,
 *           users.donationSubscriptionId(+donationChurchId paired).
 *     LOW   tenants.stripeCustomerId (self-heals — recommend LEAVE);
 *           tenants/{id}/invoices.relatedId; tenants/{id}/registrations
 *           .stripePaymentIntentId; webhook_events (report only, harmless).
 *
 * 🚫 GUARDED — NEVER field-wiped by a normal run (enumerate, don't execute):
 *   churches.stripeSubscriptionItemId       a billable line item on the tenant's
 *       parent subscription; nulling the pointer ORPHANS the item (billing stays,
 *       handle lost). Use the existing remove-billing route.
 *   users.aiAssistantSubscriptionItemId     clearing silently strips a paid
 *       $200/mo AI-assistant entitlement.
 *   Both are DETECTED + LISTED with a warning and refused even under --commit,
 *   unless the operator explicitly passes --force-guarded-fields (per-run opt-in).
 *
 * NOTE — mislabels in the field list, handled correctly here:
 *   • users.donationChurchId is a tenantId, NOT a Stripe id — cleared only as the
 *     paired field of donationSubscriptionId (as cancel-partnership does).
 *   • registrations / invoices are SUBCOLLECTIONS under tenants/{id}; scanned via
 *     collectionGroup(), not as top-level collections.
 *
 * OUT OF SCOPE: does not delete test tenants/users/subscriptions (tenant deletion
 * has its own cascade), and does not touch stripe-config.ts (B1 / PR #207) or
 * firestore.rules.
 *
 * USAGE
 *   Dry run (default — NO writes; this output IS the review gate):
 *     node scripts/purge-test-stripe-ids.mjs
 *   Scope one collection at a time (recommended):
 *     node scripts/purge-test-stripe-ids.mjs --collection=affiliate_commissions
 *   Apply HIGH-tier fixes (requires the run-window ack):
 *     node scripts/purge-test-stripe-ids.mjs --collection=tenants,users --commit --i-am-pre-go-live
 *   Widen to MED/LOW:
 *     node scripts/purge-test-stripe-ids.mjs --commit --i-am-pre-go-live --include=med,low
 *
 * CREDENTIALS (keep any key OUTSIDE the repo, referenced by env var only):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/purge-test-stripe-ids.mjs
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/purge-test-stripe-ids.mjs
 *   — or — run inside Firebase Cloud Shell with Application Default Credentials.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');
const PRE_GO_LIVE = process.argv.includes('--i-am-pre-go-live');
const FORCE_GUARDED = process.argv.includes('--force-guarded-fields');

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

const SHAPE = {
  acct: /^acct_/, cus: /^cus_/, sub: /^sub_/, si: /^si_/,
  tr: /^tr_/, in: /^in_/, price: /^price_/, pi: /^pi_/, subOrPi: /^(sub|pi)_/,
};

// A value we must never touch: it carries an explicit live-mode marker. Rare for
// the opaque ids here, but it's the safe asymmetry — skip anything live-looking.
const looksLive = (s) => /_live_/.test(s) || /^(sk|pk|rk)_live/.test(s) || /^cs_live_/.test(s);

// scan: 'top' = db.collection(name); 'group' = db.collectionGroup(name) (subcollection).
// clears[].tier gates whether --commit writes it. paired[] fields are deleted alongside.
// guarded[] fields are enumerated but never written without --force-guarded-fields.
const SPECS = {
  tenants: {
    scan: 'top',
    clears: [
      { field: 'stripeConnectAccountId', shape: SHAPE.acct, tier: 'high', label: 'Connect account (acct_)', paired: ['stripeConnectStatus'] },
      { field: 'stripeSubscriptionId', shape: SHAPE.sub, tier: 'med', label: 'subscription (sub_)' },
      { field: 'stripePriceId', shape: SHAPE.price, tier: 'med', label: 'price (price_) — S2, coordinate w/ B1' },
      { field: 'addOnAiAssistant', shape: SHAPE.sub, tier: 'med', label: 'AI add-on subscription (sub_)' },
      { field: 'stripeCustomerId', shape: SHAPE.cus, tier: 'low', label: 'customer (cus_) — self-heals, recommend LEAVE' },
    ],
  },
  users: {
    scan: 'top',
    clears: [
      { field: 'affiliateStripeAccountId', shape: SHAPE.acct, tier: 'high', label: 'affiliate Connect account (acct_)', paired: ['affiliateConnectStatus'] },
      { field: 'aiAssistantCustomerId', shape: SHAPE.cus, tier: 'med', label: 'AI add-on customer (cus_)' },
      { field: 'donationSubscriptionId', shape: SHAPE.sub, tier: 'med', label: 'partnership subscription (sub_)', paired: ['donationChurchId'] },
    ],
    guarded: [
      { field: 'aiAssistantSubscriptionItemId', shape: SHAPE.si, why: 'paid $200/mo AI-assistant entitlement — use billing route' },
    ],
  },
  churches: {
    scan: 'top',
    guarded: [
      { field: 'stripeSubscriptionItemId', shape: SHAPE.si, why: 'line item on parent subscription — orphans if nulled; use remove-billing route' },
    ],
  },
  affiliate_commissions: { scan: 'cancel' },
  invoices: {
    scan: 'group',
    clears: [
      { field: 'relatedId', shape: SHAPE.subOrPi, tier: 'low', label: 'receipt relatedId (sub_/pi_)' },
    ],
  },
  registrations: {
    scan: 'group',
    clears: [
      { field: 'stripePaymentIntentId', shape: SHAPE.pi, tier: 'low', label: 'event payment intent (pi_)' },
    ],
  },
  webhook_events: { scan: 'report-docids' },
};

const ALL_COLLECTIONS = Object.keys(SPECS);

function classify(value, shape) {
  if (value == null || value === '') return { kind: 'absent' };
  const s = String(value);
  if (looksLive(s)) return { kind: 'skip', value: s, reason: 'LIVE-mode marker present' };
  if (shape.test(s)) return { kind: 'match', value: s };
  return { kind: 'skip', value: s, reason: `unrecognized shape (not ${shape.source})` };
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

  const includeArg = argValue('include');
  const activeTiers = new Set(['high']);
  if (includeArg) includeArg.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => activeTiers.add(t));

  // ── Run-window hard gate ──────────────────────────────────────────────────
  if (COMMIT && !PRE_GO_LIVE) {
    console.error(
      '\n⛔ REFUSING TO COMMIT.\n' +
      '   This purge classifies ids by shape, not by test-vs-live, so it is only\n' +
      '   safe BEFORE the first live Stripe write. Confirm test data + pre-go-live,\n' +
      '   then re-run with --i-am-pre-go-live. (Dry run needs no flag.)\n',
    );
    process.exit(1);
  }

  initializeApp({ credential: loadCredential() });
  const db = getFirestore();

  console.log(`\nPurge test-mode Stripe IDs — ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`Collections in scope: ${scope.join(', ')}`);
  console.log(`Commit tiers: ${[...activeTiers].join(', ')}${includeArg ? '' : '  (default HIGH-only; add --include=med,low to widen)'}`);
  console.log(
    '\n⚠ Stripe ids do NOT encode test-vs-live in the id string — this purge is\n' +
    '  valid ONLY pre-go-live (no live key has ever written this data). Values with\n' +
    '  a live marker or an unexpected shape are always SKIPPED and reported.\n',
  );

  const writes = []; // { ref, data }
  let clearCount = 0; // fields that WILL be cleared under current tiers/commit
  let deferCount = 0; // matched fields shown but outside the active tiers
  let cancelCount = 0;
  let guardedCount = 0;
  const skipped = []; // { path, field, value, reason }

  // ── Clear-collections (top-level or collectionGroup) ─────────────────────
  for (const coll of scope) {
    const spec = SPECS[coll];
    if (!spec.clears && !spec.guarded) continue;
    const snap = spec.scan === 'group'
      ? await db.collectionGroup(coll).get()
      : await db.collection(coll).get();

    console.log(`── ${coll}${spec.scan === 'group' ? ' (subcollection)' : ''} ─────────────────────────────`);
    let collFields = 0;
    let collDocs = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const path = spec.scan === 'group' ? doc.ref.path : `${coll}/${doc.id}`;
      const update = {};
      const lines = [];

      for (const t of spec.clears || []) {
        const res = classify(d[t.field], t.shape);
        if (res.kind === 'absent') continue;
        if (res.kind === 'skip') { skipped.push({ path, field: t.field, value: res.value, reason: res.reason }); continue; }
        const willClear = activeTiers.has(t.tier);
        if (willClear) {
          update[t.field] = FieldValue.delete();
          let extra = '';
          for (const p of t.paired || []) {
            if (d[p] !== undefined) { update[p] = FieldValue.delete(); extra += ` + ${p}`; }
          }
          lines.push(`    ${t.field} = ${res.value}  [${t.label}]  → CLEAR field${extra}`);
          clearCount++; collFields++;
        } else {
          lines.push(`    ${t.field} = ${res.value}  [${t.label}]  → ${t.tier.toUpperCase()} (add --include=${t.tier} to clear)`);
          deferCount++;
        }
      }

      // Guarded fields: enumerate; only write with --force-guarded-fields.
      for (const g of spec.guarded || []) {
        const res = classify(d[g.field], g.shape);
        if (res.kind === 'absent') continue;
        if (res.kind === 'skip') { skipped.push({ path, field: g.field, value: res.value, reason: res.reason }); continue; }
        guardedCount++;
        if (FORCE_GUARDED) {
          update[g.field] = FieldValue.delete();
          lines.push(`    🚫 ${g.field} = ${res.value}  → CLEAR (--force-guarded-fields set) — ${g.why}`);
        } else {
          lines.push(`    🚫 ${g.field} = ${res.value}  → GUARDED, NOT touched — ${g.why}`);
        }
      }

      if (lines.length) { console.log(`  ${path}`); lines.forEach((l) => console.log(l)); }
      if (Object.keys(update).length) {
        update.updatedAt = new Date().toISOString();
        writes.push({ ref: doc.ref, data: update });
        collDocs++;
      }
    }
    console.log(`  Subtotal: ${collFields} field(s) across ${collDocs} doc(s) to clear now.\n`);
  }

  // ── affiliate_commissions : cancel pending rows ──────────────────────────
  if (scope.includes('affiliate_commissions')) {
    console.log('── affiliate_commissions ───────────────────────────────────');
    console.log('  (pending rows only — the retry cron transfers these to dead test accounts)');
    const pendingSnap = await db.collection('affiliate_commissions').where('status', '==', 'pending').get();
    for (const doc of pendingSnap.docs) {
      const c = doc.data();
      const sub = c.stripeSubscriptionId ? String(c.stripeSubscriptionId) : '';
      const tr = c.stripeTransferId ? String(c.stripeTransferId) : '';
      const inv = c.stripeInvoiceId ? String(c.stripeInvoiceId) : '';
      if (looksLive(sub) || looksLive(tr) || looksLive(inv)) {
        skipped.push({ path: `affiliate_commissions/${doc.id}`, field: 'stripe*Id', value: sub || tr || inv, reason: 'LIVE-mode marker on a pending commission' });
        continue;
      }
      console.log(
        `  affiliate_commissions/${doc.id}\n` +
        `    status=pending  commission=${c.commission}  referrerId=${c.referrerId}  sub=${sub || '(none)'}  inv=${inv || '(none)'}\n` +
        `      → SET status='cancelled' (stops retry cron; sub_/in_/tr_ kept as history)`,
      );
      writes.push({ ref: doc.ref, data: { status: 'cancelled', cancelReason: 'test-stripe-purge', updatedAt: new Date().toISOString() } });
      cancelCount++;
    }
    const allSnap = await db.collection('affiliate_commissions').get();
    console.log(`  Subtotal: ${cancelCount} pending row(s) to cancel; ${allSnap.size - pendingSnap.size} non-pending row(s) left as history.\n`);
  }

  // ── webhook_events : report only (harmless test dedup markers) ────────────
  if (scope.includes('webhook_events')) {
    const evSnap = await db.collection('webhook_events').get();
    console.log('── webhook_events (report only) ────────────────────────────');
    console.log(`  ${evSnap.size} dedup marker(s) keyed by test event.id — harmless, NOT deleted.\n`);
  }

  // ── Skipped (unclassifiable / live-looking — never written) ──────────────
  if (skipped.length) {
    console.log('── SKIPPED (not touched — could not classify as test-mode) ──');
    for (const s of skipped) console.log(`  ${s.path} ${s.field} = ${s.value}  → ${s.reason}`);
    console.log('');
  }

  console.log(
    `TOTAL: ${clearCount} field(s) to clear now, ${cancelCount} commission(s) to cancel, ` +
    `${deferCount} deferred (other tiers), ${guardedCount} guarded, ${skipped.length} skipped.`,
  );

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit --i-am-pre-go-live (keep --collection scoped) to apply.');
    process.exit(0);
  }

  if (guardedCount && FORCE_GUARDED) {
    console.log('\n⚠ --force-guarded-fields is set: entitlement/line-item pointers will be cleared. Ensure billing was handled separately.');
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
