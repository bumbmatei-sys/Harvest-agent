import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockRequireAdmin, mockGetAuthConfig, mockInitiate, mockCreateState,
  mockDeleteConnection, mockCapture, docStore, txSet,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetAuthConfig: vi.fn(),
  mockInitiate: vi.fn(),
  mockCreateState: vi.fn(() => 'signed-state'),
  mockDeleteConnection: vi.fn(),
  mockCapture: vi.fn(),
  docStore: new Map<string, Record<string, unknown> | null>(),
  txSet: vi.fn(),
}));

function makeRef(path: string): any {
  return {
    path,
    get: async () => {
      const data = docStore.get(path);
      return { exists: data != null, data: () => data ?? undefined };
    },
    collection: (name: string) => makeCollection(`${path}/${name}`),
  };
}
function makeCollection(path: string) {
  return { doc: (id: string) => makeRef(`${path}/${id}`) };
}

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeCollection(name),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => fn({
      get: async (ref: { path: string }) => {
        const data = docStore.get(ref.path);
        return { exists: data != null, data: () => data ?? undefined };
      },
      set: txSet,
    }),
  },
}));
vi.mock('@/lib/composio-client', () => ({
  getAuthConfig: mockGetAuthConfig,
  initiateConnection: mockInitiate,
  createSignedState: mockCreateState,
  deleteConnection: mockDeleteConnection,
}));

/* 🔴 THE-339 — `GMAIL_FEATURE_ENABLED` is false on disk, and the switch sits
   AHEAD of every other gate by design, so without this mock the Gmail surface
   this file exists to measure would simply be absent and the assertions below
   would be about nothing.

   ⚠️ MOCKED RATHER THAN THE ASSERTIONS LOWERED, exactly as THE-335's newsletter
   switch is mocked where a suite has to keep measuring a hidden composition.
   The behaviour here is what must come back UNCHANGED when Gmail returns with an
   inbox, so it stays fully asserted; that the surface is GONE while the switch
   is off is asserted in `THE-339.gmail-hidden.test.ts`. */
vi.mock('@/lib/gmail-feature', () => ({
  GMAIL_FEATURE_ENABLED: true,
  GMAIL_HIDDEN_MESSAGE: 'Gmail sending is temporarily unavailable.',
  GMAIL_PAUSED_NOTICE:
    'Email sending from your own Gmail account is paused until the Harvest scheduler ships with an inbox.',
}));

vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: mockCapture }));

const { POST } = await import('../connect/route');

const SEND = 'https://www.googleapis.com/auth/gmail.send';

function makeReq(): NextRequest {
  return new NextRequest('https://example.com/api/composio/gmail/connect', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: 'attacker-supplied' }),
  });
}

function mockUser(overrides: object = {}) {
  return { uid: 'admin-a', email: 'a@church.org', tenantId: 'bumb', isAdmin: true, isSuperAdmin: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  docStore.clear();
  docStore.set('tenants/bumb', { name: 'Bumb Church' });
  process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID = 'ac_gmail';
  mockGetAuthConfig.mockResolvedValue({
    id: 'ac_gmail', toolkitSlug: 'gmail', isComposioManaged: false, scopes: [SEND],
  });
  mockInitiate.mockResolvedValue({ connectedAccountId: 'ca_1', redirectUrl: 'https://accounts.google.com/o/oauth2/auth?x=1' });
  mockCreateState.mockReturnValue('signed-state');
});

describe('POST /api/composio/gmail/connect', () => {
  it('starts the OAuth flow for a send-only auth config', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connectedAccountId: 'ca_1' });
    expect(mockInitiate).toHaveBeenCalledTimes(1);
  });

  it('writes the pending doc under the per-admin key {uid}_gmail', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    await POST(makeReq());

    // The tenant comes from the token, never from the request body — which
    // asked for 'attacker-supplied'.
    expect(txSet.mock.calls[0][0].path).toBe('tenants/bumb/integrations/admin-a_gmail');
    expect(txSet.mock.calls[0][1]).toMatchObject({
      connectedAccountId: 'ca_1', status: 'pending', connectedBy: 'admin-a', scopes: [SEND],
    });
    expect(mockCreateState).toHaveBeenCalledWith('bumb', 'admin-a');
  });

  it('gives two admins in one tenant two independent integration docs', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ uid: 'admin-b' }));
    await POST(makeReq());
    expect(txSet.mock.calls[0][0].path).toBe('tenants/bumb/integrations/admin-b_gmail');
  });

  // ── The scope gate ────────────────────────────────────────────────────────
  it('REFUSES to start OAuth when the auth config can read the mailbox', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockGetAuthConfig.mockResolvedValue({
      id: 'ac_gmail', toolkitSlug: 'gmail', isComposioManaged: true,
      scopes: [SEND, 'https://www.googleapis.com/auth/gmail.readonly'],
    });

    const res = await POST(makeReq());

    expect(res.status).toBe(500);
    // No consent screen is ever produced — the grant cannot be taken back once
    // a church has clicked "Allow".
    expect(mockInitiate).not.toHaveBeenCalled();
    expect(txSet).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'gmail-connect-scope-guard', tenantId: 'bumb' }),
    );
  });

  it('REFUSES an auth config that declares no scopes (Composio defaults)', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockGetAuthConfig.mockResolvedValue({
      id: 'ac_gmail', toolkitSlug: 'gmail', isComposioManaged: true, scopes: null,
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect(mockInitiate).not.toHaveBeenCalled();
  });

  it('proceeds on a Composio-managed config that is genuinely send-only', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockGetAuthConfig.mockResolvedValue({
      id: 'ac_gmail', toolkitSlug: 'gmail', isComposioManaged: true, scopes: [SEND],
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(mockInitiate).toHaveBeenCalled();
  });

  // ── State handling, mirroring the Mailchimp route ─────────────────────────
  it('returns 409 when this admin is already connected', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.set('tenants/bumb/integrations/admin-a_gmail', { status: 'active', connectedAccountId: 'ca_old' });
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect(mockInitiate).not.toHaveBeenCalled();
  });

  it('returns 409 while a connection started less than 10 minutes ago', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.set('tenants/bumb/integrations/admin-a_gmail', {
      status: 'pending', connectedAccountId: 'ca_old',
      initiatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect(mockInitiate).not.toHaveBeenCalled();
  });

  it('reaps a stale pending connection after 10 minutes and retries', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.set('tenants/bumb/integrations/admin-a_gmail', {
      status: 'pending', connectedAccountId: 'ca_stale',
      initiatedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(mockDeleteConnection).toHaveBeenCalledWith('ca_stale');
    expect(mockInitiate).toHaveBeenCalled();
  });

  // ── Guards ────────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(mockGetAuthConfig).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant does not exist', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: 'ghost' }));
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect(mockInitiate).not.toHaveBeenCalled();
  });

  it('returns 500 when the auth config env var is missing', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    delete process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID;
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect(mockInitiate).not.toHaveBeenCalled();
  });

  // ── The sending address, captured before the redirect ─────────────────────
  describe('sending address', () => {
    function makeReqWith(body: object): NextRequest {
      return new NextRequest('https://example.com/api/composio/gmail/connect', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('stores the address the admin confirmed in Settings', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser());
      await POST(makeReqWith({ senderEmail: 'Personal@Gmail.com' }));

      // Normalised on the way in, so Settings cannot show two casings of one
      // address as two accounts.
      expect(txSet.mock.calls[0][1]).toMatchObject({ senderEmail: 'personal@gmail.com' });
    });

    it('falls back to the verified token email when the client sends none', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser());
      await POST(makeReq());
      expect(txSet.mock.calls[0][1]).toMatchObject({ senderEmail: 'a@church.org' });
    });

    it('falls back rather than storing a malformed address', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser());
      await POST(makeReqWith({ senderEmail: 'a@church.org\nBcc: evil@attacker.test' }));

      expect(txSet.mock.calls[0][1]).toMatchObject({ senderEmail: 'a@church.org' });
      expect(JSON.stringify(txSet.mock.calls[0][1])).not.toContain('attacker.test');
    });

    it('records no address at all when neither source yields one', async () => {
      // The send route then refuses with a fixable instruction rather than
      // handing Composio a connection it cannot send from.
      mockRequireAdmin.mockResolvedValue(mockUser({ email: undefined }));
      await POST(makeReqWith({}));
      expect(txSet.mock.calls[0][1].senderEmail).toBeUndefined();
    });

    it('keeps each admin\'s address on their own doc', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser({ uid: 'admin-b', email: 'b@church.org' }));
      await POST(makeReqWith({ senderEmail: 'b-personal@gmail.com' }));

      expect(txSet.mock.calls[0][0].path).toBe('tenants/bumb/integrations/admin-b_gmail');
      expect(txSet.mock.calls[0][1]).toMatchObject({ senderEmail: 'b-personal@gmail.com' });
    });
  });
});
