import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockVerifyIdToken, mockSetCustomClaims, mockCollection } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockSetCustomClaims: vi.fn(),
  mockCollection: vi.fn(),
}));

vi.mock('@/lib/set-custom-claims', () => ({ setCustomClaims: mockSetCustomClaims }));
vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
  adminDb: { collection: mockCollection },
}));

const { POST } = await import('../route');

function makeReq(token = 'valid'): NextRequest {
  return new NextRequest('https://example.com/api/auth/migrate-claims', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockReturnValue({
    get: async () => ({ docs: [{ id: 'u1' }, { id: 'u2' }], size: 2 }),
  });
});

describe('POST /api/auth/migrate-claims', () => {
  it('returns 401 without a bearer token', async () => {
    const res = await POST(
      new NextRequest('https://example.com/api/auth/migrate-claims', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('allows a caller holding the superAdmin claim', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'x@example.com', superAdmin: true });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(mockSetCustomClaims).toHaveBeenCalledTimes(2);
  });

  it.each(['bumbmatei@proton.me', 'bumbmatei@zohomail.eu'])(
    'allows the listed super-admin email %s with no claim (bootstrapping)',
    async (email) => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email });
      const res = await POST(makeReq());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, migrated: 2 });
    },
  );

  it('allows a listed email in mixed case', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'BumbMatei@Proton.ME' });
    expect((await POST(makeReq())).status).toBe(200);
  });

  it.each([
    ['an ordinary user', 'someone@example.com'],
    ['a lookalike domain', 'bumbmatei@proton.me.evil.com'],
    ['a listed address with whitespace', ' bumbmatei@proton.me '],
    ['a missing email', undefined],
  ])('rejects %s with 403', async (_label, email) => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email });
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect(mockSetCustomClaims).not.toHaveBeenCalled();
  });

  describe('THE-45 regression', () => {
    const saved = process.env.SUPER_ADMIN_EMAILS;
    afterEach(() => {
      if (saved === undefined) delete process.env.SUPER_ADMIN_EMAILS;
      else process.env.SUPER_ADMIN_EMAILS = saved;
      vi.resetModules();
    });

    it('SUPER_ADMIN_EMAILS env var no longer lets an outsider run the migration', async () => {
      process.env.SUPER_ADMIN_EMAILS = 'attacker@example.com';
      vi.resetModules();
      const { POST: freshPost } = await import('../route');

      mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'attacker@example.com' });
      const res = await freshPost(makeReq());
      expect(res.status).toBe(403);
      expect(mockSetCustomClaims).not.toHaveBeenCalled();
    });
  });
});
