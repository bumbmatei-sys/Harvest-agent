/**
 * Find + delete ORPHANED rag_chunks — chunks whose owning rag_sources doc no
 * longer exists.
 *
 * BACKGROUND
 * The AI Knowledge UI (AdminRAG) lists `rag_sources`; the blog generator and
 * chat read `rag_chunks`. Deleting a source is supposed to delete its chunks
 * too, but earlier deletions could leave chunks behind (the source doc was
 * removed BEFORE its chunks, so any failure in the chunk-delete step orphaned
 * them). A source then vanishes from the UI while its chunks persist and keep
 * feeding generation — which is how the blog wrote about OLD test content that
 * had been "deleted". This script surfaces and (with --commit) removes those
 * orphaned chunks.
 *
 * A chunk is ORPHANED when its `sourceId` is NOT among the live `rag_sources`
 * `sourceId`s FOR THE SAME TENANT. (Matching is per-tenant so a sourceId reused
 * across tenants is never cross-counted.)
 *
 * It ALSO reports (never deletes) `rag_sources` that look stuck/failed —
 * status 'processing' or chunks == 0 — so the founder can spot video lessons
 * whose embed failed and re-add them. Sources are only REPORTED; only orphaned
 * CHUNKS are ever deleted.
 *
 * USAGE
 *   Dry run (default):  node scripts/cleanup-orphaned-rag-chunks.mjs
 *   Apply:              node scripts/cleanup-orphaned-rag-chunks.mjs --commit
 *   Scope one tenant:   add --tenant=<tenantId>   (recommended for safety)
 *
 * CREDENTIALS (keep the key OUTSIDE the repo, referenced by env var only):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/cleanup-orphaned-rag-chunks.mjs
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/cleanup-orphaned-rag-chunks.mjs
 *
 * CAUTION: --commit permanently deletes live chunks. ALWAYS run the dry run
 * first, eyeball the orphaned sourceIds + titles (confirm they are the old
 * content you removed), then re-run with --commit. Scope to your tenant with
 * --tenant=<id> the first time.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const ONLY_TENANT = tenantArg ? tenantArg.slice('--tenant='.length) : null;

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) return cert(JSON.parse(raw));
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC.
  return applicationDefault();
}

initializeApp({ credential: loadCredential() });
const db = getFirestore();

const tenantKey = (t) => (t == null ? '(no tenant)' : t);

// ── 1. Load live rag_sources → per-tenant Set<sourceId> (+ report bad ones) ──
let sourcesQuery = db.collection('rag_sources');
if (ONLY_TENANT) sourcesQuery = sourcesQuery.where('tenantId', '==', ONLY_TENANT);
const sourcesSnap = await sourcesQuery.get();

const liveByTenant = new Map(); // tenantKey -> Set<sourceId>
const stuckSources = [];        // { tenantId, sourceId, title, status, chunks }
for (const d of sourcesSnap.docs) {
  const s = d.data();
  const tk = tenantKey(s.tenantId);
  if (!liveByTenant.has(tk)) liveByTenant.set(tk, new Set());
  if (s.sourceId) liveByTenant.get(tk).add(s.sourceId);
  if (s.status === 'processing' || (s.chunks ?? 0) === 0) {
    stuckSources.push({
      tenantId: s.tenantId ?? null,
      sourceId: s.sourceId ?? '(none)',
      title: s.title || '(untitled)',
      status: s.status || '(none)',
      chunks: s.chunks ?? 0,
    });
  }
}
console.log(
  `Loaded ${sourcesSnap.size} rag_sources${ONLY_TENANT ? ` (tenant=${ONLY_TENANT})` : ''}.`,
);

// ── 2. Scan rag_chunks; flag any whose sourceId ∉ its tenant's live set ──
let chunksQuery = db.collection('rag_chunks');
if (ONLY_TENANT) chunksQuery = chunksQuery.where('tenantId', '==', ONLY_TENANT);
const chunksSnap = await chunksQuery.get();

// Per-tenant tallies + the orphaned chunk refs to delete.
const perTenant = new Map(); // tenantKey -> { total, orphaned, sources: Map<sourceId,{title,count}> }
const orphanRefs = [];
for (const d of chunksSnap.docs) {
  const c = d.data();
  const tk = tenantKey(c.tenantId);
  if (!perTenant.has(tk)) perTenant.set(tk, { total: 0, orphaned: 0, sources: new Map() });
  const bucket = perTenant.get(tk);
  bucket.total++;

  const live = liveByTenant.get(tk) || new Set();
  if (!c.sourceId || !live.has(c.sourceId)) {
    bucket.orphaned++;
    const key = c.sourceId || '(no sourceId)';
    if (!bucket.sources.has(key)) bucket.sources.set(key, { title: c.title || '(untitled)', count: 0 });
    bucket.sources.get(key).count++;
    orphanRefs.push(d.ref);
  }
}
console.log(`Scanned ${chunksSnap.size} rag_chunks.\n`);

// ── 3. Report ──
console.log('── Orphaned chunks by tenant ──');
if (perTenant.size === 0) console.log('  (no chunks found)');
for (const [tk, b] of perTenant) {
  console.log(`\nTenant ${tk}: ${b.total} chunks, ${b.orphaned} orphaned`);
  if (b.orphaned > 0) {
    console.log('  Orphaned sources (sourceId — title — chunk count):');
    for (const [sid, info] of b.sources) {
      console.log(`    ${sid}  —  "${info.title}"  —  ${info.count} chunk(s)`);
    }
  }
}

if (stuckSources.length) {
  console.log('\n── Stuck / failed rag_sources (REPORT ONLY — not deleted) ──');
  console.log('  These may be the "disappeared" content (e.g. video lessons whose');
  console.log('  embed failed). Re-add them from the AI Knowledge UI if needed.');
  for (const s of stuckSources) {
    console.log(
      `    tenant=${tenantKey(s.tenantId)}  sourceId=${s.sourceId}  status=${s.status}  chunks=${s.chunks}  —  "${s.title}"`,
    );
  }
}

const totalOrphaned = orphanRefs.length;

// ── 4. Delete (only with --commit), batched (Firestore batch limit 500) ──
if (!COMMIT) {
  console.log(
    `\nDRY RUN — found ${totalOrphaned} orphaned chunk(s). Nothing deleted. ` +
      `Re-run with --commit to delete${ONLY_TENANT ? '' : ' (consider --tenant=<id> first)'}.`,
  );
  process.exit(0);
}

let deleted = 0;
const BATCH = 450;
for (let i = 0; i < orphanRefs.length; i += BATCH) {
  const slice = orphanRefs.slice(i, i + BATCH);
  const batch = db.batch();
  for (const ref of slice) batch.delete(ref);
  await batch.commit();
  deleted += slice.length;
  console.log(`  deleted ${deleted}/${totalOrphaned}…`);
}
console.log(`\nAPPLIED (--commit). Deleted ${deleted} orphaned chunk(s).`);
if (stuckSources.length) {
  console.log(`NOTE: ${stuckSources.length} stuck/failed source(s) reported above were left untouched.`);
}
process.exit(0);
