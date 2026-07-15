import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  mockVerifyIdToken,
  mockGetDoc,
  mockRecursiveDelete,
  mockDeleteUsers,
  mockBatchCommit,
  __setCollectionDocs,
  __resetStore,
  __applyDefaultImpls,
} from '@/test/mocks/firebase-admin';

// Dynamic import so mocks are applied first
const { DELETE } = await import('@/app/api/tenants/delete/route');

function makeRequest(token?: string, tenantId?: string, dryRun?: boolean): NextRequest {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let url = 'https://example.com/api/tenants/delete';
  const params = new URLSearchParams();
  if (tenantId) params.set('id', tenantId);
  if (dryRun) params.set('dryRun', 'true');
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return new NextRequest(new Request(url, { method: 'DELETE', headers }));
}

// Every top-level collection the cascade must clean (mirrors TENANT_COLLECTIONS in
// the route). `users` is asserted separately (it also deletes Auth accounts).
const CASCADE_COLLECTIONS = [
  'courses', 'blog_posts', 'community_posts', 'prayer_requests', 'rag_sources',
  'rag_chunks', 'contacts', 'contactActivities', 'docs', 'docFolders', 'authors',
  'categories', 'campaigns', 'churches', 'chat_usage', 'domains',
  'ai_assistant_bindings', 'twilioNumbers', 'submissions',
];

beforeEach(() => {
  vi.clearAllMocks();
  __resetStore();
  __applyDefaultImpls();
});

describe('DELETE /api/tenants/delete — auth & validation', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await DELETE(makeRequest(undefined, 't1'));
    expect(res.status).toBe(401);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('returns 403 for authenticated non-super-admin users', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1', email: 'regular@test.com', admin: true, superAdmin: false,
    });
    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(403);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
    expect(mockDeleteUsers).not.toHaveBeenCalled();
  });

  it('returns 400 when tenant id is missing', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    const res = await DELETE(makeRequest('tok'));
    expect(res.status).toBe(400);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete the platform tenant', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    // PLATFORM_TENANT_ID defaults to 'harvest'
    const res = await DELETE(makeRequest('tok', 'harvest'));
    expect(res.status).toBe(400);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
    expect(mockDeleteUsers).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant does not exist', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    mockGetDoc.mockResolvedValue({ exists: false });
    const res = await DELETE(makeRequest('tok', 'missing-tenant'));
    expect(res.status).toBe(404);
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('allows deletion when isSuperAdmin claim is false but email matches SUPER_ADMIN_EMAIL fallback', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'bumbmatei@proton.me', superAdmin: false });
    mockGetDoc.mockResolvedValue({ exists: true });
    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(200);
    // recursiveDelete still removes the tenant doc + its subcollections.
    expect(mockRecursiveDelete).toHaveBeenCalled();
  });
});

describe('DELETE /api/tenants/delete — dry run', () => {
  it('returns per-collection counts and the user list, and deletes NOTHING', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    mockGetDoc.mockResolvedValue({ exists: true });
    __setCollectionDocs('users', [
      { tenantId: 't1', email: 'a@t.com' },
      { tenantId: 't1', email: 'b@t.com' },
    ]);
    __setCollectionDocs('courses', [{ tenantId: 't1' }, { tenantId: 't1' }, { tenantId: 't1' }]);
    __setCollectionDocs('rag_chunks', Array.from({ length: 5 }, () => ({ tenantId: 't1' })));

    const res = await DELETE(makeRequest('tok', 't1', true));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.dryRun).toBe(true);
    expect(json.deleted.users).toBe(2);
    expect(json.deleted.courses).toBe(3);
    expect(json.deleted.rag_chunks).toBe(5);
    expect(json.deleted.blog_posts).toBe(0);
    expect(json.authDeleted).toBe(2);
    expect(json.userAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'a@t.com' }),
        expect.objectContaining({ email: 'b@t.com' }),
      ]),
    );

    // Nothing was actually deleted.
    expect(mockDeleteUsers).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/tenants/delete — real cascade', () => {
  it('removes docs from EVERY tenant collection and deletes Auth accounts', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    mockGetDoc.mockResolvedValue({ exists: true });
    __setCollectionDocs('users', [{ tenantId: 't1', email: 'a@t.com' }]);
    CASCADE_COLLECTIONS.forEach((n) => __setCollectionDocs(n, [{ tenantId: 't1' }]));
    // certificates are intentionally RETAINED (kept as records), not cascaded.
    __setCollectionDocs('certificates', [{ tenantId: 't1' }]);

    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.dryRun).toBe(false);
    expect(json.errors).toEqual([]);
    expect(json.deleted.users).toBe(1);
    CASCADE_COLLECTIONS.forEach((n) => expect(json.deleted[n]).toBe(1));
    // certificates must NOT be part of the cascade.
    expect(json.deleted.certificates).toBeUndefined();

    // Firebase Auth account was deleted (not just the Firestore doc).
    expect(json.authDeleted).toBe(1);
    expect(mockDeleteUsers).toHaveBeenCalledWith(['users-0']);

    // Subcollection-bearing collections + the tenant doc go via recursiveDelete
    // (community_posts, churches, tenant) so nested docs are not orphaned.
    expect(mockRecursiveDelete).toHaveBeenCalledTimes(3);
  });

  it('batches deletes for a collection with more than 500 docs', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    mockGetDoc.mockResolvedValue({ exists: true });
    __setCollectionDocs('rag_chunks', Array.from({ length: 950 }, () => ({ tenantId: 't1' })));

    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.deleted.rag_chunks).toBe(950);
    // 950 docs / 400-per-batch → 3 commits (400 + 400 + 150).
    expect(mockBatchCommit).toHaveBeenCalledTimes(3);
  });

  it('records per-uid Auth failures without aborting, and still deletes the user docs', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    mockGetDoc.mockResolvedValue({ exists: true });
    __setCollectionDocs('users', [
      { tenantId: 't1', email: 'a@t.com' },
      { tenantId: 't1', email: 'b@t.com' },
    ]);
    mockDeleteUsers.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 1,
      errors: [{ index: 1, error: { message: 'auth boom' } }],
    });

    const res = await DELETE(makeRequest('tok', 't1'));
    // Any error → 500, but with the full summary body.
    expect(res.status).toBe(500);
    const json = await res.json();

    expect(json.deleted.users).toBe(2); // both Firestore docs still removed
    expect(json.authDeleted).toBe(1);
    expect(json.errors.some((e: { step: string }) => e.step.startsWith('auth:'))).toBe(true);
  });

  it('reports partial progress when a collection delete throws (no rollback)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'admin@test.com', superAdmin: true });
    mockGetDoc.mockResolvedValue({ exists: true });
    __setCollectionDocs('courses', [{ tenantId: 't1' }]);
    // Make the tenant-doc recursiveDelete blow up; courses should still be counted.
    mockRecursiveDelete.mockRejectedValue(new Error('Firestore error'));

    const res = await DELETE(makeRequest('tok', 't1'));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.deleted.courses).toBe(1);
    expect(json.errors.some((e: { step: string }) => e.step === 'delete:tenant')).toBe(true);
  });
});
