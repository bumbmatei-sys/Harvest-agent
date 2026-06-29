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
