import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  getEnv, seedBase, seedDoc, teardownEnv,
  owner, fullAdmin, rosterAdmin, member, adminB, superAdmin,
  TENANT_A, TENANT_B, ROSTER_ADMIN_EMAIL, OWNER_EMAIL,
} from './helpers';

/**
 * The tenant_private/{id} move: the adminEmails roster (and Stripe ids) left
 * the world-readable tenants/{id} doc for a server-only mirror, and
 * inTenantAdminEmails now get()s the mirror. These tests pin the four
 * properties the move must hold simultaneously:
 *
 *   1. The PUBLIC doc stays readable pre-auth (subdomain resolution /
 *      branding) — the reason the tenant doc rule is NOT being locked down.
 *   2. The PRIVATE doc is readable by NO client — not anonymous, not a
 *      member, not any flavor of admin, not the owner.
 *   3. Roster-based admins (email in adminEmails, no users-doc role) keep
 *      full access through the 70 hasPermission / 32 isTenantAdmin call
 *      sites — the rules' get() reads the mirror instead, which security
 *      rules do not gate.
 *   4. The rules read the roster from the MIRROR, not the public field: an
 *      email present only on the public doc grants nothing (the security
 *      property), and an email present only on the mirror grants access (the
 *      path proof — this is the test that fails if the get() path reverts).
 *
 * probe-t is the split-roster fixture for (4): its public and private
 * rosters deliberately DISAGREE. Production never looks like this (dual-write
 * + verified backfill keep parity); the split exists purely to detect which
 * doc the rules consult.
 */

const PROBE_T = 'probe-t';
const PRIVATE_ONLY_ADMIN_UID = 'probe-admin-uid';
const PRIVATE_ONLY_ADMIN_EMAIL = 'probe-admin@test.com';
const PUBLIC_ONLY_ADMIN_UID = 'decoy-admin-uid';
const PUBLIC_ONLY_ADMIN_EMAIL = 'decoy-admin@test.com';

async function privateOnlyAdmin() {
  const e = await getEnv();
  return e.authenticatedContext(PRIVATE_ONLY_ADMIN_UID, { email: PRIVATE_ONLY_ADMIN_EMAIL });
}
async function publicOnlyAdmin() {
  const e = await getEnv();
  return e.authenticatedContext(PUBLIC_ONLY_ADMIN_UID, { email: PUBLIC_ONLY_ADMIN_EMAIL });
}

beforeEach(async () => {
  await seedBase();
  // Split-roster probe tenant: the two locations deliberately disagree.
  await seedDoc(`tenants/${PROBE_T}`, {
    name: 'Probe', subdomain: PROBE_T, ownerId: 'probe-owner-uid',
    adminEmails: [PUBLIC_ONLY_ADMIN_EMAIL], // decoy: public field only
    plan: 'ministry', status: 'active',
    config: { primaryColor: '#D4AF37' },
  });
  await seedDoc(`tenant_private/${PROBE_T}`, {
    adminEmails: [PRIVATE_ONLY_ADMIN_EMAIL], // the roster the rules must use
  });
  await seedDoc(`users/${PRIVATE_ONLY_ADMIN_UID}`, {
    email: PRIVATE_ONLY_ADMIN_EMAIL, role: 'user', tenantId: PROBE_T,
  });
  await seedDoc(`users/${PUBLIC_ONLY_ADMIN_UID}`, {
    email: PUBLIC_ONLY_ADMIN_EMAIL, role: 'user', tenantId: PROBE_T,
  });
  // hasPermission-gated targets (contacts: read isTenantAdmin, write manageCRM).
  await seedDoc(`tenants/${PROBE_T}/contacts/c-1`, { name: 'Contact', tenantId: PROBE_T });
  await seedDoc(`tenants/${TENANT_A}/contacts/c-a`, { name: 'Contact A', tenantId: TENANT_A });
  await seedDoc(`tenants/${TENANT_B}/contacts/c-b`, { name: 'Contact B', tenantId: TENANT_B });
});

afterAll(async () => {
  await teardownEnv();
});

// ── 1. The pre-auth public read path still works ──────────────────────────

describe('public tenant doc stays readable (pre-auth subdomain resolution)', () => {
  it('an UNAUTHENTICATED client can read name/subdomain/branding from the tenant doc', async () => {
    const e = await getEnv();
    const snap = await assertSucceeds(
      e.unauthenticatedContext().firestore().doc(`tenants/${PROBE_T}`).get()
    );
    // The fields the pre-auth path actually needs are really there.
    expect(snap.data()?.name).toBe('Probe');
    expect(snap.data()?.subdomain).toBe(PROBE_T);
    expect(snap.data()?.config?.primaryColor).toBe('#D4AF37');
  });

  it('an authenticated member of another tenant can also read it (unchanged)', async () => {
    await assertSucceeds((await adminB()).firestore().doc(`tenants/${TENANT_A}`).get());
  });
});

// ── 2 + 3. The private mirror is readable/writable by NO client ───────────

describe('tenant_private is server-only', () => {
  it('an unauthenticated client cannot read it', async () => {
    const e = await getEnv();
    await assertFails(e.unauthenticatedContext().firestore().doc(`tenant_private/${TENANT_A}`).get());
  });

  it('a plain member cannot read it', async () => {
    await assertFails((await member()).firestore().doc(`tenant_private/${TENANT_A}`).get());
  });

  it('a full-access tenant admin cannot read or write it', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc(`tenant_private/${TENANT_A}`).get());
    await assertFails(db.doc(`tenant_private/${TENANT_A}`).update({ adminEmails: ['evil@x.com'] }));
  });

  it('a roster admin cannot read or write it (their own roster included)', async () => {
    const db = (await rosterAdmin()).firestore();
    await assertFails(db.doc(`tenant_private/${TENANT_A}`).get());
    await assertFails(db.doc(`tenant_private/${TENANT_A}`).set({ adminEmails: [ROSTER_ADMIN_EMAIL, 'evil@x.com'] }));
  });

  it('the tenant owner cannot read or write it', async () => {
    const db = (await owner()).firestore();
    await assertFails(db.doc(`tenant_private/${TENANT_A}`).get());
    await assertFails(db.doc(`tenant_private/${TENANT_A}`).update({ adminEmails: [OWNER_EMAIL] }));
  });

  it('even a super admin client cannot read it (Admin SDK only)', async () => {
    await assertFails((await superAdmin()).firestore().doc(`tenant_private/${TENANT_A}`).get());
  });

  it('a cross-tenant admin cannot read another tenant\'s roster', async () => {
    await assertFails((await adminB()).firestore().doc(`tenant_private/${TENANT_A}`).get());
  });
});

// ── 4. Roster-based admins keep full access through the switch ────────────

describe('roster admin access survives the roster-read switch', () => {
  it('a roster-based admin (email in adminEmails, no users-doc role) still passes an isTenantAdmin READ rule', async () => {
    // rosterAdmin: role 'user', no permissions map — admin purely via roster.
    await assertSucceeds((await rosterAdmin()).firestore().doc(`tenants/${TENANT_A}/contacts/c-a`).get());
  });

  it('a roster-based admin still passes a hasPermission WRITE rule', async () => {
    await assertSucceeds(
      (await rosterAdmin()).firestore().doc(`tenants/${TENANT_A}/contacts/c-a`)
        .update({ name: 'Updated by roster admin' })
    );
  });

  it('PATH PROOF: an email only on the tenant_private roster gets admin access', async () => {
    // This is the test that MUST FAIL if inTenantAdminEmails reverts to reading
    // tenants/{id}.adminEmails: probe-t's public roster does NOT contain this
    // user — only the mirror does.
    const db = (await privateOnlyAdmin()).firestore();
    await assertSucceeds(db.doc(`tenants/${PROBE_T}/contacts/c-1`).get());
    await assertSucceeds(db.doc(`tenants/${PROBE_T}/contacts/c-1`).update({ name: 'via private roster' }));
  });

  it('SECURITY PROOF: an email only on the PUBLIC adminEmails field grants nothing', async () => {
    // The world-readable field is no longer an access-control input: writing
    // yourself into it (or being left on it) must not confer admin access.
    const db = (await publicOnlyAdmin()).firestore();
    await assertFails(db.doc(`tenants/${PROBE_T}/contacts/c-1`).get());
    await assertFails(db.doc(`tenants/${PROBE_T}/contacts/c-1`).update({ name: 'via public field' }));
  });
});

// ── 5. Tenant isolation ───────────────────────────────────────────────────

describe('roster admin isolation across tenants', () => {
  it('a roster admin of tenant A still cannot read or write tenant B', async () => {
    const db = (await rosterAdmin()).firestore();
    await assertFails(db.doc(`tenants/${TENANT_B}/contacts/c-b`).get());
    await assertFails(db.doc(`tenants/${TENANT_B}/contacts/c-b`).update({ name: 'cross-tenant' }));
  });
});

// ── 6. ownerId stayed on the public doc and still works ───────────────────

describe('isTenantOwner is untouched (ownerId stays public)', () => {
  it('an owner NOT on any roster still passes a hasPermission write via ownerId', async () => {
    // Isolate the isTenantOwner leg: an owner whose email is on NO roster and
    // whose users doc has no admin role — access must come purely from
    // tenants/{id}.ownerId, which did NOT move.
    await seedDoc(`tenants/pure-owner-t`, {
      name: 'Pure', ownerId: 'pure-owner-uid', adminEmails: [],
      plan: 'ministry', status: 'active',
    });
    await seedDoc(`tenant_private/pure-owner-t`, { adminEmails: [] });
    await seedDoc(`users/pure-owner-uid`, {
      email: 'pure-owner@test.com', role: 'user', tenantId: 'pure-owner-t',
    });
    await seedDoc(`tenants/pure-owner-t/contacts/c-p`, { name: 'C', tenantId: 'pure-owner-t' });

    const e = await getEnv();
    const db = e.authenticatedContext('pure-owner-uid', { email: 'pure-owner@test.com' }).firestore();
    // contacts WRITE is hasPermission('manageCRM') — the owner passes purely
    // via the isTenantOwner leg's get() of tenants/{id}.ownerId. (The contacts
    // READ rule is isTenantAdmin, which never honored bare owners — unchanged.)
    await assertSucceeds(db.doc(`tenants/pure-owner-t/contacts/c-p`).update({ name: 'owner write' }));
  });
});
