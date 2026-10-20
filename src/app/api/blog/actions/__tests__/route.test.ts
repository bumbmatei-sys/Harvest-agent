import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { verifyAuth, dispatchBlogAction, createBlogService, AdminNotConfiguredError, assertAdminConfigured } = vi.hoisted(() => {
  class AdminNotConfiguredError extends Error {
    constructor() {
      super('FIREBASE_SERVICE_ACCOUNT is not set; admin Firestore is unavailable.');
      this.name = 'AdminNotConfiguredError';
    }
  }
  return {
    verifyAuth: vi.fn(),
    dispatchBlogAction: vi.fn(),
    createBlogService: vi.fn(() => ({})),
    AdminNotConfiguredError,
    assertAdminConfigured: vi.fn(),
  };
});

vi.mock('@/lib/firebase-admin', () => ({
  AdminNotConfiguredError,
  assertAdminConfigured,
  adminDb: {},
  adminAuth: {},
}));

vi.mock('@/lib/api-auth', () => ({ verifyAuth }));

vi.mock('@/lib/blog/firestore-store', () => ({ firestoreBlogStore: {} }));

vi.mock('@/lib/blog/firestore-confirm', () => ({
  firestoreConfirmLedger: () => ({}),
}));

vi.mock('@/lib/blog/service', () => ({
  createBlogService,
  dispatchBlogAction,
}));

const { POST, GET } = await import('../route');

const NOT_CONFIGURED = "Server isn't configured to save posts";

function post(body: unknown, raw = false): NextRequest {
  return new NextRequest('https://theharvest.app/api/blog/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function get(): NextRequest {
  return new NextRequest('https://theharvest.app/api/blog/actions?tenantId=grace');
}

beforeEach(() => {
  vi.clearAllMocks();
  assertAdminConfigured.mockImplementation(() => {});
  createBlogService.mockReturnValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/blog/actions', () => {
  it('returns 503 before auth when admin is not configured, even if verifyAuth would return null', async () => {
    assertAdminConfigured.mockImplementation(() => {
      throw new AdminNotConfiguredError();
    });
    verifyAuth.mockResolvedValue(null);
    const res = await POST(post({ action: 'publishNow', title: 'Sunday reflection' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: NOT_CONFIGURED, message: NOT_CONFIGURED });
    expect(verifyAuth).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).toContain('AdminNotConfiguredError');
    expect(line).not.toContain('Sunday reflection');
    expect(vi.mocked(console.error).mock.calls[0]).toHaveLength(1);
    expect(dispatchBlogAction).not.toHaveBeenCalled();
  });

  it('returns 503 when a later admin call still throws AdminNotConfiguredError', async () => {
    verifyAuth.mockResolvedValue({
      uid: 'user-1',
      email: 'admin@example.com',
      tenantId: 'grace',
      isAdmin: true,
      isSuperAdmin: false,
    });
    dispatchBlogAction.mockRejectedValue(new AdminNotConfiguredError());
    const res = await POST(post({ action: 'publishNow' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: NOT_CONFIGURED, message: NOT_CONFIGURED });
  });

  it('returns 503 when init fails with the default-credentials message', async () => {
    verifyAuth.mockRejectedValue(new Error('Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.'));
    const res = await POST(post({ action: 'createDraft', title: 'secret draft' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: NOT_CONFIGURED, message: NOT_CONFIGURED });
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).not.toContain('secret draft');
  });

  it('returns 500 for an UNAUTHENTICATED error that is not a missing credential', async () => {
    verifyAuth.mockResolvedValue({
      uid: 'user-1',
      email: 'admin@example.com',
      tenantId: 'grace',
      isAdmin: true,
      isSuperAdmin: false,
    });
    dispatchBlogAction.mockRejectedValue(new Error('UNAUTHENTICATED: request had invalid authentication credentials.'));
    const res = await POST(post({ action: 'publishNow', title: 'Sunday reflection' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'internal',
      message: 'Something went wrong saving the post. Try again.',
    });
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).toContain('UNAUTHENTICATED');
    expect(line).not.toContain('Sunday reflection');
  });

  it('returns 500 JSON for any other failure', async () => {
    verifyAuth.mockResolvedValue({
      uid: 'user-1',
      email: 'admin@example.com',
      tenantId: 'grace',
      isAdmin: true,
      isSuperAdmin: false,
    });
    dispatchBlogAction.mockRejectedValue(new Error('socket hang up'));
    const res = await POST(post({ action: 'publishNow', title: 'Sunday reflection' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'internal',
      message: 'Something went wrong saving the post. Try again.',
    });
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(console.error).mock.calls[0]?.[0]);
    expect(line).toContain('socket hang up');
    expect(line).not.toContain('Sunday reflection');
  });

  it('still returns 401 when the caller is signed out', async () => {
    verifyAuth.mockResolvedValue(null);
    const res = await POST(post({ action: 'publishNow' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'unauthenticated', message: 'Sign in is required.' });
    expect(console.error).not.toHaveBeenCalled();
    expect(createBlogService).not.toHaveBeenCalled();
  });

  it('still returns 400 when the body is not JSON', async () => {
    const res = await POST(post('{', true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid', message: 'The request body is not JSON.' });
    expect(verifyAuth).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('GET /api/blog/actions', () => {
  it('returns 503 before auth when admin is not configured', async () => {
    assertAdminConfigured.mockImplementation(() => {
      throw new AdminNotConfiguredError();
    });
    verifyAuth.mockResolvedValue(null);
    const res = await GET(get());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: NOT_CONFIGURED, message: NOT_CONFIGURED });
    expect(verifyAuth).not.toHaveBeenCalled();
  });

  it('returns 401 when the caller is signed out', async () => {
    verifyAuth.mockResolvedValue(null);
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'unauthenticated', message: 'Sign in is required.' });
  });
});
