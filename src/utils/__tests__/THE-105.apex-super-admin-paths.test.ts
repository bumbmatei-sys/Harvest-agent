import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { LIBRARY_COURSE_COLLECTIONS } from '../library-authoring';

// Same seam `tenant-scope.test.ts` uses: a mutable `auth.currentUser`, so
// importing tenant-scope never initialises a real Firebase app.
const { authMock } = vi.hoisted(() => ({
  authMock: { currentUser: null as { email: string } | null },
}));
vi.mock('../../firebase', () => ({ auth: authMock, db: {} }));

const {
  getTenantScope,
  getWriteTenantScope,
  getTenantIdFromHost,
  isSuperAdmin,
  PLATFORM_TENANT_ID,
} = await import('../tenant-scope');

/** An address in `SUPER_ADMIN_EMAILS` — the same one `tenant-scope.test.ts` uses. */
const SUPER_ADMIN_EMAIL = 'bumbmatei@proton.me';

function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', { configurable: true, value: { hostname } });
}

/**
 * THE-105 — the apex super-admin paths, walked.
 *
 * ─── What this ticket actually was ───────────────────────────────────────────
 *
 * An INVESTIGATION: nobody had walked the apex super-admin screens by hand. The
 * outcome was that they work — and "they all work" is only worth anything if the
 * property that makes them work is written down, because the NEXT edit is what
 * breaks it. This suite is that write-down.
 *
 * ─── 🔴 THE PROPERTY, AND THE BUG CLASS IT GUARDS ────────────────────────────
 *
 * `getTenantIdFromHost()` returns null on the apex BY DESIGN, and a super admin
 * there legitimately carries `tenantId: null`. So on every apex path, null means
 * "unscoped — show me everything", NEVER "something went wrong".
 *
 * ⚠️ Treating that null as an error is exactly what made a real person invisible
 * in #493. So each read below is pinned in the shape that honours it:
 *
 *     const t = await getTenantScope();
 *     const q = t ? query(coll, where('tenantId', '==', t), …) : query(coll, …);
 *                                                              ^^^^^^^^^^^^^^^^
 *                       the null arm — an unscoped read, not a refusal
 *
 * A screen that grew `if (!t) return;` on one of these would still compile, still
 * pass its own tests, and silently show a super admin nothing.
 *
 * ─── The two families, and why both are here ─────────────────────────────────
 *
 * 1. PLATFORM-ONLY screens (Tenants, Library, Inbox) read top-level collections
 *    that carry no `tenantId` at all. They honour the apex by never asking.
 * 2. TENANT-SCOPED screens reached on the apex resolve through `getTenantScope`
 *    and take the null arm.
 *
 * ⚠️ NOT A CLAIM THAT THESE SCREENS RENDER PIXELS. It is a claim about the one
 * property that decides whether a super admin sees data or an empty screen —
 * which is what #493 actually was.
 */

const SRC = resolve(__dirname, '../..');
const src = (rel: string) => stripComments(readFileSync(resolve(SRC, rel), 'utf8'));

/**
 * The apex super-admin paths, ENUMERATED.
 *
 * 🔴 Listed by FILE, never by line number — THE-331 pinned
 * `AdminCommunity.tsx:491` and a deletion moved it to `:311`.
 */
const PLATFORM_ONLY: ReadonlyArray<{ screen: string; file: string; collection: string }> = [
  { screen: 'Tenants', file: 'components/AdminTenants.tsx', collection: 'tenants' },
  // 🔴 Through the CONSTANT, not a literal: the screen reads
  // `LIBRARY_COURSE_COLLECTIONS.courses`, so a literal here would assert about a
  // name the file does not contain and pass for the wrong reason.
  { screen: 'Library', file: 'components/AdminLibraryCourses.tsx', collection: 'LIBRARY_COURSE_COLLECTIONS' },
  { screen: 'Platform Inbox', file: 'components/PlatformInbox.tsx', collection: 'platform_inbox' },
];

/** Tenant-scoped screens a super admin reaches on the apex. */
const SCOPED_ON_APEX: ReadonlyArray<{ screen: string; file: string }> = [
  { screen: 'Churches', file: 'components/AdminChurches.tsx' },
  { screen: 'Inbox (submissions)', file: 'components/AdminInbox.tsx' },
  { screen: 'Blog', file: 'components/AdminBlog.tsx' },
  { screen: 'RAG sources', file: 'components/AdminRAG.tsx' },
];

describe('THE-105 · getTenantScope returns null on the apex, by design', () => {
  beforeEach(() => {
    authMock.currentUser = { email: SUPER_ADMIN_EMAIL };
    setHostname('theharvest.app');
  });

  it('the premise: this IS a super admin, and the apex HAS no host tenant', () => {
    // Guarded rather than assumed — without both, the two tests below would be
    // asserting about an ordinary user on some other domain.
    expect(isSuperAdmin()).toBe(true);
    expect(getTenantIdFromHost()).toBeNull();
  });

  it('a super admin on the apex resolves to null — an UNSCOPED read, not a failure', async () => {
    await expect(getTenantScope()).resolves.toBeNull();
  });

  it('but a WRITE on the apex never orphans — it lands on the platform tenant', async () => {
    await expect(getWriteTenantScope()).resolves.toBe(PLATFORM_TENANT_ID);
  });

  it('and on a tenant subdomain the scope is the SUBDOMAIN, super admin or not', async () => {
    // The other half of #493's boundary: the apex fallback must never follow a
    // super admin onto a church's own subdomain.
    setHostname('nations.theharvest.app');
    await expect(getTenantScope()).resolves.toBe('nations');
    await expect(getWriteTenantScope()).resolves.toBe('nations');
  });
});

describe('THE-105 · every apex super-admin path honours a null tenant', () => {
  it('the platform catalogue collections carry no tenant, by name', () => {
    // The fact the Library row above leans on, asserted at its source.
    expect(LIBRARY_COURSE_COLLECTIONS.courses).toBe('libraryCourses');
  });

  it.each(PLATFORM_ONLY)(
    '$screen reads $collection with no tenant filter at all',
    ({ file, collection }) => {
      const code = src(file);
      expect(code, `${file} no longer reads ${collection}`).toContain(collection);
      // 🔴 A tenantId filter appearing on a platform collection would scope a
      // super admin OUT of the very screen that exists to show them everything.
      expect(code, `${file} has grown a tenantId filter on a platform collection`)
        .not.toMatch(/where\(\s*['"]tenantId['"]/);
    },
  );

  it.each(SCOPED_ON_APEX)('$screen keeps the unscoped arm for a null tenant', ({ file }) => {
    const code = src(file);
    expect(code, `${file} no longer resolves a tenant scope`).toMatch(/getTenantScope\(\)/);
    // The ternary's null arm: a second `query(` with no `where('tenantId'` in it.
    // Asserted as "a conditional on the resolved tenant exists", which is the
    // shape that cannot be satisfied by an early return.
    expect(code, `${file} lost its conditional scoping`).toMatch(
      /(resolvedTenantId|tenantId|scopeTenantId|t)\s*\r?\n?\s*\?[\s\S]{0,400}?:\s*query\(/,
    );
  });

  it.each(SCOPED_ON_APEX)('$screen does NOT bail out when the tenant is null', ({ file }) => {
    const code = src(file);

    // 🔴 THE BINDING NAME IS READ FROM THE SOURCE, NEVER LISTED HERE.
    //
    // ⚠️ This guard's first version hardcoded `(resolvedTenantId|scopeTenantId)`
    // and PASSED A PLANTED `if (!tenantId) return;` in `AdminInbox.tsx` — the
    // exact #493 defect — because that file happens to name its binding
    // `tenantId`. A list of identifiers is a guess about the code; the code is
    // the authority on what it called the thing.
    //
    // 🔴 AND THE BAIL IS ATTRIBUTED TO ITS NEAREST PRECEDING BINDING, which the
    // second version got wrong in the other direction: scanning the whole file
    // for `if (!tenantId)` flagged `AdminRAG.tsx`, where those bails belong to a
    // `getWriteTenantScope()` binding of the SAME NAME and are CORRECT — a write
    // must never be orphaned on a null tenant. Read scope and write scope are
    // opposite rules, so a guard that cannot tell them apart condemns the right
    // code and would be turned off.
    const bindings = [
      ...code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(getTenantScope|getWriteTenantScope)\(\)/g),
    ].map((m) => ({ name: m[1], kind: m[2], at: m.index ?? 0 }));

    const reads = bindings.filter((b) => b.kind === 'getTenantScope');
    expect(reads.length, `${file} no longer binds the result of getTenantScope()`).toBeGreaterThan(0);

    for (const name of new Set(reads.map((r) => r.name))) {
      const bail = new RegExp(String.raw`if\s*\(\s*!\s*${name}\s*\)\s*(?:\{[^}]{0,160}?)?\b(return|continue)\b`, 'g');
      for (const hit of code.matchAll(bail)) {
        const owner = bindings
          .filter((b) => b.name === name && b.at < (hit.index ?? 0))
          .sort((a, b) => b.at - a.at)[0];
        // An early return on a falsy READ scope is the #493 defect: a super
        // admin on the apex gets a blank screen and no error to explain it.
        expect(
          owner?.kind,
          `${file} treats a null \`${name}\` from getTenantScope() as a reason to stop`,
        ).toBe('getWriteTenantScope');
      }
    }
  });
});
