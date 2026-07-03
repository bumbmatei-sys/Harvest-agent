import { readFileSync } from 'fs';
import path from 'path';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  RulesTestContext,
} from '@firebase/rules-unit-testing';

/**
 * Shared fixture for firestore.rules tests.
 *
 * Actor matrix (all in tenant-a unless noted):
 *  - superAdmin   platform super admin (token superAdmin claim)
 *  - owner        tenant-a buyer: tenants/tenant-a.ownerId + adminEmails roster
 *  - fullAdmin    role admin, permissions.fullAccess = true
 *  - rosterAdmin  no users doc at all — admin purely via tenants adminEmails
 *                 (legacy full-access shape; must never lose access)
 *  - limited(perm) role admin holding ONLY `perm` (every other flag false)
 *  - allBut(perm)  role admin holding every flag EXCEPT `perm`
 *  - member       role user, tenant-a
 *  - adminB       full-access admin of tenant-b (cross-tenant attacker)
 */

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';

export const OWNER_UID = 'owner-a-uid';
export const OWNER_EMAIL = 'owner-a@test.com';
export const FULL_ADMIN_UID = 'full-admin-uid';
export const ROSTER_ADMIN_UID = 'roster-admin-uid';
export const ROSTER_ADMIN_EMAIL = 'roster-admin@test.com';
export const MEMBER_UID = 'member-uid';
// A SECOND plain member of tenant-a — same tenant as MEMBER_UID, but not
// automatically a channel member / DM participant. Used to prove private
// messaging isolation: belonging to the tenant is NOT enough to read a channel
// or DM you weren't added to.
export const MEMBER2_UID = 'member2-uid';
export const ADMIN_B_UID = 'admin-b-uid';
export const SUPER_ADMIN_UID = 'super-admin-uid';

// The 23 catalog keys — keep in sync with PERMISSION_CATEGORIES in
// src/components/AnalyticsAndRoles.tsx.
export const ALL_PERMISSION_KEYS = [
  'writeArticles', 'createPosts', 'createCourses', 'uploadRag', 'manageNewsletter', 'manageDocs',
  'modifyChurches', 'manageCRM', 'manageCommunity', 'manageForms', 'manageFundraising',
  'manageAccounting', 'manageGivingStatements',
  'manageEvents', 'manageCheckin', 'manageQR', 'manageLivestream', 'manageSms',
  'analytics', 'manageAdmins', 'manageBranding', 'manageAffiliate', 'manageSettings',
] as const;
export type PermKey = (typeof ALL_PERMISSION_KEYS)[number];

export function permsNone(): Record<string, unknown> {
  const p: Record<string, unknown> = { fullAccess: false, analyticsLocations: [], postRegions: [] };
  for (const k of ALL_PERMISSION_KEYS) p[k] = false;
  return p;
}

export function permsOnly(...keys: PermKey[]): Record<string, unknown> {
  const p = permsNone();
  for (const k of keys) p[k] = true;
  return p;
}

export function permsAllBut(...except: PermKey[]): Record<string, unknown> {
  const p = permsNone();
  for (const k of ALL_PERMISSION_KEYS) p[k] = true;
  for (const k of except) p[k] = false;
  return p;
}

export function permsFull(): Record<string, unknown> {
  const p = permsAllBut();
  p.fullAccess = true;
  return p;
}

let env: RulesTestEnvironment | null = null;

export async function getEnv(): Promise<RulesTestEnvironment> {
  if (env) return env;
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      // FIRESTORE_EMULATOR_HOST is set by `firebase emulators:exec`; the SDK
      // picks it up automatically.
    },
  });
  return env;
}

export async function teardownEnv(): Promise<void> {
  if (env) {
    await env.cleanup();
    env = null;
  }
}

/** Wipe data and re-seed the two tenants + the fixed actors. */
export async function seedBase(): Promise<void> {
  const e = await getEnv();
  await e.clearFirestore();
  await e.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`tenants/${TENANT_A}`).set({
      name: 'Tenant A', ownerId: OWNER_UID, adminEmails: [OWNER_EMAIL, ROSTER_ADMIN_EMAIL],
      plan: 'ministry', status: 'active',
    });
    await db.doc(`tenants/${TENANT_B}`).set({
      name: 'Tenant B', ownerId: 'owner-b-uid', adminEmails: ['owner-b@test.com'],
      plan: 'ministry', status: 'active',
    });
    // Realistic owner shape: the Stripe webhook promotes the buyer with role
    // 'admin' and NO permissions map — the owner must pass every gate purely
    // via tenants/{t}.ownerId (+ adminEmails), never via permission flags.
    await db.doc(`users/${OWNER_UID}`).set({
      email: OWNER_EMAIL, role: 'admin', tenantId: TENANT_A,
    });
    await db.doc(`users/${FULL_ADMIN_UID}`).set({
      email: 'full-admin@test.com', role: 'admin', tenantId: TENANT_A, permissions: permsFull(),
    });
    // ROSTER_ADMIN models the legacy adminEmails-only admin: an ordinary users
    // doc (role 'user', NO permissions map) whose admin-ness comes purely from
    // the tenants/{t}.adminEmails roster — must always count as full access.
    await db.doc(`users/${ROSTER_ADMIN_UID}`).set({
      email: ROSTER_ADMIN_EMAIL, role: 'user', tenantId: TENANT_A,
    });
    await db.doc(`users/${MEMBER_UID}`).set({
      email: 'member@test.com', role: 'user', tenantId: TENANT_A,
    });
    await db.doc(`users/${MEMBER2_UID}`).set({
      email: 'member2@test.com', role: 'user', tenantId: TENANT_A,
    });
    await db.doc(`users/${ADMIN_B_UID}`).set({
      email: 'admin-b@test.com', role: 'admin', tenantId: TENANT_B, permissions: permsFull(),
    });
  });
}

/** Seed (or replace) an admin users doc with an arbitrary permissions map. */
export async function seedAdmin(uid: string, tenantId: string, permissions: Record<string, unknown>): Promise<void> {
  const e = await getEnv();
  await e.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`users/${uid}`).set({
      email: `${uid}@test.com`, role: 'admin', tenantId, permissions,
    });
  });
}

/** Seed an arbitrary document bypassing rules (for update/delete targets). */
export async function seedDoc(docPath: string, data: Record<string, unknown>): Promise<void> {
  const e = await getEnv();
  await e.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(docPath).set(data);
  });
}

// ── Actor contexts ──────────────────────────────────────────────────
// No custom claims besides email (except superAdmin): tests exercise the
// users-doc/adminEmails paths the rules fall back to before claims propagate.

export async function superAdmin(): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(SUPER_ADMIN_UID, { email: 'platform@test.com', superAdmin: true });
}

export async function owner(): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });
}

export async function fullAdmin(): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(FULL_ADMIN_UID, { email: 'full-admin@test.com' });
}

export async function rosterAdmin(): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(ROSTER_ADMIN_UID, { email: ROSTER_ADMIN_EMAIL });
}

export async function member(): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(MEMBER_UID, { email: 'member@test.com' });
}

export async function member2(): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(MEMBER2_UID, { email: 'member2@test.com' });
}

export async function adminB(): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(ADMIN_B_UID, { email: 'admin-b@test.com' });
}

/** An authed context for an admin previously seeded via seedAdmin(). */
export async function asUid(uid: string): Promise<RulesTestContext> {
  const e = await getEnv();
  return e.authenticatedContext(uid, { email: `${uid}@test.com` });
}
