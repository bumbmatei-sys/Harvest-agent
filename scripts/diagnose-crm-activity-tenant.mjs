/**
 * READ-ONLY diagnostic for the "CRM activities never display" bug.
 *
 * The activity WRITE (AdminCRM.tsx addActivity) stamps the doc with the
 * CONTACT's tenantId (`selected.tenantId || tenantId || PLATFORM_TENANT_ID`),
 * but the READ (useContactActivities) filters client-side on the CRM session's
 * `currentTenantId`. When those two values differ for a contact, every activity
 * doc is fetched (contactId matches) and then silently dropped before render.
 *
 * This script proves which value is which for a specific contact. It writes
 * NOTHING — it only reads and prints.
 *
 * For the reported-broken contact:
 *   FIREBASE_SERVICE_ACCOUNT="$(cat /path/outside/repo/sa.json)" \
 *     node scripts/diagnose-crm-activity-tenant.mjs --email=miriambumb@yahoo.com
 *
 * Or by name substring (matches contacts firstName/lastName, case-insensitive):
 *     node scripts/diagnose-crm-activity-tenant.mjs --name="Christ for all Nations"
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT (JSON string) or GOOGLE_APPLICATION_CREDENTIALS.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function arg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=').trim() : '';
}

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith('{')) return cert(JSON.parse(raw));
  return applicationDefault();
}

const show = (v) =>
  v === undefined ? '<missing field>' : v === null ? 'null' : v === '' ? "'' (empty string)" : `'${v}'`;

async function main() {
  const email = arg('email').toLowerCase();
  const name = arg('name').toLowerCase();
  if (!email && !name) {
    console.error('Provide --email=<addr> and/or --name=<substring>.');
    process.exit(1);
  }

  initializeApp({ credential: loadCredential() });
  const db = getFirestore();

  // Candidate contact ids come from BOTH sources the CRM merges:
  //   - `contacts` docs (manual CRM records)          → selected.id = contacts doc id
  //   - `users` docs surfaced as Member contacts      → selected.id = users doc id (uid)
  const candidates = []; // { source, id, tenantId }

  const contactsSnap = await db.collection('contacts').get();
  contactsSnap.forEach((doc) => {
    const d = doc.data();
    const em = String(d.email || '').toLowerCase();
    const nm = `${d.firstName || ''} ${d.lastName || ''}`.toLowerCase();
    if ((email && em === email) || (name && nm.includes(name))) {
      candidates.push({ source: 'contacts', id: doc.id, tenantId: d.tenantId, email: d.email, name: nm.trim() });
    }
  });

  const usersSnap = await db.collection('users').get();
  usersSnap.forEach((doc) => {
    const d = doc.data();
    const em = String(d.email || '').toLowerCase();
    const nm = String(d.displayName || d.name || '').toLowerCase();
    if ((email && em === email) || (name && nm.includes(name))) {
      candidates.push({ source: 'users', id: doc.id, tenantId: d.tenantId, email: d.email, name: nm.trim() });
    }
  });

  console.log('\n=== 1) CONTACT / USER docs matched (this is `selected.tenantId`, the WRITE source) ===');
  if (!candidates.length) console.log('  (no matching contacts or users doc found)');
  candidates.forEach((c) => {
    console.log(`  [${c.source}] id=${c.id}  tenantId=${show(c.tenantId)}  email='${c.email || ''}'  name='${c.name}'`);
  });

  console.log('\n=== 2) contactActivities for each candidate id (this is the doc `tenantId` the READ filters) ===');
  for (const c of candidates) {
    const actSnap = await db.collection('contactActivities').where('contactId', '==', c.id).get();
    console.log(`  contactId=${c.id}  (${actSnap.size} activity doc(s))`);
    actSnap.forEach((doc) => {
      const d = doc.data();
      console.log(`     activity id=${doc.id}  type=${d.type}  tenantId=${show(d.tenantId)}  desc='${String(d.description || '').slice(0, 40)}'`);
    });
  }

  console.log('\n=== 3) The READ filters on the CRM session `currentTenantId` (App.tsx:132-135) ===');
  console.log("  On the apex domain as super admin  -> currentTenantId = 'harvest' (PLATFORM_TENANT_ID)");
  console.log('  On a tenant subdomain              -> currentTenantId = that subdomain tenantId');
  console.log('  Compare the value(s) in section 1/2 above against whichever host you viewed the CRM on.');
  console.log('  If they DIFFER -> mismatch confirmed. If they are EQUAL -> the cause is something else.\n');

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
