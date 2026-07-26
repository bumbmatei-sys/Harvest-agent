import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mockVerifyIdToken, mockGetDoc } from '@/test/mocks/firebase-admin';

/**
 * THE-45 — every surface must agree on who is a super admin.
 *
 * Before this suite's change, four surfaces carried four different answers: the
 * client and the API each had their own copy of the email list, each extended by
 * a different env var, while firestore.rules carried a fifth literal copy that no
 * env var could reach. These tests pin the surfaces together.
 */

const { verifyAuth } = await import('@/lib/api-auth');
const { isSuperAdminEmail, SUPER_ADMIN_EMAILS } = await import('@/utils/super-admins');

function makeRequest(token = 'valid'): NextRequest {
  const headers = new Headers();
  headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(new Request('https://example.com/api/test', { headers }));
}

/** Run verifyAuth for a token carrying `email` and no super-admin claim. */
async function apiSaysSuperAdmin(email: string | null | undefined): Promise<boolean> {
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email, tenantId: 't1', admin: false });
  mockGetDoc.mockResolvedValue({ exists: false });
  const result = await verifyAuth(makeRequest());
  return result!.isSuperAdmin;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('super admin email list', () => {
  it('contains exactly the two platform-owner addresses', () => {
    expect([...SUPER_ADMIN_EMAILS]).toEqual([
      'bumbmatei@proton.me',
      'bumbmatei@zohomail.eu',
    ]);
  });

  it('is frozen, so nothing can push onto it at runtime', () => {
    expect(Object.isFrozen(SUPER_ADMIN_EMAILS)).toBe(true);
    expect(() => {
      (SUPER_ADMIN_EMAILS as string[]).push('attacker@example.com');
    }).toThrow();
    expect(SUPER_ADMIN_EMAILS).toHaveLength(2);
  });

  it('keeps bumbmatei@proton.me first — tenant-scope.ts reads [0] positionally', () => {
    // src/utils/tenant-scope.ts:11 does SUPER_ADMIN_EMAILS[0]. Reordering the list
    // would silently repoint that backward-compatible export at the other owner.
    expect(SUPER_ADMIN_EMAILS[0]).toBe('bumbmatei@proton.me');
  });

  it('matches the literal list hardcoded in firestore.rules isSuperAdmin()', async () => {
    // firestore.rules cannot import from src/, so its copy is verified by reading
    // it. If this fails, the rules and the app have drifted — fix the rules.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const rules = await fs.readFile(path.join(process.cwd(), 'firestore.rules'), 'utf8');
    const match = rules.match(/tokenEmail\(\) in \[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const rulesEmails = match![1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(rulesEmails).toEqual([...SUPER_ADMIN_EMAILS]);
  });
});

describe('client and API agree on isSuperAdminEmail', () => {
  // Parameterised over both literals, a non-super-admin, mixed case, empty and
  // the nullish inputs. The API surface is exercised through verifyAuth, which
  // is where api-auth's copy of the check used to live.
  it.each([
    ['first literal', 'bumbmatei@proton.me', true],
    ['second literal', 'bumbmatei@zohomail.eu', true],
    ['first literal, mixed case', 'BumbMatei@Proton.ME', true],
    ['second literal, upper case', 'BUMBMATEI@ZOHOMAIL.EU', true],
    ['a non-super-admin', 'someone@example.com', false],
    ['a lookalike domain', 'bumbmatei@proton.me.evil.com', false],
    ['a listed address with whitespace', ' bumbmatei@proton.me ', false],
    ['an empty string', '', false],
    ['null', null, false],
    ['undefined', undefined, false],
  ] as const)('%s → %s on both surfaces', async (_label, email, expected) => {
    expect(isSuperAdminEmail(email)).toBe(expected);
    expect(await apiSaysSuperAdmin(email)).toBe(expected);
  });

  it('still honours the superAdmin claim independently of the email list', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'someone@example.com', tenantId: 't1', superAdmin: true,
    });
    mockGetDoc.mockResolvedValue({ exists: false });
    const result = await verifyAuth(makeRequest());
    expect(result!.isSuperAdmin).toBe(true);
  });
});

describe('env vars grant nothing (THE-45 regression)', () => {
  const ENV_KEYS = ['SUPER_ADMIN_EMAILS', 'NEXT_PUBLIC_SUPER_ADMIN_EMAILS'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it.each(ENV_KEYS)('%s cannot add a super admin on either surface', async (key) => {
    process.env[key] = 'attacker@example.com';
    // Re-import from scratch: the env read used to happen at module-import time,
    // so a stale module instance would hide the regression.
    vi.resetModules();
    const fresh = await import('@/utils/super-admins');
    const freshApi = await import('@/lib/api-auth');

    expect(fresh.isSuperAdminEmail('attacker@example.com')).toBe(false);
    expect([...fresh.SUPER_ADMIN_EMAILS]).toEqual([
      'bumbmatei@proton.me',
      'bumbmatei@zohomail.eu',
    ]);

    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'attacker@example.com', tenantId: 't1', admin: false,
    });
    mockGetDoc.mockResolvedValue({ exists: false });
    const result = await freshApi.verifyAuth(makeRequest());
    expect(result!.isSuperAdmin).toBe(false);
  });

  it('both env vars set at once still grant nothing', async () => {
    process.env.SUPER_ADMIN_EMAILS = 'a@example.com';
    process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS = 'b@example.com';
    vi.resetModules();
    const fresh = await import('@/utils/super-admins');

    expect(fresh.isSuperAdminEmail('a@example.com')).toBe(false);
    expect(fresh.isSuperAdminEmail('b@example.com')).toBe(false);
    expect(fresh.SUPER_ADMIN_EMAILS).toHaveLength(2);
  });
});
