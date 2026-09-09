import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockRequireAdmin, mockExecute, mockCapture, mockAdd, docStore,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockExecute: vi.fn(),
  mockCapture: vi.fn(),
  mockAdd: vi.fn(),
  /** path -> document data (null = missing doc) */
  docStore: new Map<string, Record<string, unknown> | null>(),
}));

/**
 * Minimal Admin-SDK shim. Paths are joined with '/', so the route's two reads
 * resolve as `contacts/<id>` and `tenants/<tid>/integrations/<uid>_gmail` — the
 * per-admin key is therefore asserted by the store lookups themselves.
 */
function makeRef(path: string) {
  return {
    get: async () => {
      const data = docStore.get(path);
      return { exists: data != null, data: () => data ?? undefined };
    },
    collection: (name: string) => makeCollection(`${path}/${name}`),
  };
}
function makeCollection(path: string) {
  return {
    doc: (id: string) => makeRef(`${path}/${id}`),
    add: mockAdd,
  };
}

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeCollection(name) },
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

vi.mock('@/lib/composio-client', () => ({ executeComposioAction: mockExecute }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: mockCapture }));

const { POST } = await import('../send-email/route');

const CONTACT_ID = 'G6c04DRQwp2ngo6G9d6K';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/crm/send-email', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockUser(overrides: object = {}) {
  return { uid: 'admin-a', email: 'a@church.org', tenantId: 'bumb', isAdmin: true, isSuperAdmin: false, ...overrides };
}

const VALID_BODY = { contactId: CONTACT_ID, subject: 'Welcome', body: 'Glad to see you Sunday.' };

beforeEach(() => {
  vi.clearAllMocks();
  docStore.clear();
  docStore.set(`contacts/${CONTACT_ID}`, { tenantId: 'bumb', email: 'member@example.com', firstName: 'Ada' });
  docStore.set('tenants/bumb/integrations/admin-a_gmail', {
    status: 'active', connectedAccountId: 'ca_admin_a', connectedBy: 'admin-a',
    senderEmail: 'admin-a@church.org',
  });
  mockExecute.mockResolvedValue({ successful: true, data: { id: 'msg_1' } });
  mockAdd.mockResolvedValue({ id: 'act_1' });
});

describe('POST /api/crm/send-email', () => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated and never sends', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin and never sends', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // ── Validation ────────────────────────────────────────────────────────────
  it('rejects a missing subject or body without sending', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    expect((await POST(makeReq({ ...VALID_BODY, subject: '  ' }))).status).toBe(400);
    expect((await POST(makeReq({ ...VALID_BODY, body: '' }))).status).toBe(400);
    expect((await POST(makeReq({ subject: 'x', body: 'y' }))).status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('refuses a contact with no email address', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.set(`contacts/${CONTACT_ID}`, { tenantId: 'bumb', email: '' });
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('no_recipient');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // ── Happy path: send succeeds → activity logged ───────────────────────────
  it('sends from the admin\'s own connection and logs an "email" activity', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true, logged: true });

    expect(mockExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL',
      expect.objectContaining({ recipient_email: 'member@example.com', subject: 'Welcome' }),
      'ca_admin_a',
      'bumb',
      'admin-a',
    );

    expect(mockAdd).toHaveBeenCalledTimes(1);
    // Matches the shape the timeline already renders (contactId, tenantId, type,
    // description, createdBy, createdAt) — `type: 'email'` already exists in the
    // activity type set, so no new value was invented.
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      contactId: CONTACT_ID,
      tenantId: 'bumb',
      type: 'email',
      description: expect.stringContaining('Welcome'),
      amount: null,
      createdBy: 'admin-a',
      createdAt: expect.any(String),
    }));
  });

  it('sends the message body verbatim as plain text', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    await POST(makeReq(VALID_BODY));
    expect(mockExecute.mock.calls[0][1]).toMatchObject({
      body: 'Glad to see you Sunday.',
      is_html: false,
    });
  });

  // ── Failure must be visible, and must NOT log ─────────────────────────────
  it('does NOT log an activity when the send fails', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockExecute.mockRejectedValue(new Error('Composio action GMAIL_SEND_EMAIL failed: invalid grant'));

    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.sent).toBeUndefined();
    expect(body.error).toBeTruthy();
    // The whole point: no timeline entry for an email that never went out.
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'crm-send-email', tenantId: 'bumb' }),
    );
  });

  it('reports the send as sent-but-unlogged when only the activity write fails', async () => {
    // The inverse silent failure: the email HAS gone out, so returning an error
    // would invite the admin to send it twice.
    mockRequireAdmin.mockResolvedValue(mockUser());
    mockAdd.mockRejectedValue(new Error('firestore unavailable'));

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sent: true, logged: false });
    expect(body.warning).toBeTruthy();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'crm-send-email-log-activity' }),
    );
  });

  // ── Not connected → prompt, no send attempt ───────────────────────────────
  it('returns not_connected without attempting a send when Gmail is not linked', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.delete('tenants/bumb/integrations/admin-a_gmail');

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('not_connected');
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('treats a disconnected connection as not connected', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.set('tenants/bumb/integrations/admin-a_gmail', {
      status: 'disconnected', connectedAccountId: null,
    });
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // ── Admin A's connection is not usable by admin B ─────────────────────────
  it('does NOT let admin B send through admin A\'s connection in the same tenant', async () => {
    // Only admin-a has connected. Admin B is a full admin of the same church.
    mockRequireAdmin.mockResolvedValue(mockUser({ uid: 'admin-b' }));

    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('not_connected');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('uses admin B\'s OWN connection when they have one', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ uid: 'admin-b' }));
    docStore.set('tenants/bumb/integrations/admin-b_gmail', {
      status: 'active', connectedAccountId: 'ca_admin_b', connectedBy: 'admin-b',
      senderEmail: 'admin-b@church.org',
    });

    await POST(makeReq(VALID_BODY));

    // admin-a's account id must never appear.
    expect(mockExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL', expect.anything(), 'ca_admin_b', 'bumb', 'admin-b',
    );
  });

  // ── tenantId / uid come from the token, never the request ─────────────────
  it('IGNORES a request-supplied tenantId and uid', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    // A victim tenant with its own connected account the caller must not reach.
    docStore.set('tenants/victim/integrations/admin-a_gmail', {
      status: 'active', connectedAccountId: 'ca_victim',
    });
    docStore.set('tenants/bumb/integrations/attacker_gmail', {
      status: 'active', connectedAccountId: 'ca_attacker',
    });

    await POST(makeReq({ ...VALID_BODY, tenantId: 'victim', uid: 'attacker' }));

    expect(mockExecute).toHaveBeenCalledWith(
      'GMAIL_SEND_EMAIL', expect.anything(), 'ca_admin_a', 'bumb', 'admin-a',
    );
    const call = JSON.stringify(mockExecute.mock.calls[0]);
    expect(call).not.toContain('ca_victim');
    expect(call).not.toContain('ca_attacker');
  });

  it('IGNORES a request-supplied recipient — the address comes from the contact', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    await POST(makeReq({ ...VALID_BODY, to: 'attacker@evil.test', recipient_email: 'attacker@evil.test' }));

    expect(mockExecute.mock.calls[0][1]).toMatchObject({ recipient_email: 'member@example.com' });
    expect(JSON.stringify(mockExecute.mock.calls[0])).not.toContain('evil.test');
  });

  it('refuses to email a contact belonging to another tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: 'bumb' }));
    docStore.set(`contacts/${CONTACT_ID}`, { tenantId: 'other-church', email: 'someone@other.test' });

    const res = await POST(makeReq(VALID_BODY));
    // Indistinguishable from a genuine miss.
    expect(res.status).toBe(404);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 404 for a contact that does not exist', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser());
    docStore.delete(`contacts/${CONTACT_ID}`);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 403 for an admin with no tenant', async () => {
    mockRequireAdmin.mockResolvedValue(mockUser({ tenantId: null }));
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  // ── The sender address ────────────────────────────────────────────────────
  // Composio resolves the sender itself ONLY when `from_email` is absent, and
  // that resolution is a Gmail profile lookup Google gates behind a mailbox
  // scope this integration will never hold. Passing the address explicitly is
  // what keeps the send inside a send-only grant.
  describe('sender address', () => {
    it('passes the stored address as from_email so no profile lookup happens', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser());
      const res = await POST(makeReq(VALID_BODY));

      expect(res.status).toBe(200);
      expect(mockExecute).toHaveBeenCalledWith(
        'GMAIL_SEND_EMAIL',
        expect.objectContaining({ from_email: 'admin-a@church.org' }),
        'ca_admin_a', 'bumb', 'admin-a',
      );
    });

    it('uses each admin\'s OWN stored address', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser({ uid: 'admin-b' }));
      docStore.set('tenants/bumb/integrations/admin-b_gmail', {
        status: 'active', connectedAccountId: 'ca_admin_b', senderEmail: 'admin-b@church.org',
      });

      await POST(makeReq(VALID_BODY));

      expect(mockExecute.mock.calls[0][1]).toMatchObject({ from_email: 'admin-b@church.org' });
      // Admin A's address must never appear on admin B's message.
      expect(JSON.stringify(mockExecute.mock.calls[0])).not.toContain('admin-a@church.org');
    });

    it('IGNORES a request-supplied from_email — it comes from the integration doc', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser());

      await POST(makeReq({
        ...VALID_BODY,
        from_email: 'treasurer@church.org',
        senderEmail: 'treasurer@church.org',
      }));

      expect(mockExecute.mock.calls[0][1]).toMatchObject({ from_email: 'admin-a@church.org' });
      expect(JSON.stringify(mockExecute.mock.calls[0])).not.toContain('treasurer@church.org');
    });

    it('refuses with an actionable error — not a 502 — when no address is recorded', async () => {
      // Every connection made before the address was captured is in this state.
      mockRequireAdmin.mockResolvedValue(mockUser());
      docStore.set('tenants/bumb/integrations/admin-a_gmail', {
        status: 'active', connectedAccountId: 'ca_admin_a', // no senderEmail
      });

      const res = await POST(makeReq(VALID_BODY));

      expect(res.status).toBe(409);
      expect(res.status).not.toBe(502);
      const body = await res.json();
      expect(body.code).toBe('no_sender_address');
      expect(body.error).toMatch(/settings/i);
      // Nothing attempted, so nothing to log.
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('treats a blank stored address as no address', async () => {
      mockRequireAdmin.mockResolvedValue(mockUser());
      docStore.set('tenants/bumb/integrations/admin-a_gmail', {
        status: 'active', connectedAccountId: 'ca_admin_a', senderEmail: '   ',
      });

      const res = await POST(makeReq(VALID_BODY));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('no_sender_address');
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });
});
