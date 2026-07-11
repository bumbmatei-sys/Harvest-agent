/**
 * One-time backfill for the authors + categories tenant-isolation fix.
 *
 * BACKGROUND
 * The top-level `authors/{id}` and `categories/{name}` collections used to be a
 * GLOBAL shared library with NO tenantId. The security fix scopes them per
 * tenant (mirroring the courses rule), so BEFORE the tightened rules go live
 * every existing doc must gain a `tenantId` — otherwise the new read rule
 * (`belongsToTenant(resource.data.tenantId)`) hides every existing author and
 * category and the course UI goes blank for everyone.
 *
 * OWNERSHIP (inferred from courses, which DO carry a tenantId)
 *   - author  -> the tenantId(s) of courses whose `authorIds` include it
 *   - category-> the tenantId(s) of courses whose `category` label equals it
 * A doc owned by exactly one tenant is assigned to it. Then:
 *   - Categories are RE-KEYED to `${tenantId}__${name}` (the id scheme the app now
 *     writes/deletes). A label shared by several tenants is COPIED once per tenant
 *     (categories are linked to courses by NAME, so per-tenant copies are safe),
 *     and the legacy name-keyed doc is deleted.
 *   - An author referenced by several tenants (SHARED) or by none (ORPHAN) is
 *     REPORTED and left untouched: authors are referenced by id in
 *     courses[].authorIds, so assigning a shared author to one tenant would hide it
 *     from the others, and duplicating requires re-pointing authorIds — a human
 *     decision. In a per-church product these should be rare/zero.
 *   - Orphan categories (used by no course) are reported and, only with
 *     --include-orphans, assigned to ORPHAN_TENANT_ID (default: the platform tenant).
 *
 * RUN ORDER (IMPORTANT — the rules auto-deploy on merge to main):
 *   1. Run the DRY RUN, confirm the counts and review ORPHAN/SHARED items.
 *   2. Run with --commit while the OLD permissive rules are still live (adding a
 *      field / re-keying via the Admin SDK bypasses rules anyway).
 *   3. THEN merge the firestore.rules PR (that push deploys the tightened rules).
 * Idempotent: docs that already carry a tenantId are skipped, so re-runs are safe.
 *
 * USAGE
 *   Dry run (default):  node scripts/backfill-authors-categories-tenant.mjs
 *   Apply:              node scripts/backfill-authors-categories-tenant.mjs --commit
 *   Assign orphan cats: add --include-orphans
 *
 * CREDENTIALS (keep the key OUTSIDE the repo, referenced by env var only):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/backfill-authors-categories-tenant.mjs
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/backfill-authors-categories-tenant.mjs
 *
 * ORPHAN_TENANT_ID defaults to PLATFORM_TENANT_ID ('harvest'); override via env.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');
const INCLUDE_ORPHANS = process.argv.includes('--include-orphans');
const ORPHAN_TENANT_ID = process.env.ORPHAN_TENANT_ID || process.env.PLATFORM_TENANT_ID || 'harvest';

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) return cert(JSON.parse(raw));
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC.
  return applicationDefault();
}

// Keep in sync with categoryDocId() in src/components/AdminCourseEditor.tsx.
const categoryDocId = (tenantId, name) => `${tenantId}__${name}`;

initializeApp({ credential: loadCredential() });
const db = getFirestore();

// ── Build ownership maps from courses (which carry tenantId) ──────────────
const coursesSnap = await db.collection('courses').get();
const authorToTenants = new Map();   // authorId    -> Set<tenantId>
const categoryToTenants = new Map(); // categoryName -> Set<tenantId>
for (const d of coursesSnap.docs) {
  const c = d.data();
  const tid = c.tenantId;
  if (!tid) continue;
  for (const aid of c.authorIds || []) {
    if (!authorToTenants.has(aid)) authorToTenants.set(aid, new Set());
    authorToTenants.get(aid).add(tid);
  }
  if (c.category) {
    if (!categoryToTenants.has(c.category)) categoryToTenants.set(c.category, new Set());
    categoryToTenants.get(c.category).add(tid);
  }
}
console.log(`Scanned ${coursesSnap.size} courses.`);

// ── Authors: assign a tenantId when a single tenant owns them ─────────────
const authorsSnap = await db.collection('authors').get();
let aAssigned = 0, aSkipped = 0, aOrphan = 0, aShared = 0;
console.log(`\nAuthors (${authorsSnap.size}):`);
for (const d of authorsSnap.docs) {
  const data = d.data();
  if (data.tenantId) { aSkipped++; continue; }
  const tenants = [...(authorToTenants.get(d.id) || [])];
  if (tenants.length === 1) {
    aAssigned++;
    console.log(`  assign  authors/${d.id} ("${data.name || ''}") -> ${tenants[0]}`);
    if (COMMIT) await d.ref.set({ tenantId: tenants[0] }, { merge: true });
  } else if (tenants.length === 0) {
    aOrphan++;
    console.warn(`  ORPHAN  authors/${d.id} ("${data.name || ''}") — no course references it; left untouched (assign manually)`);
  } else {
    aShared++;
    console.warn(`  SHARED  authors/${d.id} ("${data.name || ''}") — referenced by [${tenants.join(', ')}]; left untouched (needs per-tenant duplication)`);
  }
}

// ── Categories: re-key to ${tenantId}__${name}, one copy per owning tenant ─
const catsSnap = await db.collection('categories').get();
let cWritten = 0, cSkipped = 0, cOrphan = 0, cDeleted = 0;
console.log(`\nCategories (${catsSnap.size}):`);
for (const d of catsSnap.docs) {
  const data = d.data();
  if (data.tenantId) { cSkipped++; continue; } // already migrated
  const name = data.name ?? d.id;
  let tenants = [...(categoryToTenants.get(name) || [])];
  if (tenants.length === 0) {
    if (!INCLUDE_ORPHANS) {
      cOrphan++;
      console.warn(`  ORPHAN  categories/${d.id} ("${name}") — used by no course; left untouched (re-run with --include-orphans to assign to ${ORPHAN_TENANT_ID})`);
      continue;
    }
    tenants = [ORPHAN_TENANT_ID];
  }
  for (const tid of tenants) {
    const newId = categoryDocId(tid, name);
    cWritten++;
    console.log(`  copy    categories/${d.id} -> categories/${newId} (tenantId=${tid})`);
    if (COMMIT) await db.collection('categories').doc(newId).set({ name, tenantId: tid });
  }
  cDeleted++;
  console.log(`  delete  legacy categories/${d.id}`);
  if (COMMIT) await d.ref.delete();
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
console.log(`authors    : assigned ${aAssigned}, already-scoped ${aSkipped}, ORPHAN ${aOrphan}, SHARED ${aShared}`);
console.log(`categories : copies written ${cWritten}, already-scoped ${cSkipped}, ORPHAN ${cOrphan}, legacy deleted ${cDeleted}`);
console.log(COMMIT ? '\nAPPLIED (--commit).' : '\nDRY RUN — re-run with --commit to apply.');
if (aOrphan || aShared || cOrphan) {
  console.log('NOTE: ORPHAN/SHARED items above were left untouched — resolve them before/after deploy so no author or category is silently hidden.');
}
process.exit(0);
