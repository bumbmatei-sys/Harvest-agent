import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 🔴 DELETING AN ACCOUNT MUST NEVER REMOVE HALF OF IT AND REPORT SUCCESS.
 *
 * The live defect this route replaces: the client called `deleteDoc(users/{uid})`
 * — which firestore.rules DENIES for every ordinary member (`allow delete: if
 * isSuperAdmin()`) — logged the denial without throwing, and then called
 * `deleteUser`, which succeeded. Every member who deleted their account destroyed
 * their sign-in and left their profile behind, unreachable.
 *
 * ⚠️ THE TWO ASSERTIONS THAT ENCODE THE BUG:
 *   - 'stops at the document and never touches the auth user' — making the route
 *     continue to `adminAuth.deleteUser` after a failed document delete
 *     reproduces the live bug exactly and fails THAT test by name.
 *   - 'reports which step failed, and never 200s on a half-deletion' —
 *     returning 200 for a partial failure fails THAT test by name.
 */

const {
  mockRequireAuth,
  mockDocDelete,
  mockDocGet,
  mockDeleteUser,
  mockGetUser,
  mockCaptureHandledError,
  mockCollection,
  mockDoc,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockDocDelete: vi.fn(),
  mockDocGet: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockGetUser: vi.fn(),
  mockCaptureHandledError: vi.fn(),
  mockCollection: vi.fn(),
  mockDoc: vi.fn(),
}));

// adminDb.collection('users').doc(uid).{delete,get}
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => {
      mockCollection(name);
      return {
        doc: (id: string) => {
          mockDoc(id);
          return { delete: mockDocDelete, get: mockDocGet };
        },
      };
    },
  },
  adminAuth: { deleteUser: mockDeleteUser, getUser: mockGetUser },
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: mockCaptureHandledError }));

const { POST } = await import('../delete/route');

/** A Firebase-Admin-shaped rejection: `code` is what the route branches on. */
function adminError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

function makeRequest(body: unknown = { userId: 'member-1' }): NextRequest {
  return new NextRequest(
    new Request('https://grace.theharvest.app/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // A signed-in member who authenticated seconds ago.
  mockRequireAuth.mockResolvedValue({
    uid: 'member-1',
    email: 'member@church.org',
    tenantId: 't1',
    isAdmin: false,
    isSuperAdmin: false,
    authTime: NOW_SECONDS() - 10,
  });
  mockDocDelete.mockResolvedValue(undefined);
  // The read-back: after a successful delete the document is gone.
  mockDocGet.mockResolvedValue({ exists: false });
  mockDeleteUser.mockResolvedValue(undefined);
  // The read-back: after a successful delete the auth user is gone.
  mockGetUser.mockRejectedValue(adminError('auth/user-not-found'));
});

describe('POST /api/account/delete — the successful path', () => {
  it('removes BOTH the profile document and the auth user (the regression test for the whole issue)', async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, documentDeleted: true, authDeleted: true });

    // Both halves, and the right document.
    expect(mockCollection).toHaveBeenCalledWith('users');
    expect(mockDoc).toHaveBeenCalledWith('member-1');
    expect(mockDocDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteUser).toHaveBeenCalledWith('member-1');
  });

  it('deletes the document BEFORE the auth user, so a failure leaves a session that can retry', async () => {
    const order: string[] = [];
    mockDocDelete.mockImplementation(async () => { order.push('document'); });
    mockDeleteUser.mockImplementation(async () => { order.push('auth'); });

    await POST(makeRequest());

    expect(order).toEqual(['document', 'auth']);
  });

  it('treats an already-absent auth user as deleted, so a retry can finish the job', async () => {
    // The recoverable half-state: the document went, the auth delete failed, the
    // member retried. Step 1 verifies clean, step 2 finds nothing left.
    mockDeleteUser.mockRejectedValueOnce(adminError('auth/user-not-found'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, authDeleted: true });
  });
});

describe('POST /api/account/delete — a failed document delete must NOT delete the sign-in', () => {
  it('stops at the document and never touches the auth user', async () => {
    // ⚠️ THE LIVE BUG, VERBATIM: rules deny the document delete. The old client
    // swallowed this and deleted the auth user anyway.
    mockDocDelete.mockRejectedValueOnce(adminError('permission-denied', 'Missing or insufficient permissions'));

    const res = await POST(makeRequest());
    const body = await res.json();

    // The sign-in survives. This is the assertion the bug fails.
    expect(mockDeleteUser, 'the auth user was deleted after the document delete failed — this is the live bug').not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(body.step).toBe('document');
    expect(body.documentDeleted).toBe(false);
    expect(body.authDeleted).toBe(false);
    expect(body.error).toMatch(/nothing was removed/i);
  });

  it('treats a delete that silently did nothing as a failure, and still spares the auth user', async () => {
    // `delete()` resolving is not proof. The document is read back, and here it
    // is still there — the exact shape of "it did not throw, it also did not work".
    //
    // Two reads now: the route reads the profile FIRST to resolve the member's
    // tenant for the satellite sweep (THE-76), then reads it BACK after the
    // delete. This account carries no tenant, so the sweep is skipped and the
    // second read is the one under test.
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });

    const res = await POST(makeRequest());

    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect((await res.json()).step).toBe('document');
  });

  it('reports the failure to Sentry rather than only to the response', async () => {
    mockDocDelete.mockRejectedValueOnce(adminError('permission-denied'));
    await POST(makeRequest());
    expect(mockCaptureHandledError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ step: 'account-delete-document' }),
    );
  });
});

describe('POST /api/account/delete — a partial failure is loud', () => {
  it('reports which step failed, and never 200s on a half-deletion', async () => {
    // The document IS gone and the sign-in is NOT. Reporting success here would
    // be the original bug rebuilt on the server.
    mockDeleteUser.mockRejectedValueOnce(adminError('auth/internal-error', 'backend unavailable'));

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status, 'a half-deletion returned a 2xx').toBe(500);
    expect(body.success).toBeUndefined();
    expect(body.step).toBe('auth');
    // Names both halves as they really are.
    expect(body.documentDeleted).toBe(true);
    expect(body.authDeleted).toBe(false);
    expect(body.error).toMatch(/sign-in could not be removed/i);
  });

  it('also fails loudly when the auth user survives its own deletion', async () => {
    mockGetUser.mockResolvedValueOnce({ uid: 'member-1' });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.step).toBe('auth');
    expect(body.authDeleted).toBe(false);
  });
});

describe('POST /api/account/delete — who may call it', () => {
  it('rejects an unauthenticated caller before deleting anything', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockDocDelete).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('refuses to delete an account the caller does not own', async () => {
    const res = await POST(makeRequest({ userId: 'someone-else' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.step).toBe('ownership');
    expect(mockDocDelete).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('refuses a super admin deleting someone else through the self-service route', async () => {
    // No super-admin bypass here on purpose: admin-initiated removal is a
    // different flow. A bypass would add an untested cross-user delete to the
    // one route whose entire job is deleting accounts.
    mockRequireAuth.mockResolvedValueOnce({
      uid: 'platform-owner', email: 'owner@theharvest.app', tenantId: null,
      isAdmin: true, isSuperAdmin: true, authTime: NOW_SECONDS(),
    });

    const res = await POST(makeRequest({ userId: 'member-1' }));

    expect(res.status).toBe(403);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('400s when no userId is supplied', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockDocDelete).not.toHaveBeenCalled();
  });
});

describe('POST /api/account/delete — the recent-sign-in requirement survives the move to the server', () => {
  /**
   * `adminAuth.deleteUser` has NO freshness guard — the Admin SDK is
   * all-powerful by design. Without this check, moving deletion server-side
   * would let a stolen long-lived session delete an account: WEAKER than the
   * client `deleteUser` it replaces, which throws 'auth/requires-recent-login'.
   */
  it('rejects a stale session with the code the client already renders a panel for', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      uid: 'member-1', email: 'member@church.org', tenantId: 't1',
      isAdmin: false, isSuperAdmin: false,
      authTime: NOW_SECONDS() - 60 * 60, // signed in an hour ago
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe('auth/requires-recent-login');
    // Nothing deleted — a stale session is refused, not half-served.
    expect(mockDocDelete).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('accepts a sign-in from just inside the window', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      uid: 'member-1', email: 'member@church.org', tenantId: 't1',
      isAdmin: false, isSuperAdmin: false,
      authTime: NOW_SECONDS() - 4 * 60,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
  });

  it('fails closed when the token carries no auth_time at all', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      uid: 'member-1', email: 'member@church.org', tenantId: 't1',
      isAdmin: false, isSuperAdmin: false, authTime: 0,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('auth/requires-recent-login');
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});
