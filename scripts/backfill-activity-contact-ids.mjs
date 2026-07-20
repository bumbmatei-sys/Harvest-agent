/**
 * Backfill split CRM activity ids — re-key `contactActivities` that were written
 * under a person's `users` id back onto their `contacts` doc id.
 *
 * WHY IT EXISTS
 * The CRM merges `contacts` with app `users` into one list. A person who exists
 * in BOTH collections must surface under a single, stable id — the `contacts`
 * doc id — so that activities written for them (manual CRM adds, and the Stripe
 * donation webhook) are read back under the same id. Before the id-stability fix
 * in `useCRMQueries.ts` (mergeContactsWithUsers), such a person could surface
 * under their `users` id instead, so activities keyed to one id were invisible
 * when the app queried the other. The most common way this splits historically:
 * a tenant member donated BEFORE having a `contacts` doc, so the webhook keyed
 * that donation activity under their `users` id (`linkDonationToCRM`,
 * webhook/route.ts — `contactId = donorUserId` when no contact exists yet);
 * later they gained a `contacts` doc, and every subsequent activity landed under
 * the `contacts` id. This script folds the stray `users`-id activities back onto
 * the `contacts` id so the whole timeline reads under one id.
 *
 * WHAT IT DOES (read-only by default)
 *   For every `contactActivities` doc whose `contactId` is NOT itself a `contacts`
 *   doc id, it tries to resolve the person's canonical `contacts` doc — scoped to
 *   the activity's own `tenantId` — by either:
 *     1. userId-link : a `contacts` doc with `userId == activity.contactId`
 *        (same tenant). This is the exact inverse of how the split arises. OR
 *     2. email       : if no userId-link exists, it loads `users/{contactId}` and
 *        matches its (trim+lowercase) email to a `contacts` doc in the same
 *        tenant. Ambiguous email matches (2+ contacts) are SKIPPED and reported —
 *        never guessed.
 *   When a target is found and differs from the current id, `contactId` is
 *   rewritten to the `contacts` doc id.
 *
 *   LEFT UNTOUCHED (correctly keyed — never rewritten):
 *     • activities already keyed to a `contacts` doc id;
 *     • activities keyed to a `users`-only member's id (no matching contact) —
 *       that id IS their stable CRM id;
 *     • activities whose id resolves to no contact at all (stale/garbage) — only
 *       reported, never changed.
 *
 * SCOPE / SAFETY
 *   • Does NOT touch `totalDonated`, the `contacts` docs, the `users` docs, or
 *     firestore.rules — it only rewrites the `contactId` field on activity docs.
 *   • `--tenant=<id>` limits the scan to one tenant (recommended first pass).
 *   • Dry run is the default and prints every proposed rewrite with its match
 *     reason; `--commit` is required to write. Batched (Firestore limit 500).
 *
 * USAGE
 *   Dry run (default — NO writes; this output IS the review gate):
 *     node scripts/backfill-activity-contact-ids.mjs
 *   Scope to one tenant (recommended):
 *     node scripts/backfill-activity-contact-ids.mjs --tenant=bumb
 *   Apply:
 *     node scripts/backfill-activity-contact-ids.mjs --tenant=bumb --commit
 *
 * CREDENTIALS (keep any key OUTSIDE the repo, referenced by env var only):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/backfill-activity-contact-ids.mjs
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/backfill-activity-contact-ids.mjs
 *   — or — run inside Firebase Cloud Shell with Application Default Credentials.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

const normEmail = (s) => String(s ?? '').trim().toLowerCase();
const tenantKey = (t) => String(t ?? ''); // activities always carry a concrete tenantId

async function main() {
  const tenantScope = argValue('tenant'); // null = all tenants

  initializeApp({ credential: loadCredential() });
  const db = getFirestore();

  console.log(`\nBackfill split activity contact ids — ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`Tenant scope: ${tenantScope || '(all tenants)'}`);
  console.log('Rewrites contactActivities keyed under a users id back to the matching contacts id.\n');

  // ── 1. Load contacts → build lookup indexes ───────────────────────────────
  let contactsQ = db.collection('contacts');
  if (tenantScope) contactsQ = contactsQ.where('tenantId', '==', tenantScope);
  const contactsSnap = await contactsQ.get();

  const contactIds = new Set();                    // every contacts doc id (already-correct guard)
  const byUserTenant = new Map();                  // `${userId}|${tenant}` -> contactId
  const byEmailTenant = new Map();                 // `${email}|${tenant}`  -> [contactId, ...]
  for (const doc of contactsSnap.docs) {
    const c = doc.data();
    const t = tenantKey(c.tenantId);
    contactIds.add(doc.id);
    if (c.userId) byUserTenant.set(`${c.userId}|${t}`, doc.id);
    const e = normEmail(c.email);
    if (e) {
      const k = `${e}|${t}`;
      (byEmailTenant.get(k) || byEmailTenant.set(k, []).get(k)).push(doc.id);
    }
  }
  console.log(`Loaded ${contactsSnap.size} contact(s): ${byUserTenant.size} with a userId link.\n`);

  // ── 2. Scan contactActivities ─────────────────────────────────────────────
  let actQ = db.collection('contactActivities');
  if (tenantScope) actQ = actQ.where('tenantId', '==', tenantScope);
  const actSnap = await actQ.get();

  const usersCache = new Map();                     // users doc id -> data|null (bounded reads)
  async function userEmail(uid) {
    if (usersCache.has(uid)) return usersCache.get(uid);
    const snap = await db.collection('users').doc(uid).get();
    const email = snap.exists ? normEmail(snap.data().email) : null;
    usersCache.set(uid, email);
    return email;
  }

  const rewrites = [];                              // { ref, from, to, reason, tenant }
  const ambiguous = [];                             // { path, cid, tenant, candidates }
  let alreadyCorrect = 0;
  let usersOnly = 0;                                // stray id with no matching contact (leave)
  let missingCid = 0;

  for (const doc of actSnap.docs) {
    const a = doc.data();
    const cid = a.contactId;
    const t = tenantKey(a.tenantId);
    if (!cid) { missingCid++; continue; }
    if (contactIds.has(cid)) { alreadyCorrect++; continue; } // keyed to a real contact doc

    // cid is not a contacts doc id → treat as a users id and try to resolve.
    let target = byUserTenant.get(`${cid}|${t}`);
    let reason = 'userId-link';
    if (!target) {
      const email = await userEmail(cid);
      if (email) {
        const cands = byEmailTenant.get(`${email}|${t}`) || [];
        if (cands.length === 1) { target = cands[0]; reason = 'email(users-doc)'; }
        else if (cands.length > 1) { ambiguous.push({ path: doc.ref.path, cid, tenant: t, candidates: cands }); continue; }
      }
    }

    if (target && target !== cid) {
      rewrites.push({ ref: doc.ref, from: cid, to: target, reason, tenant: t });
    } else {
      usersOnly++; // no matching contact — a users-only member's own id; leave it
    }
  }

  // ── 3. Report ─────────────────────────────────────────────────────────────
  console.log('── PROPOSED REWRITES (contactId: users id → contacts id) ────');
  if (rewrites.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of rewrites) {
      console.log(`  ${r.ref.path}\n    tenant=${r.tenant}  ${r.from}  →  ${r.to}   [${r.reason}]`);
    }
  }
  console.log('');

  if (ambiguous.length) {
    console.log('── SKIPPED — AMBIGUOUS (2+ contacts share the email; not guessed) ──');
    for (const s of ambiguous) console.log(`  ${s.path}  tenant=${s.tenant}  cid=${s.cid}  candidates=${s.candidates.join(', ')}`);
    console.log('');
  }

  console.log(
    `TOTAL: ${actSnap.size} activit(y/ies) scanned — ${rewrites.length} to rewrite, ` +
    `${alreadyCorrect} already keyed to a contact, ${usersOnly} users-only/orphan (left), ` +
    `${ambiguous.length} ambiguous (left), ${missingCid} missing contactId (left).`,
  );

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit (keep --tenant scoped) to apply.');
    process.exit(0);
  }

  // ── 4. Apply, batched (Firestore batch limit 500) ─────────────────────────
  let applied = 0;
  const BATCH = 450;
  for (let i = 0; i < rewrites.length; i += BATCH) {
    const slice = rewrites.slice(i, i + BATCH);
    const batch = db.batch();
    for (const r of slice) batch.update(r.ref, { contactId: r.to });
    await batch.commit();
    applied += slice.length;
    console.log(`  applied ${applied}/${rewrites.length}…`);
  }
  console.log(`\nAPPLIED (--commit). Re-keyed ${applied} activit(y/ies) onto their contacts doc id.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
