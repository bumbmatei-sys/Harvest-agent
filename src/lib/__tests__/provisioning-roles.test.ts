import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ALL_ROLES,
  PROVISIONED_TENANT_OWNER_ROLE,
  ROLE_ADMIN,
  ROLE_CHURCH_ADMIN,
  ROLE_MEMBER,
  ROLE_STANDALONE_AI_USER,
  ROLE_SUPER_ADMIN,
  TENANT_ADMIN_ROLES,
  isTenantAdminRole,
} from '../roles';
import { resolvePostAuthFunnelRoute } from '../../utils/post-auth-route';

/**
 * THE-219's GUARD — the structural half.
 *
 * 🔴 THE SHAPE THIS EXISTS FOR, IN THE FOUNDER'S WORDS: "I don't want to see it
 * happen again in the future."
 *
 * A role written by one provisioning path and not recognised by another fails
 * SILENTLY. Nothing errors; the account is simply shown a smaller product. That
 * is what made THE-219 hard to see, and it is a shape, not an instance — so the
 * guard is about the shape.
 *
 * ⚠️ THE AUDIT FOUND NO INVENTED VALUE. Free, Dodo and Stripe all already wrote
 * `'admin'`, with an identical field set, and every identity reader accepts it.
 * The bug was the LANDING (App.tsx), not the role. What was missing was anything
 * HOLDING that agreement: three string literals in three files that happened to
 * match. These tests are that hold.
 *
 * ⚠️ EVERY TARGET BELOW IS NAMED BY LABEL — "free signup", "the news feed's
 * post-management gate" — never by scanning for a value pattern. A list built
 * by matching `role: '…'` would quietly stop covering a path that spelled its
 * write differently, which is precisely the failure being guarded against.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with comments stripped. These are claims about what a module DOES;
 * several of the files below explain role handling at length in prose, and
 * matching an explanation of a write is not the same as matching a write.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── The paths that assign a role, by label ────────────────────────────────── */

/**
 * Every path that creates a tenant and assigns its owner a role.
 *
 * 🔴 THE WHOLE LIST, ON PURPOSE. A guard covering only the free lane would
 * re-create THE-219 for the next paid one, so the two money-path files are in
 * scope here even though their hash pins had to be regenerated to allow it.
 */
const TENANT_PROVISIONING_PATHS = [
  { label: 'free signup', file: 'src/lib/free-provisioning.ts' },
  { label: 'paid signup — Dodo', file: 'src/lib/dodo/provisioning.ts' },
  { label: 'paid signup — Stripe webhook', file: 'src/app/api/stripe/webhook/route.ts' },
] as const;

/**
 * Paths that write a role WITHOUT making anyone a tenant owner. Listed so the
 * inventory is complete and so "writes a role" is never confused with "grants
 * admin" — the detach path and the standalone-assistant purchase both write a
 * role, and neither may confer anything.
 */
const NON_OWNER_ROLE_WRITERS = [
  { label: 'account signup (pre-provisioning)', file: 'src/components/AuthPage.tsx', writes: ROLE_MEMBER },
  { label: 'church onboarding — the user doc it creates', file: 'src/components/ChurchOnboarding.tsx', writes: ROLE_MEMBER },
  { label: 'tenant deletion — detaching its members', file: 'src/app/api/tenants/delete/route.ts', writes: ROLE_MEMBER },
  { label: 'standalone AI assistant purchase', file: 'src/app/api/stripe/webhook/route.ts', writes: ROLE_STANDALONE_AI_USER },
] as const;

/**
 * 🔴 THE INVITED ADMIN WRITES NO ROLE AT ALL, and that is the point of listing
 * it. Admin seats are granted by ROSTER MEMBERSHIP (`tenant_private.adminEmails`)
 * — an entitlement that does not live on the user document. Any guard that
 * assumed "admin ⇒ an admin role was written" would be wrong about this path,
 * and any reader that demands a role alone silently refuses it (THE-64/THE-83).
 */
const ROSTER_GRANTED_PATHS = [
  { label: 'invited admin — added to the roster', file: 'src/app/api/tenants/save/route.ts' },
] as const;

/* ── The readers, by label ─────────────────────────────────────────────────── */

/**
 * Readers that answer "is this role, on its own, a tenant admin?" — the
 * question a provisioning path's write has to survive. Each runs the REAL
 * predicate where it is importable.
 */
const IDENTITY_READERS = [
  { label: 'the shared role predicate', accepts: (role: string) => isTenantAdminRole(role) },
  {
    label: "App.tsx's post-auth admin check",
    file: 'src/App.tsx',
    accepts: (role: string) => isTenantAdminRole(role),
  },
  {
    label: "OnboardingGate's first-run admin check",
    file: 'src/components/OnboardingGate.tsx',
    accepts: (role: string) => isTenantAdminRole(role),
  },
  {
    label: "verifyAuth's user-doc role promotion",
    file: 'src/lib/api-auth.ts',
    accepts: (role: string) => isTenantAdminRole(role),
  },
  {
    label: "the CRM's tenant-admin roster listing",
    file: 'src/hooks/queries/useTenantQueries.ts',
    accepts: (role: string) => isTenantAdminRole(role),
  },
] as const;

/**
 * Readers that still spell the accepted set inline. They are checked as SOURCE
 * — each must mention every value the vocabulary calls a tenant admin — so
 * changing a value in `roles.ts` without teaching them fails here.
 */
const INLINE_IDENTITY_READERS = [
  { label: "the prayer wall's admin badge", file: 'src/components/PrayerWall.tsx' },
  { label: "the profile screen's admin detection", file: 'src/components/Profile.tsx' },
  { label: "direct messages' admin gate", file: 'src/components/UserMessages.tsx' },
  { label: "the community screen's admin gate", file: 'src/components/AdminCommunity.tsx' },
] as const;

/**
 * 🔴 READERS THAT DELIBERATELY ACCEPT ONLY THE LEGACY LABEL, each with a
 * documented fallback that admits everyone else. These are NOT broken, and
 * "fixing" one by adding the provisioned owner role would change what that role
 * is permitted to do — which THE-219 explicitly may not.
 */
const ROSTER_OR_PERMISSION_BACKED_READERS = [
  {
    label: "the admin nav's roster-independence check",
    file: 'src/components/AdminDashboard.tsx',
    pins: "const hasRosterIndependentAccess = isSuperAdmin || userRole === 'church_admin' || !!perms.fullAccess;",
    fallback: 'the roster lookup, which is what grants the provisioned owner',
  },
  {
    label: "the news feed's post-management gate",
    file: 'src/components/NewsTab.tsx',
    pins: "let manage = isSuper || role === 'church_admin' || perms.fullAccess === true || perms.createPosts === true;",
    fallback: 'the fullAccess / createPosts permissions',
  },
  {
    label: "the all-news screen's post-management gate",
    file: 'src/components/AllNews.tsx',
    pins: "let manage = isSuper || role === 'church_admin' || perms.fullAccess === true || perms.createPosts === true;",
    fallback: 'the fullAccess / createPosts permissions',
  },
] as const;

/* ── 3 ─────────────────────────────────────────────────────────────────────── */

describe('3 — every provisioning path writes a role that every reader accepts', () => {
  it('every provisioning path writes a role that every reader accepts', () => {
    // One value, checked against every identity reader — the invariant THE-219
    // was suspected of breaking, now asserted rather than assumed.
    for (const reader of IDENTITY_READERS) {
      expect(
        reader.accepts(PROVISIONED_TENANT_OWNER_ROLE),
        `${reader.label} refuses the role every provisioning path writes`,
      ).toBe(true);
    }
    for (const reader of INLINE_IDENTITY_READERS) {
      const code = codeOf(read(reader.file));
      for (const role of TENANT_ADMIN_ROLES) {
        expect(code, `${reader.label} does not recognise "${role}"`).toContain(`'${role}'`);
      }
    }
  });

  it.each(TENANT_PROVISIONING_PATHS)(
    '$label writes the shared owner role rather than a literal of its own',
    ({ file }) => {
      const code = codeOf(read(file));
      expect(code).toMatch(/from ['"]@\/lib\/roles['"]/);
      // 🔴 Checked with the import lines REMOVED. Importing the constant and
      // then writing a literal anyway is the exact regression this guards, and
      // it satisfies a naive `toContain` on the whole file — the import alone
      // mentions the name.
      const body = code.replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
      expect(body, 'the owner role is imported but not the value written').toMatch(
        /\brole:\s*PROVISIONED_TENANT_OWNER_ROLE\b/,
      );
    },
  );

  it.each(NON_OWNER_ROLE_WRITERS)(
    '$label writes a recognised role, and it is not the owner role',
    ({ writes }) => {
      expect(ALL_ROLES as readonly string[]).toContain(writes);
      // 🔴 Writing a role is not granting admin. The detach path and the
      // standalone purchase must never hand out tenant ownership.
      expect(writes).not.toBe(PROVISIONED_TENANT_OWNER_ROLE);
      expect(isTenantAdminRole(writes)).toBe(false);
    },
  );

  it.each(ROSTER_GRANTED_PATHS)('$label grants by roster and writes no role', ({ file }) => {
    const code = codeOf(read(file));
    expect(code, 'the invited-admin path started writing a role').not.toMatch(/\brole:\s*['"]/);
    expect(code).toContain('adminEmails');
  });

  it.each(ROSTER_OR_PERMISSION_BACKED_READERS)(
    '$label is still narrow on purpose, and still has its fallback',
    ({ file, pins }) => {
      // Widening one of these is the permission change THE-219 must not make.
      expect(read(file)).toContain(pins);
    },
  );
});

/* ── 4 ─────────────────────────────────────────────────────────────────────── */

describe('4 — role values come from one source, and a path cannot invent one', () => {
  it('role values come from one source, and a path cannot invent one', () => {
    // 🔴 The structural half: a provisioning path has NOTHING to write but the
    // shared constant, because it no longer contains a role literal to write.
    for (const { label, file } of TENANT_PROVISIONING_PATHS) {
      const code = codeOf(read(file));
      const literals = code.match(/\brole:\s*['"][^'"]*['"]/g) ?? [];
      const invented = literals.filter((l) => !l.includes(ROLE_STANDALONE_AI_USER));
      expect(invented, `${label} spells a role literal instead of importing one`).toEqual([]);
    }
  });

  it('the vocabulary is closed — every recognised role is distinct and accounted for', () => {
    const known = ALL_ROLES as readonly string[];
    expect(new Set(known).size, 'two role constants share a value').toBe(known.length);
    // Every constant this module exports is in the vocabulary…
    for (const role of [ROLE_MEMBER, ROLE_ADMIN, ROLE_CHURCH_ADMIN, ROLE_SUPER_ADMIN, ROLE_STANDALONE_AI_USER]) {
      expect(known).toContain(role);
    }
    // …and the owner role is one of the admin roles, not a fourth thing.
    expect(TENANT_ADMIN_ROLES as readonly string[]).toContain(PROVISIONED_TENANT_OWNER_ROLE);
  });

  it('an invented role is refused by every identity reader', () => {
    // The negative case, so the assertions above cannot pass vacuously.
    const invented = 'church_owner';
    expect(ALL_ROLES as readonly string[]).not.toContain(invented);
    for (const reader of IDENTITY_READERS) {
      expect(reader.accepts(invented), `${reader.label} accepted an invented role`).toBe(false);
    }
  });

  it('the legacy label is still accepted, and still writable by nobody', () => {
    // Live accounts hold it, so every reader must keep taking it…
    expect(isTenantAdminRole(ROLE_CHURCH_ADMIN)).toBe(true);
    // …and the post-auth funnel still routes it to the church flow.
    expect(
      resolvePostAuthFunnelRoute({
        onAffiliateHost: false,
        confirmedTenantless: false,
        churchSignupIntent: false,
        planSignupIntent: false,
        isChurchAdminRole: true,
      }),
    ).toBe('/church-onboarding');
    // …but no provisioning path writes it, so nothing new arrives carrying it.
    expect(PROVISIONED_TENANT_OWNER_ROLE).not.toBe(ROLE_CHURCH_ADMIN);
    for (const { file } of TENANT_PROVISIONING_PATHS) {
      expect(codeOf(read(file))).not.toContain(`'${ROLE_CHURCH_ADMIN}'`);
    }
  });

  it('roles.ts is the only module that names these values as constants', () => {
    // A second vocabulary is how two paths drift apart while both look correct.
    const rolesSrc = read('src/lib/roles.ts');
    for (const role of ALL_ROLES as readonly string[]) {
      expect(rolesSrc).toContain(`'${role}'`);
    }
    expect(codeOf(rolesSrc)).toMatch(/export const PROVISIONED_TENANT_OWNER_ROLE = ROLE_ADMIN;/);
  });
});
