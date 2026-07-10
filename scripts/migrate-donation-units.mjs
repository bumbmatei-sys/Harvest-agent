/**
 * One-time data fix for the donation-units change (BUG 2).
 *
 * Before the fix, the Stripe webhook stored `totalDonated` (on `contacts` and
 * `users`) and donation `contactActivities.amount` in CENTS, while the CRM
 * manual-add stored the SAME fields in DOLLARS. After the fix every writer uses
 * DOLLARS, so any pre-fix webhook-written value now displays 100× too high
 * (a $50 gift saved as 5000 shows as "$5,000").
 *
 * A blanket "divide everything by 100" is UNSAFE: manually-entered contacts were
 * already in dollars and must NOT be divided. This is why the field held mixed
 * units. So this script is REPORT-FIRST and only ever converts docs you name.
 *
 *   1) Dry run (default) — list every totalDonated / donation-activity amount and
 *      a heuristic hint (values that are whole-dollar multiples of 100 are the
 *      likely webhook-written CENTS values):
 *        FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" \
 *          node scripts/migrate-donation-units.mjs
 *
 *   2) Convert ONLY the docs you confirmed are in cents, by id (÷100):
 *        node scripts/migrate-donation-units.mjs --commit \
 *          --contacts=cId1,cId2 --users=uId1 --activities=aId1,aId2
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT (JSON string) or GOOGLE_APPLICATION_CREDENTIALS.
 * There is very little live data — review the dry-run list, then convert by id.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COMMIT = process.argv.includes('--commit');

function argList(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) return cert(JSON.parse(raw));
  return applicationDefault();
}

const looksLikeCents = (n) => Number.isInteger(n) && n >= 1000 && n % 100 === 0;

async function main() {
  initializeApp({ credential: loadCredential() });
  const db = getFirestore();

  const contactIds = new Set(argList('contacts'));
  const userIds = new Set(argList('users'));
  const activityIds = new Set(argList('activities'));

  // ── Report ──────────────────────────────────────────────────────────────
  const report = async (coll, field, filterType) => {
    const snap = await db.collection(coll).get();
    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data();
      if (filterType && d.type !== filterType) return;
      const v = Number(d[field]);
      if (!v) return;
      rows.push({ id: doc.id, value: v, hint: looksLikeCents(v) ? 'likely CENTS' : 'likely dollars' });
    });
    return rows;
  };

  const contacts = await report('contacts', 'totalDonated');
  const users = await report('users', 'totalDonated');
  const activities = await report('contactActivities', 'amount', 'donation');

  const dump = (label, rows) => {
    console.log(`\n${label} (${rows.length}):`);
    rows.forEach((r) => console.log(`  ${r.id}  totalDonated/amount=${r.value}  → ${r.hint}`));
  };
  dump('contacts.totalDonated', contacts);
  dump('users.totalDonated', users);
  dump('contactActivities.amount (donation)', activities);

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit and --contacts/--users/--activities=<ids> to convert (÷100).');
    return;
  }

  // ── Convert only the explicitly named docs ────────────────────────────────
  const convert = async (coll, ids, field, rows) => {
    let n = 0;
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) { console.warn(`  skip ${coll}/${id}: not found or ${field} is 0`); continue; }
      await db.collection(coll).doc(id).update({ [field]: row.value / 100 });
      console.log(`  ✔ ${coll}/${id}: ${row.value} → ${row.value / 100}`);
      n++;
    }
    return n;
  };

  console.log('\nConverting named docs (÷100):');
  const c = await convert('contacts', contactIds, 'totalDonated', contacts);
  const u = await convert('users', userIds, 'totalDonated', users);
  const a = await convert('contactActivities', activityIds, 'amount', activities);
  console.log(`\nDone. Converted ${c} contacts, ${u} users, ${a} activities.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
