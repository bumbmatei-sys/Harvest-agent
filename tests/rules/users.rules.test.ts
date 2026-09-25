import { describe, it, beforeEach, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  seedBase, seedAdmin, teardownEnv,
  superAdmin, owner, fullAdmin, member, adminB, asUid,
  permsOnly, permsAllBut, permsFull,
  TENANT_A, TENANT_B, MEMBER_UID, OWNER_UID, FULL_ADMIN_UID,
} from './helpers';

const serverNow = () => firebase.firestore.FieldValue.serverTimestamp();

/**
 * users/{userId}: self-edit lock (permissions / tenantId / plan / role),
 * tenant-admin branch lock (tenantId / plan immutable; role clamp), and
 * owner protection.
 */

beforeEach(async () => {
  await seedBase();
});

afterAll(async () => {
  await teardownEnv();
});

describe('users: self-edit lock', () => {
  it('a member cannot grant themselves permissions', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ permissions: permsFull() }));
  });

  it('a member cannot change their own tenantId (tenant hop)', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ tenantId: TENANT_B }));
  });

  it('a member cannot set their own plan', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ plan: 'ministry' }));
  });

  it('a member cannot change their own role (pre-existing lock)', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ role: 'admin' }));
  });

  it('a member CAN still edit ordinary profile fields', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({ displayName: 'New Name', photoURL: 'x' }));
  });

  it('re-writing the SAME tenantId value is not treated as a change (no false lockout)', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({ tenantId: TENANT_A, displayName: 'Echo' }));
  });

  it('a limited ADMIN cannot self-escalate their own permissions (either branch)', async () => {
    await seedAdmin('limited-self', TENANT_A, permsOnly('writeArticles'));
    const db = (await asUid('limited-self')).firestore();
    await assertFails(db.doc('users/limited-self').update({ permissions: permsFull() }));
    await assertFails(db.doc('users/limited-self').update({ 'permissions.fullAccess': true }));
  });
});

describe('users: tenant-admin branch', () => {
  it('a manageAdmins admin can set a member role to admin with permissions', async () => {
    await seedAdmin('roles-admin', TENANT_A, permsOnly('manageAdmins'));
    const db = (await asUid('roles-admin')).firestore();
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({
      role: 'admin', permissions: permsOnly('writeArticles'),
    }));
  });

  it('a full-access admin can set a member role/permissions', async () => {
    const db = (await fullAdmin()).firestore();
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({
      role: 'admin', permissions: permsOnly('manageForms'),
    }));
  });

  it('an admin WITHOUT manageAdmins cannot change a member role or permissions', async () => {
    await seedAdmin('no-roles-admin', TENANT_A, permsAllBut('manageAdmins'));
    const db = (await asUid('no-roles-admin')).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ role: 'admin' }));
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ permissions: permsFull() }));
  });

  it('an admin WITHOUT manageAdmins can still edit non-privileged member fields', async () => {
    await seedAdmin('no-roles-admin-2', TENANT_A, permsAllBut('manageAdmins'));
    const db = (await asUid('no-roles-admin-2')).firestore();
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({ notes: 'pastoral note' }));
  });

  it('an admin cannot move a member into another tenant (tenantId immutable)', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ tenantId: TENANT_B }));
  });

  it('an admin cannot set a member plan', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ plan: 'plus' }));
  });

  it('an admin cannot promote to super_admin (pre-existing clamp)', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ role: 'super_admin' }));
  });

  it('a cross-tenant admin cannot touch tenant-a users', async () => {
    const db = (await adminB()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ role: 'admin' }));
  });
});

describe('users: owner protection', () => {
  it('a full-access admin cannot change the owner role or permissions', async () => {
    const db = (await fullAdmin()).firestore();
    await assertFails(db.doc(`users/${OWNER_UID}`).update({ role: 'user' }));
    await assertFails(db.doc(`users/${OWNER_UID}`).update({ permissions: permsOnly('analytics') }));
  });

  it('the owner cannot change their own role/permissions either', async () => {
    const db = (await owner()).firestore();
    await assertFails(db.doc(`users/${OWNER_UID}`).update({ permissions: permsOnly('analytics') }));
  });

  it('the owner CAN still edit their ordinary profile fields', async () => {
    const db = (await owner()).firestore();
    await assertSucceeds(db.doc(`users/${OWNER_UID}`).update({ displayName: 'Owner Name' }));
  });

  it('a super admin remains unrestricted (role, permissions, tenantId, plan)', async () => {
    const db = (await superAdmin()).firestore();
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({
      role: 'admin', permissions: permsFull(), tenantId: TENANT_B, plan: 'ministry',
    }));
    await assertSucceeds(db.doc(`users/${OWNER_UID}`).update({ role: 'user' }));
  });
});

describe('users: create/read regressions', () => {
  it('self-create with role user is allowed; role admin is not', async () => {
    const dbNew = (await asUid('brand-new-user')).firestore();
    await assertSucceeds(dbNew.doc('users/brand-new-user').set({ role: 'user', tenantId: TENANT_A, email: 'n@t.com' }));
    const dbNew2 = (await asUid('brand-new-admin')).firestore();
    await assertFails(dbNew2.doc('users/brand-new-admin').set({ role: 'admin', tenantId: TENANT_A }));
  });

  it('a tenant admin can read a member of their tenant; the member can read themselves', async () => {
    const adminDb = (await fullAdmin()).firestore();
    await assertSucceeds(adminDb.doc(`users/${MEMBER_UID}`).get());
    const selfDb = (await member()).firestore();
    await assertSucceeds(selfDb.doc(`users/${MEMBER_UID}`).get());
  });

  it('an admin keeps working when their OWN doc update touches only profile fields', async () => {
    const db = (await fullAdmin()).firestore();
    await assertSucceeds(db.doc(`users/${FULL_ADMIN_UID}`).update({ adminNavConfig: { primaryTabIds: ['dashboard'] } }));
  });
});

describe('users: newsletter consent', () => {
  const consent = (optIn: boolean, source: 'signup-email' | 'signup-google') => ({
    newsletterOptIn: optIn,
    newsletterOptInAt: serverNow(),
    newsletterOptInSource: source,
  });

  it('self-create with the three fields succeeds for both true and false', async () => {
    const optedIn = (await asUid('consent-in')).firestore();
    await assertSucceeds(optedIn.doc('users/consent-in').set({
      role: 'user', email: 'in@t.com', tenantId: TENANT_A,
      ...consent(true, 'signup-email'),
    }));
    const optedOut = (await asUid('consent-out')).firestore();
    await assertSucceeds(optedOut.doc('users/consent-out').set({
      role: 'user', email: 'out@t.com', tenantId: TENANT_A,
      ...consent(false, 'signup-google'),
    }));
  });

  it('create without the three fields still succeeds', async () => {
    const db = (await asUid('consent-absent')).firestore();
    await assertSucceeds(db.doc('users/consent-absent').set({
      role: 'user', email: 'absent@t.com', tenantId: TENANT_A,
    }));
  });

  it('create with a non-bool, a client timestamp, or a bad source fails', async () => {
    const badBool = (await asUid('consent-bad-bool')).firestore();
    await assertFails(badBool.doc('users/consent-bad-bool').set({
      role: 'user', email: 'b@t.com', tenantId: TENANT_A,
      newsletterOptIn: 'yes',
      newsletterOptInAt: serverNow(),
      newsletterOptInSource: 'signup-email',
    }));

    const badTime = (await asUid('consent-bad-time')).firestore();
    await assertFails(badTime.doc('users/consent-bad-time').set({
      role: 'user', email: 't@t.com', tenantId: TENANT_A,
      newsletterOptIn: true,
      newsletterOptInAt: firebase.firestore.Timestamp.fromDate(new Date('2020-01-15T00:00:00Z')),
      newsletterOptInSource: 'signup-email',
    }));

    const badSource = (await asUid('consent-bad-source')).firestore();
    await assertFails(badSource.doc('users/consent-bad-source').set({
      role: 'user', email: 's@t.com', tenantId: TENANT_A,
      newsletterOptIn: true,
      newsletterOptInAt: serverNow(),
      newsletterOptInSource: 'signup',
    }));
  });

  it('a member cannot update their own newsletterOptIn, At, or Source', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ newsletterOptIn: false }));
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ newsletterOptInAt: serverNow() }));
    await assertFails(db.doc(`users/${MEMBER_UID}`).update({ newsletterOptInSource: 'signup-email' }));
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({ displayName: 'Still Mine' }));
  });

  it('a tenant admin cannot rewrite a member\'s consent but can still edit an ordinary field', async () => {
    await seedAdmin('limited-crm', TENANT_A, permsOnly('manageCRM'));
    const limited = (await asUid('limited-crm')).firestore();
    await assertFails(limited.doc(`users/${MEMBER_UID}`).update({ newsletterOptIn: true }));
    await assertFails(limited.doc(`users/${MEMBER_UID}`).update({ newsletterOptInAt: serverNow() }));
    await assertFails(limited.doc(`users/${MEMBER_UID}`).update({ newsletterOptInSource: 'signup-google' }));
    await assertSucceeds(limited.doc(`users/${MEMBER_UID}`).update({ phone: '555-0100' }));

    const full = (await fullAdmin()).firestore();
    await assertFails(full.doc(`users/${MEMBER_UID}`).update({
      newsletterOptIn: false,
      newsletterOptInAt: serverNow(),
      newsletterOptInSource: 'signup-email',
    }));
    await assertSucceeds(full.doc(`users/${MEMBER_UID}`).update({ displayName: 'Edited By Admin' }));
  });

  it('a super admin can correct the three fields', async () => {
    const db = (await superAdmin()).firestore();
    await assertSucceeds(db.doc(`users/${MEMBER_UID}`).update({
      newsletterOptIn: false,
      newsletterOptInAt: serverNow(),
      newsletterOptInSource: 'signup-google',
    }));
  });
});
