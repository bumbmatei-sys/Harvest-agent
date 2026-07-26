import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetDoc = vi.fn();
const mockUpdate = vi.fn();
const mockSetCustomUserClaims = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: {
    getUser: mockGetUser,
    setCustomUserClaims: mockSetCustomUserClaims,
  },
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: mockGetDoc,
        update: mockUpdate,
      })),
    })),
  },
}));

const { setCustomClaims } = await import('@/lib/set-custom-claims');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setCustomClaims', () => {
  it('sets claims when they differ from existing', async () => {
    mockGetDoc.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', tenantId: 't1' }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });

    await setCustomClaims('user123');

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', {
      tenantId: 't1',
      admin: true,
    });
  });

  it('skips update when claims are identical', async () => {
    mockGetDoc.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', tenantId: 't1' }),
    });
    mockGetUser.mockResolvedValue({
      customClaims: { tenantId: 't1', admin: true },
    });

    await setCustomClaims('user123');

    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('does NOT grant a global admin claim to legacy church_admin role', async () => {
    // church_admin must stay scoped to its tenant (adminEmails), not gain the
    // unscoped global admin claim — only tenantId is set.
    mockGetDoc.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'church_admin', tenantId: 't1' }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });

    await setCustomClaims('user123');

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', { tenantId: 't1' });
  });

  it('sets superAdmin for super_admin role', async () => {
    mockGetDoc.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'super_admin', tenantId: 't1' }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });

    await setCustomClaims('user123');

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', {
      tenantId: 't1',
      admin: true,
      superAdmin: true,
    });
  });

  // ─── Email-based super admin (THE-45) ────────────────────────────────────
  // firestore.rules' isSuperAdmin() passes on EITHER the superAdmin claim or a
  // listed email. The claim used to be minted only from role === 'super_admin',
  // so a listed owner with role 'user' passed the rules' email leg while holding
  // no claim — every claim-based check disagreed with the rules for that account.
  describe('email-based super admin', () => {
    for (const email of ['bumbmatei@proton.me', 'bumbmatei@zohomail.eu']) {
      it(`mints superAdmin AND admin for ${email} regardless of users-doc role`, async () => {
        // The live case: role 'user', tenantId null — exactly what
        // bumbmatei@zohomail.eu's doc looked like while it had full access.
        mockGetDoc.mockResolvedValue({
          exists: true,
          data: () => ({ role: 'user', tenantId: null }),
        });
        mockGetUser.mockResolvedValue({ email, customClaims: {} });

        await setCustomClaims('user123');

        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', {
          admin: true,
          superAdmin: true,
        });
      });
    }

    it('mints superAdmin for a listed email in mixed case (emails are compared lowercased)', async () => {
      mockGetDoc.mockResolvedValue({
        exists: true,
        data: () => ({ role: 'user' }),
      });
      mockGetUser.mockResolvedValue({ email: 'BumbMatei@Proton.ME', customClaims: {} });

      await setCustomClaims('user123');

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', {
        admin: true,
        superAdmin: true,
      });
    });

    it.each([
      ['an ordinary user', 'someone@example.com'],
      ['a lookalike domain', 'bumbmatei@proton.me.evil.com'],
      ['a listed email with surrounding whitespace', ' bumbmatei@proton.me '],
      ['a listed local-part on another domain', 'bumbmatei@gmail.com'],
      ['an empty email', ''],
      ['a missing email', undefined],
    ])('does NOT mint superAdmin for %s', async (_label, email) => {
      mockGetDoc.mockResolvedValue({
        exists: true,
        data: () => ({ role: 'user', tenantId: 't1' }),
      });
      mockGetUser.mockResolvedValue({ email, customClaims: {} });

      await setCustomClaims('user123');

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', { tenantId: 't1' });
    });

    it('reads the AUTH email, not the users-doc email copy (doc stale, auth super admin)', async () => {
      // users/{uid}.email is a copy that can go stale. The Auth record is
      // authoritative, and it is what firestore.rules sees in the token.
      mockGetDoc.mockResolvedValue({
        exists: true,
        data: () => ({ role: 'user', email: 'stale-old-address@example.com' }),
      });
      mockGetUser.mockResolvedValue({ email: 'bumbmatei@proton.me', customClaims: {} });

      await setCustomClaims('user123');

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', {
        admin: true,
        superAdmin: true,
      });
    });

    it('reads the AUTH email, not the users-doc email copy (doc super admin, auth ordinary)', async () => {
      // The inverse: a users doc claiming a super-admin email must NOT grant the
      // claim when the Auth record — the only thing the token reflects — differs.
      mockGetDoc.mockResolvedValue({
        exists: true,
        data: () => ({ role: 'user', tenantId: 't1', email: 'bumbmatei@proton.me' }),
      });
      mockGetUser.mockResolvedValue({ email: 'someone-else@example.com', customClaims: {} });

      await setCustomClaims('user123');

      expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user123', { tenantId: 't1' });
    });

    it('does not re-write when the email-derived claims are already present', async () => {
      // The "claims unchanged → no write" guard must survive the new grant, or
      // every migrate-claims run would revoke both owners' tokens for nothing.
      mockGetDoc.mockResolvedValue({
        exists: true,
        data: () => ({ role: 'user', tenantId: null }),
      });
      mockGetUser.mockResolvedValue({
        email: 'bumbmatei@proton.me',
        customClaims: { admin: true, superAdmin: true },
      });

      await setCustomClaims('user123');

      expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  it('handles missing user doc gracefully', async () => {
    mockGetDoc.mockResolvedValue({ exists: false });
    await setCustomClaims('user123');
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('removes stale claims when tenant is removed', async () => {
    mockGetDoc.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'user' }),
    });
    mockGetUser.mockResolvedValue({
      customClaims: { tenantId: 'old', admin: true },
    });

    await setCustomClaims('user123');

    expect(mockSetCustomUserClaims).toHaveBeenCalled();
  });
});
