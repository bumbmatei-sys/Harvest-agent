import { vi } from 'vitest';

export const mockVerifyIdToken = vi.fn();
export const mockGetUser = vi.fn();
export const mockSetCustomUserClaims = vi.fn();
export const mockGetDoc = vi.fn();
export const mockUpdate = vi.fn();
export const mockDelete = vi.fn();
export const mockRecursiveDelete = vi.fn();

const mockDocRef = () => ({
  get: mockGetDoc,
  set: vi.fn(),
  update: mockUpdate,
  delete: mockDelete,
});

const mockCollection = () => ({
  doc: vi.fn(() => mockDocRef()),
  where: vi.fn().mockReturnThis(),
  get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
});

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: {
    verifyIdToken: mockVerifyIdToken,
    getUser: mockGetUser,
    setCustomUserClaims: mockSetCustomUserClaims,
  },
  adminDb: {
    collection: vi.fn(() => mockCollection()),
    recursiveDelete: mockRecursiveDelete,
  },
}));
