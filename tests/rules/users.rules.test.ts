import { describe, it, beforeEach, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  seedBase, seedAdmin, teardownEnv,
  superAdmin, owner, fullAdmin, member, adminB, asUid,
  permsOnly, permsFull,
  TENANT_A, TENANT_B, MEMBER_UID, OWNER_UID, FULL_ADMIN_UID,
} from './helpers';

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
