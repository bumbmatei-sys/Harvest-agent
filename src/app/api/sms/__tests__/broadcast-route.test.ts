import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Broadcast scheduling was removed. The route used to persist a
 * `status: 'scheduled'` doc and report success, but nothing has ever processed
 * that collection — the message was never sent. The UI no longer offers a
 * schedule picker; these tests pin the API to the same story so it can't
 * silently accept a schedule again.
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockRequireAdmin, mockGetNumber, mockSendSms, mockUsageSnapshot } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetNumber: vi.fn(),
  mockSendSms: vi.fn(),
  mockUsageSnapshot: vi.fn(),
}));

const { mockContactsGet, mockDocSet, mockLogAdd } = vi.hoisted(() => ({
  mockContactsGet: vi.fn(),
  mockDocSet: vi.fn().mockResolvedValue(undefined),
  mockLogAdd: vi.fn().mockResolvedValue(undefined),
}));

function makeCollRef(): any {
  const coll: any = {
    doc: vi.fn(() => makeDocRef()),
    add: mockLogAdd,
    get: mockContactsGet,
  };
  coll.where = vi.fn(() => coll);
  coll.limit = vi.fn(() => coll);
  return coll;
}
function makeDocRef(): any {
  return { get: vi.fn(), set: mockDocSet, collection: vi.fn(() => makeCollRef()) };
}

// ── THE-245 ────────────────────────────────────────────────────────────────
// This suite pins what SMS DOES, so it runs with the master switch ON. That is
// the hide-not-delete guarantee expressed as a test: every rule below — the
// US-only gate, the cap, the reserve/settle/refund order, the smsLogs write —
// still holds, unchanged, the moment SMS_FEATURE_ENABLED goes back to true.
// The OFF behaviour is covered in the-245-sms-hidden.test.ts.
vi.mock('@/lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()) },
}));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/sms-send', () => ({
  getTenantSmsNumber: mockGetNumber,
  sendSms: mockSendSms,
  SMS_CAP_MESSAGE: 'CAP_MESSAGE',
}));
vi.mock('@/lib/sms-usage', () => ({ getSmsUsageSnapshot: mockUsageSnapshot }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TS') },
}));

const { POST } = await import('../broadcast/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://grace.theharvest.app/api/sms/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** N member contacts with distinct US phone numbers. */
function withRecipients(n: number) {
  mockContactsGet.mockResolvedValue({
    docs: Array.from({ length: n }, (_, i) => ({
      data: () => ({ phone: `+1212555${String(1000 + i).padStart(4, '0')}`, type: 'member' }),
    })),
  });
}

/** The ministry's number, bought and held by Harvest.
 *
 * ⚠️ THE-314 — there is no second case any more. `withPlatformCredentials()`
 * used to describe the hypothetical day Harvest owned an account; that day
 * arrived, and it is now the ONLY state: every tenant sends on Harvest's vendor
 * account, so the cap binds on every broadcast rather than on a branch nothing
 * could reach. */
function withNumber() {
  mockGetNumber.mockResolvedValue({
    numberId: 'num_1', phoneNumber: '+18005550000', profileId: 't1', status: 'active',
    country: 'US', monthlyCostUsd: 3, purchasedAt: '2026-09-01T00:00:00.000Z',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ uid: 'admin1', tenantId: 't1', isSuperAdmin: false });
  // Today's tenant: a number Harvest bought for it → every send is a platform
  // send, and Harvest pays for it.
  withNumber();
  mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1', segments: 1 });
  mockUsageSnapshot.mockResolvedValue({
    plan: 'plus', month: '2026-07', smsSegmentsUsed: 0, smsSegmentsByoUsed: 0, smsSegmentsCap: 250,
  });
  withRecipients(1);
});

describe('POST /api/sms/broadcast — scheduling is not supported', () => {
  it('rejects a scheduled broadcast with a 400 instead of pretending to book it', async () => {
    const res = await POST(makeRequest({
      recipientGroup: 'all_members',
      message: 'Service moved to 10am',
      scheduledAt: '2099-01-01T10:00:00.000Z',
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not supported/i);
  });

  it('writes NO broadcast doc and sends NOTHING for a scheduled request', async () => {
    await POST(makeRequest({
      recipientGroup: 'all_members',
      message: 'Service moved to 10am',
      scheduledAt: '2099-01-01T10:00:00.000Z',
    }));

    expect(mockDocSet).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});

describe('POST /api/sms/broadcast — send now still works', () => {
  it('sends immediately and records a sent history doc', async () => {
    const res = await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sent: true, delivered: 1, failed: 0, skipped: 0, recipientCount: 1,
    });
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    // The smsBroadcasts record is the send log — deliberately kept.
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', delivered: 1, failed: 0, scheduledAt: null }),
    );
  });

  it('still answers a preview-only request with just the recipient count', async () => {
    const res = await POST(makeRequest({ recipientGroup: 'all_members', previewOnly: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recipientCount: 1 });
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});

// ── Segment metering ────────────────────────────────────────────────────────
/**
 * A broadcast to 500 recipients is 500+ SEGMENTS in one admin action, so it is
 * metered PER RECIPIENT, not once per broadcast. When the allotment runs out
 * mid-send the broadcast is PARTIAL and says so — never silently truncated.
 */
describe('POST /api/sms/broadcast — per-recipient segment metering', () => {
  it('meters PER RECIPIENT — one sendSms call per contact, each carrying the tenant', async () => {
    withRecipients(5);

    await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(mockSendSms).toHaveBeenCalledTimes(5);
    for (const call of mockSendSms.mock.calls) {
      // Billed per send, server-resolved. 🔴 Always 'platform' since THE-314:
      // Harvest resells, so there is no account a send could go out on that
      // Harvest is not paying for.
      expect(call[3]).toEqual({ tenantId: 't1', source: 'platform' });
    }
  });

  it('refuses the whole broadcast with an upgrade CTA when already at cap', async () => {
    mockUsageSnapshot.mockResolvedValue({
      plan: 'plus', month: '2026-07', smsSegmentsUsed: 250, smsSegmentsByoUsed: 0, smsSegmentsCap: 250,
    });
    withRecipients(5);

    const res = await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'sms_cap_reached', used: 250, cap: 250 });
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it('🔴 there is no unmetered broadcast left — the cap binds on every tenant', async () => {
    // ⚠️ THIS REPLACES "a BYO broadcast is NOT refused at the nominal cap".
    // That case existed because a church spending on its OWN Twilio account had
    // no Harvest money to protect. Harvest now resells and pays for every
    // segment, so the same numbers that used to let a broadcast through must
    // now stop it — an unmetered broadcast is money leaking.
    mockUsageSnapshot.mockResolvedValue({
      plan: 'max', month: '2026-07', smsSegmentsUsed: 2_000, smsSegmentsByoUsed: 0, smsSegmentsCap: 2_000,
    });
    withRecipients(5);

    const res = await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(res.status).toBe(403);
    expect(mockUsageSnapshot).toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('refuses before spending when the ministry has no number', async () => {
    mockGetNumber.mockResolvedValue(null);
    withRecipients(5);

    const res = await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(res.status).toBe(400);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('🔴 counts a member who replied STOP apart from a failure', async () => {
    withRecipients(3);
    mockSendSms
      .mockResolvedValueOnce({ ok: true, sid: 'SM1', segments: 1 })
      .mockResolvedValueOnce({ ok: false, code: 'recipient_opted_out', error: 'STOP' })
      .mockResolvedValueOnce({ ok: true, sid: 'SM3', segments: 1 });

    const body = await (await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }))).json();

    // Not a fault to go hunting for: someone asked not to be texted and Harvest
    // honoured it. Reported, never silently dropped.
    expect(body).toMatchObject({ delivered: 2, failed: 0, skippedOptedOut: 1 });
  });

  it('crossing the cap MID-SEND sends partially and reports it precisely', async () => {
    withRecipients(5);
    // Recipients 1–3 go out; the 4th is refused by the cap.
    mockSendSms
      .mockResolvedValueOnce({ ok: true, sid: 'SM1', segments: 1 })
      .mockResolvedValueOnce({ ok: true, sid: 'SM2', segments: 2 })
      .mockResolvedValueOnce({ ok: true, sid: 'SM3', segments: 1 })
      .mockResolvedValue({ ok: false, code: 'sms_cap_reached', error: 'CAP_MESSAGE', used: 250, cap: 250 });

    const res = await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      sent: true, delivered: 3, skipped: 2, capReached: true, recipientCount: 5,
    });
    // It STOPS at the cap — it does not keep calling Twilio for the rest.
    expect(mockSendSms).toHaveBeenCalledTimes(4);
    // The history doc records a partial send, not a clean 'sent'.
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial', capReached: true, delivered: 3, skipped: 2 }),
    );
  });

  it('skips a non-US recipient individually without aborting the broadcast', async () => {
    withRecipients(3);
    mockSendSms
      .mockResolvedValueOnce({ ok: true, sid: 'SM1', segments: 1 })
      .mockResolvedValueOnce({ ok: false, code: 'non_us_destination', error: 'SMS is currently available for US numbers only.' })
      .mockResolvedValueOnce({ ok: true, sid: 'SM3', segments: 1 });

    const res = await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(await res.json()).toMatchObject({
      delivered: 2, skippedNonUs: 1, failed: 0, skipped: 0, recipientCount: 3,
    });
    expect(mockSendSms).toHaveBeenCalledTimes(3); // everyone else still got it
  });

  it('a failed preflight usage read does NOT 500 the broadcast — per-send gate still enforces', async () => {
    mockUsageSnapshot.mockRejectedValue(new Error('firestore down'));
    withRecipients(3);

    const res = await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ delivered: 3 });
    expect(mockSendSms).toHaveBeenCalledTimes(3); // reserveSmsSegment is authoritative
  });

  it('records the machine-readable code on a per-recipient log, not just the message', async () => {
    withRecipients(1);
    mockSendSms.mockResolvedValue({
      ok: false, code: 'non_us_destination', error: 'SMS is currently available for US numbers only.',
    });

    await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked',
        code: 'non_us_destination',
        errorCode: 'SMS is currently available for US numbers only.',
      }),
    );
  });

  it('a super admin is not metered — sendSms is called with a null tenant', async () => {
    mockRequireAdmin.mockResolvedValue({ uid: 'super1', tenantId: null, isSuperAdmin: true });

    await POST(makeRequest({ recipientGroup: 'all_members', message: 'Hello' }));

    // No pre-flight usage read, and no tenant to bill → no tenants/null write.
    expect(mockUsageSnapshot).not.toHaveBeenCalled();
    expect(mockSendSms.mock.calls[0][3]).toEqual({ tenantId: null, source: 'platform' });
  });
});
