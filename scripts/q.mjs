/**
 * q.mjs — a READ-ONLY Firestore query tool for phone-based debugging.
 *
 * ============================================================================
 * 🔒 READ-ONLY BY CONSTRUCTION — a deliberate invariant, not a convention
 * ============================================================================
 * This file has NO write path. There is no --commit flag, no mutation helper,
 * and no code branch that could ever reach one. The ONLY Firestore calls it
 * makes are collection(), collectionGroup(), doc(), where(), limit() and get().
 *
 * VERIFY IN TEN SECONDS (from the repo root):
 *   grep -nE '\.(set|update|delete|create|add|batch|commit|remove)\(' scripts/q.mjs
 * Zero matches below this header == the file cannot mutate anything. Nothing
 * imports FieldValue, and firebase-admin is imported for exactly two symbols.
 * Keep it that way: mutation belongs in the purpose-built scripts next door
 * (cleanup-orphaned-rag-chunks.mjs, purge-test-stripe-ids.mjs), which gate
 * every write behind --commit. This one is safe to run blind, on a phone, mid
 * incident, without re-reading it first. That is its whole point.
 *
 * WHY IT EXISTS
 * Nearly every real bug this month was found by comparing code against live
 * Firestore data — the CRM dual-id bug, the stale tenant billing pointers, the
 * legacy affiliate commission rows. Each time the loop was: write a bespoke
 * throwaway script, paste it into Cloud Shell, paste the output back. This
 * replaces that with one committed, reusable query.
 *
 * It is deliberately NOT an MCP server. The official Firebase MCP is a local
 * stdio process (there is no always-on machine to run it on) and hosted
 * third-party alternatives require handing a service-account key to a
 * Firestore holding donor names, emails, giving amounts and prayer requests.
 * Run from Cloud Shell on Application Default Credentials, NO KEY EXISTS
 * ANYWHERE and every query is visible on screen before it runs. Preserve that.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USAGE
 *   Collection query:
 *     node scripts/q.mjs <collection> [--where field=value ...] [--limit N]
 *   Single document (any depth — even segment count == a doc path):
 *     node scripts/q.mjs <collection>/<docId>
 *     node scripts/q.mjs tenants/bumb/usage/2026-07
 *   Subcollections anywhere in the tree (collectionGroup):
 *     node scripts/q.mjs invoices --group --where tenantId=bumb
 *
 *   --where f=v   repeatable. See the single-field rule below.
 *   --limit N     max docs printed. Default 20 — a stray query must never dump
 *                 the whole database into a phone terminal.
 *   --group       query collectionGroup(name) instead of a top-level
 *                 collection: much of Harvest's data lives in subcollections
 *                 (tenants/{t}/usage/{YYYY-MM}, tenants/{t}/invoices).
 *   --scan N      docs fetched before in-memory filtering when >1 --where is
 *                 given (default 500). Only relevant in that case.
 *
 * EXAMPLES (all real queries from actual debugging sessions)
 *   node scripts/q.mjs contacts --where email=miriambumb@yahoo.com
 *   node scripts/q.mjs contactActivities --where contactId=BKzF9ezNrItiLn9wjEEc
 *   node scripts/q.mjs affiliate_commissions --where status=pending --where type=initial
 *   node scripts/q.mjs tenants/bumb
 *
 * ⚠ SINGLE-FIELD QUERIES ONLY — the behaviour is the point, not a shortcut
 * This codebase deliberately avoids composite indexes: every list view filters
 * on ONE field server-side and narrows/sorts client-side (see the "no composite
 * index" comments across src/components/*). A multi-field where() would throw
 * FAILED_PRECONDITION and demand a brand-new composite index — exactly the trap
 * the repo avoids, and exactly what you do not want to hit from a phone at
 * 11pm. So: the FIRST --where becomes the Firestore where(); every additional
 * --where is applied IN MEMORY to the fetched page, and a one-line note says so.
 * If the scan cap is hit, the note says that too — the result may be partial.
 *
 * VALUES are coerced: 1785 → number, true/false → boolean, null → null,
 * everything else → string. Override explicitly with field:type=value
 * (types: number, string, bool, null) e.g. --where zip:string=90210.
 *
 * CREDENTIALS (keep any key OUTSIDE the repo, referenced by env var only):
 *   Cloud Shell / any ADC environment — nothing to set, just run it.
 *   — or — GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/sa.json node scripts/q.mjs …
 *   — or — FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" node scripts/q.mjs …
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_LIMIT = 20;
const DEFAULT_SCAN = 500;
const MAX_STRING = 200;  // per-field character budget — a phone screen is ~40 cols
const MAX_ARRAY = 8;     // beyond this, print the length instead (see: vector)

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) return cert(JSON.parse(raw));
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC (Cloud Shell, no key file).
  return applicationDefault();
}

const USAGE = `
q.mjs — read-only Firestore query (never writes; see the header)

  node scripts/q.mjs <collection> [--where field=value ...] [--limit N] [--group]
  node scripts/q.mjs <collection>/<docId>

  --where f=v   repeatable; 1st is the Firestore filter, rest are in-memory
  --limit N     max docs printed (default ${DEFAULT_LIMIT})
  --group       query collectionGroup(name) — for subcollections
  --scan N      docs fetched before in-memory filtering (default ${DEFAULT_SCAN})

  node scripts/q.mjs contacts --where email=miriambumb@yahoo.com
  node scripts/q.mjs contactActivities --where contactId=BKzF9ezNrItiLn9wjEEc
  node scripts/q.mjs affiliate_commissions --where status=pending --where type=initial
  node scripts/q.mjs tenants/bumb
`;

function fail(message) {
  console.error(`\n${message}`);
  console.error(USAGE);
  process.exit(1);
}

// ── Arg parsing ────────────────────────────────────────────────────────────
// Supports both "--limit 5" and "--limit=5"; --where may repeat.
function parseArgs(argv) {
  const out = { target: null, wheres: [], limit: DEFAULT_LIMIT, scan: DEFAULT_SCAN, group: false };

  const take = (arg, name, i) => {
    if (arg === `--${name}`) return { value: argv[i + 1], next: i + 1 };
    if (arg.startsWith(`--${name}=`)) return { value: arg.slice(name.length + 3), next: i };
    return null;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--group') { out.group = true; continue; }
    if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }

    const where = take(arg, 'where', i);
    if (where) {
      if (!where.value) fail('--where needs a value, e.g. --where status=pending');
      out.wheres.push(parseWhere(where.value));
      i = where.next;
      continue;
    }

    const limit = take(arg, 'limit', i);
    if (limit) {
      const n = Number(limit.value);
      if (!Number.isInteger(n) || n < 1) fail(`--limit must be a positive integer (got "${limit.value}")`);
      out.limit = n;
      i = limit.next;
      continue;
    }

    const scan = take(arg, 'scan', i);
    if (scan) {
      const n = Number(scan.value);
      if (!Number.isInteger(n) || n < 1) fail(`--scan must be a positive integer (got "${scan.value}")`);
      out.scan = n;
      i = scan.next;
      continue;
    }

    if (arg.startsWith('--')) fail(`Unknown flag "${arg}".`);
    if (out.target) fail(`Two targets given ("${out.target}" and "${arg}") — query one collection or document at a time.`);
    out.target = arg;
  }

  if (!out.target) fail('Nothing to query — give a collection or a document path.');
  return out;
}

// "amount=1785" → { field: 'amount', value: 1785 }
// "zip:string=90210" → { field: 'zip', value: '90210' }
function parseWhere(expr) {
  const eq = expr.indexOf('=');
  if (eq < 1) fail(`Bad --where "${expr}" — expected field=value (e.g. --where status=pending).`);

  let field = expr.slice(0, eq);
  const raw = expr.slice(eq + 1);

  let type = null;
  const colon = field.lastIndexOf(':');
  if (colon > 0) {
    type = field.slice(colon + 1).toLowerCase();
    field = field.slice(0, colon);
    if (!['number', 'string', 'bool', 'boolean', 'null'].includes(type)) {
      fail(`Unknown type "${type}" in --where "${expr}" — use number, string, bool or null.`);
    }
  }
  return { field, value: coerce(raw, type), display: `${field}${type ? `:${type}` : ''}=${raw}` };
}

// Firestore is type-strict: the string "1785" never matches the number 1785.
function coerce(raw, type) {
  if (type === 'string') return raw;
  if (type === 'null') return null;
  if (type === 'bool' || type === 'boolean') return raw === 'true';
  if (type === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) fail(`"${raw}" is not a number.`);
    return n;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw !== '' && /^-?\d+(\.\d+)?$/.test(raw) && Number.isFinite(Number(raw))) return Number(raw);
  return raw;
}

// ── Value rendering (phone-friendly) ───────────────────────────────────────
const isTimestamp = (v) => typeof v === 'object' && v !== null && typeof v.toDate === 'function';
const isDocRef = (v) => typeof v === 'object' && v !== null && typeof v.path === 'string' && typeof v.id === 'string';
const isGeoPoint = (v) => typeof v === 'object' && v !== null && typeof v.latitude === 'number' && typeof v.longitude === 'number';

function clip(s, max = MAX_STRING) {
  const flat = String(s).replace(/\s+/g, ' ');
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}… (+${flat.length - max} chars)`;
}

// One field value → one line. Big arrays (an embedding `vector` is ~3072
// floats) are reduced to their length plus a couple of samples, which is all
// you ever need to see and all a phone terminal can survive.
function renderValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return '(unset)';

  if (isTimestamp(value)) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (isDocRef(value)) return `→ ${value.path}`;
  if (isGeoPoint(value)) return `geo(${value.latitude}, ${value.longitude})`;
  if (Buffer.isBuffer(value)) return `<bytes ${value.length}>`;

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) {
      const head = value.slice(0, 3).map((v) => clip(renderValue(v), 24)).join(', ');
      return `[${value.length} items] ${head}, …truncated`;
    }
    return `[${value.map((v) => clip(renderValue(v), 40)).join(', ')}]`;
  }

  if (typeof value === 'object') return clip(JSON.stringify(shrink(value)));
  if (typeof value === 'string') return clip(value);
  return String(value);
}

// Recursively make a nested object safe to JSON.stringify for a one-line
// preview: timestamps become ISO, long arrays become "[N items]".
function shrink(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (isTimestamp(value)) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (isDocRef(value)) return `→ ${value.path}`;
  if (Buffer.isBuffer(value)) return `<bytes ${value.length}>`;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return `[${value.length} items]`;
    return value.map((v) => shrink(v, depth + 1));
  }
  if (depth >= 2) return '{…}';
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = shrink(v, depth + 1);
  return out;
}

// One block per doc: the id/path on its own line, then aligned fields.
function printDoc(path, data) {
  console.log(`\n${path}`);
  const keys = Object.keys(data);
  if (!keys.length) { console.log('  (no fields)'); return; }
  const pad = Math.min(Math.max(...keys.map((k) => k.length)), 22);
  for (const key of keys) {
    console.log(`  ${key.padEnd(pad)}  ${renderValue(data[key])}`);
  }
}

// ── In-memory filtering (the 2nd..Nth --where) ─────────────────────────────
const readPath = (data, field) => field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);

function matches(data, where) {
  const actual = readPath(data, where.field);
  if (isTimestamp(actual) && typeof where.value === 'string') return actual.toDate().toISOString() === where.value;
  return actual === where.value;
}

// ── Failure surfacing ──────────────────────────────────────────────────────
// A missing composite index is the ONE error worth reading in full: the fix is
// the console URL Firestore hands back, and this repo has had features silently
// broken by exactly that. Everything else gets a one-line message, no trace.
function explainError(error) {
  const message = error?.message || String(error);
  const isPrecondition = error?.code === 9 || /FAILED_PRECONDITION/i.test(message);
  const url = message.match(/https:\/\/\S+/)?.[0]?.replace(/[.,)]+$/, '');

  if (isPrecondition && url) {
    console.error('\n⚠ Firestore needs an index for that query (FAILED_PRECONDITION).');
    console.error('  Create it here:\n');
    console.error(`  ${url}\n`);
    console.error('  …or avoid it entirely: drop to ONE --where (the rest filter in memory).');
    return;
  }
  if (isPrecondition) {
    console.error(`\n⚠ FAILED_PRECONDITION: ${message}`);
    console.error('  Usually a missing index — try a single --where instead.');
    return;
  }
  if (error?.code === 7 || /PERMISSION_DENIED/i.test(message)) {
    console.error(`\n⚠ Permission denied reading that path: ${message}`);
    console.error('  Check the credentials in use (ADC account / service account).');
    return;
  }
  if (/Could not load the default credentials|UNAUTHENTICATED/i.test(message)) {
    console.error(`\n⚠ No usable credentials: ${message}`);
    console.error('  Run inside Cloud Shell, or set GOOGLE_APPLICATION_CREDENTIALS.');
    return;
  }
  console.error(`\n⚠ Query failed: ${message}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  initializeApp({ credential: loadCredential() });
  const db = getFirestore();

  const segments = opts.target.split('/').filter(Boolean);
  const isDocPath = !opts.group && segments.length % 2 === 0;

  // ── Single document ──────────────────────────────────────────────────────
  if (isDocPath) {
    if (opts.wheres.length) {
      console.log('NOTE: --where is ignored when a document path is given.');
    }
    const path = segments.join('/');
    const snap = await db.doc(path).get();
    if (!snap.exists) {
      console.log(`\nNo document at ${path}.`);
      console.log('  Check the id, and that the path has an even number of segments (collection/doc/collection/doc…).');
      return;
    }
    printDoc(path, snap.data() || {});
    console.log('\nTotal: 1 document.');
    return;
  }

  // ── Collection / collectionGroup query ───────────────────────────────────
  if (opts.group && segments.length !== 1) {
    fail(`--group takes a bare subcollection name (got "${opts.target}").`);
  }

  const name = segments.join('/');
  const [primary, ...extra] = opts.wheres;

  // Only ONE where() reaches Firestore, on purpose (see the header). With extra
  // filters we fetch a page and narrow it here, so nothing ever demands a new
  // composite index.
  const fetchLimit = extra.length ? Math.max(opts.scan, opts.limit) : opts.limit;
  let query = opts.group ? db.collectionGroup(name) : db.collection(name);
  if (primary) query = query.where(primary.field, '==', primary.value);
  query = query.limit(fetchLimit);

  const filters = opts.wheres.map((w) => w.display).join(' ');
  console.log(
    `\n── ${opts.group ? `collectionGroup(${name})` : name}` +
      `${filters ? ` where ${filters}` : ''} — limit ${opts.limit} ──`,
  );

  if (extra.length) {
    console.log(
      `NOTE: ${opts.wheres.length} filters given. Firestore applied only ` +
        `${primary.display}; the other ${extra.length} (${extra.map((w) => w.display).join(', ')}) ` +
        `filtered in memory over the first ${fetchLimit} doc(s) — single-field queries only, ` +
        `by design (no composite indexes in this repo).`,
    );
  }

  const snap = await query.get();

  const kept = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (extra.every((w) => matches(data, w))) kept.push({ doc, data });
    if (kept.length >= opts.limit) break;
  }

  for (const { doc, data } of kept) {
    printDoc(opts.group ? doc.ref.path : `${name}/${doc.id}`, data);
  }

  if (!kept.length) {
    console.log('\nNo documents matched.');
    if (!snap.size) {
      console.log(
        `  ${primary ? `No doc in ${name} has ${primary.display}` : `Collection "${name}" is empty or does not exist`}.` +
          ' Check the spelling, and whether the data lives in a subcollection (try --group).',
      );
    } else {
      console.log(`  ${snap.size} doc(s) matched ${primary.display} but none passed the in-memory filters.`);
    }
    return;
  }

  console.log(`\nTotal: ${kept.length} document(s) shown.`);
  if (extra.length && snap.size >= fetchLimit) {
    console.log(
      `⚠ The scan cap was reached (${fetchLimit} doc(s) fetched for in-memory filtering), ` +
        'so matches beyond it were not seen. Raise it with --scan N.',
    );
  } else if (!extra.length && snap.size >= opts.limit) {
    console.log(`(There may be more — this is the first ${opts.limit}. Raise it with --limit N.)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { explainError(e); process.exit(1); });
