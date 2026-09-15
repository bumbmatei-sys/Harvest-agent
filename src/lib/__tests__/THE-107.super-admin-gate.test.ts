import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockVerifyIdToken, mockGetDoc } from '@/test/mocks/firebase-admin';
import { stripComments } from '@/__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-107 — the super-admin gate, and the one client check that was wrong.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE-45 already pins that every surface agrees on WHO is a super admin (the
 * frozen two-address list, mirrored into `firestore.rules`). This suite pins the
 * other half: that the GATE those addresses pass through is the one the card
 * names, and that a non-super-admin cannot reach a super-admin surface through
 * it.
 *
 * ─── What the investigation found, asserted rather than narrated ─────────────
 *
 * 🔴 THE EMAIL LEG IS THE ROOT OF THE AUTHORITY, NOT A FALLBACK BEHIND THE
 * CLAIM. `set-custom-claims.ts` MINTS `superAdmin` FROM the email — so the claim
 * is downstream of the list, and a listed owner who has never had
 * `setCustomClaims` run carries no claim at all. Section 1 pins both legs
 * because removing either one is a live behaviour change, not a tidy-up.
 *
 * ⚠️ NOTHING ON ANY SURFACE CONSULTS `email_verified`. That is reported in the
 * pull request as the founder's decision to make, and it is deliberately NOT
 * asserted here in either direction: pinning its absence would freeze the
 * defect, and pinning its presence would fail the build for a rule this ticket
 * is forbidden to change.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE, and nothing here asks what is
 * in the branch's diff.
 */

const SRC = join(process.cwd(), 'src');
const code = (rel: string) => stripComments(readFileSync(join(SRC, rel), 'utf8'));

const { verifyAuth, requireSuperAdmin, requireAdmin } = await import('@/lib/api-auth');
const { SUPER_ADMIN_EMAILS } = await import('@/utils/super-admins');

function makeRequest(): NextRequest {
  const headers = new Headers();
  headers.set('authorization', 'Bearer valid');
  return new NextRequest(new Request('https://example.com/api/test', { headers }));
}

/** Sign in as a token carrying exactly these claims, with no users doc. */
function signedInAs(token: Record<string, unknown>) {
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', ...token });
  mockGetDoc.mockResolvedValue({ exists: false });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ═══ 1 · The gate, by its named mechanism ═══════════════════════════════════ */

describe('1 · the super-admin gate is the superAdmin CLAIM or the frozen email list', () => {
  it('passes on the superAdmin claim alone, with an unlisted address', async () => {
    signedInAs({ email: 'nobody@example.com', superAdmin: true });
    const user = await verifyAuth(makeRequest());
    expect(user!.isSuperAdmin, 'the claim is one of the two legs').toBe(true);
  });

  it.each([...SUPER_ADMIN_EMAILS])(
    'passes on the email leg alone for %s, with NO superAdmin claim',
    async (email) => {
      // 🔴 This is the leg that would go dead if the claim were always set. It
      // is not: `setCustomClaims` mints the claim FROM this list, so before it
      // has ever run for an owner this is the only thing that identifies them.
      signedInAs({ email, superAdmin: false, admin: false });
      const user = await verifyAuth(makeRequest());
      expect(user!.isSuperAdmin).toBe(true);
    },
  );

  it('fails when NEITHER leg is present', async () => {
    signedInAs({ email: 'nobody@example.com', admin: true });
    const user = await verifyAuth(makeRequest());
    expect(user!.isSuperAdmin).toBe(false);
  });
});

/* ═══ 2 · A non-super-admin cannot reach a super-admin surface ═══════════════ */

describe('2 · requireSuperAdmin refuses everyone who is not one', () => {
  /**
   * 🔴 THE MUTATION THIS EXISTS FOR: widen `requireSuperAdmin` to
   * `isAdmin || isSuperAdmin` — i.e. make it `requireAdmin` — and the FIRST case
   * below goes red. That widening is exactly what `api-auth.ts`'s own docblock
   * says must never happen, because the routes behind this gate span tenants and
   * have no second scoping step left to save them.
   */
  const REFUSED = [
    ['a church admin with the admin claim', { email: 'pastor@church.org', admin: true }],
    ['a tenant member with no claims at all', { email: 'member@church.org' }],
    ['a lookalike of a listed address', { email: 'bumbmatei@proton.me.evil.com', admin: true }],
    ['a listed address as a SUBSTRING of another', { email: 'notbumbmatei@proton.me' }],
    ['an explicitly false claim', { email: 'member@church.org', superAdmin: false }],
  ] as const;

  it.each(REFUSED)('%s gets 403, not a user', async (_label, token) => {
    signedInAs(token);
    const result = await requireSuperAdmin(makeRequest());
    expect(result, 'a refusal must be a Response, never an AuthenticatedUser').toBeInstanceOf(
      Response,
    );
    expect((result as Response).status).toBe(403);
  });

  it('and a church admin DOES pass requireAdmin — so the two gates really differ', async () => {
    // Without this the suite above would still pass if both gates were 403 for
    // everyone, which would be a broken app rather than a secure one.
    signedInAs({ email: 'pastor@church.org', admin: true });
    expect(await requireAdmin(makeRequest())).not.toBeInstanceOf(Response);
  });

  it.each([...SUPER_ADMIN_EMAILS])('but %s passes requireSuperAdmin', async (email) => {
    signedInAs({ email });
    expect(await requireSuperAdmin(makeRequest())).not.toBeInstanceOf(Response);
  });

  it('an unauthenticated caller gets 401 before any super-admin question is asked', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const result = await requireSuperAdmin(makeRequest());
    expect((result as Response).status).toBe(401);
  });
});

/* ═══ 3 · The client check reads the TOKEN email, not the doc copy ═══════════ */

describe('3 · no client surface trusts a self-writable users-doc email', () => {
  /**
   * The `users/{uid}` self-edit rule fences `role`, `permissions`, `tenantId`,
   * `plan` and the affiliate fields. `email` is NOT fenced — a signed-in user
   * can write it to any string. So a super-admin test against the DOC copy is a
   * test against attacker-controlled data.
   *
   * ⚠️ It was never an escalation: `firestore.rules` reads
   * `request.auth.token.email`, which no client can write, so a forged doc field
   * bought a menu entry onto screens where every read is still denied. It is
   * fixed because a client that disagrees with the boundary is a support ticket
   * and a false alarm, not because it granted anything.
   */
  it('Profile.tsx asks isSuperAdminEmail about the Auth record, not the snapshot', () => {
    const src = code('components/Profile.tsx');
    expect(src, 'Profile.tsx must not test the self-writable doc email').not.toMatch(
      /isSuperAdminEmail\(\s*data\.email\s*\)/,
    );
    expect(src).toMatch(/isSuperAdminEmail\(\s*auth\.currentUser\?\.email\s*\)/);
  });

  it('and no other client component passes a snapshot email to isSuperAdminEmail', () => {
    // The rest of the call sites already read `auth.currentUser?.email` or the
    // `user` object from onAuthStateChanged. Both are the Auth record.
    const offenders = [
      'components/PrayerWall.tsx',
      'components/AdminCommunity.tsx',
      'components/UserMessages.tsx',
      'components/NewsTab.tsx',
      'components/AllNews.tsx',
      'components/OnboardingGate.tsx',
      'components/Profile.tsx',
      'App.tsx',
    ].filter((rel) => /isSuperAdminEmail\(\s*(?:data|snap|doc)\w*\.email/.test(code(rel)));
    expect(offenders, 'these read an email out of a Firestore snapshot').toEqual([]);
  });
});
