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
const { mockRequireAdmin, mockGetTwilioConfig, mockSendSms } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetTwilioConfig: vi.fn(),
  mockSendSms: vi.fn(),
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

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: vi.fn(() => makeCollRef()) },
}));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/twilio', () => ({ getTwilioConfig: mockGetTwilioConfig, sendSms: mockSendSms }));
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

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ uid: 'admin1', tenantId: 't1' });
  mockGetTwilioConfig.mockResolvedValue({ accountSid: 'AC1', authToken: 'tok', fromNumber: '+1000' });
  mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1' });
  mockContactsGet.mockResolvedValue({
    docs: [{ data: () => ({ phone: '+15551234567', type: 'member' }) }],
  });
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
    expect(await res.json()).toEqual({ sent: true, delivered: 1, failed: 0, recipientCount: 1 });
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
