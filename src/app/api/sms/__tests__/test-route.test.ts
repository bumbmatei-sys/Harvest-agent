import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The settings test-send is a real billed send, so it goes through the same
 * funnel as everything else. These tests pin the CALL-SITE half of the meter
 * contract: the route must declare the account the credentials it was handed
 * actually belong to, so the cap binds on a platform send and not on a send the
 * church is paying Twilio for itself.
 */

const { mockRequireAdmin, mockGetTwilioConfig, mockSendSms, mockValidate } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetTwilioConfig: vi.fn(),
  mockSendSms: vi.fn(),
  mockValidate: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/twilio', () => ({
  getTwilioConfig: mockGetTwilioConfig,
  validateTwilio: mockValidate,
  sendSms: mockSendSms,
}));

const { POST } = await import('../test/route');

const TO = '+12125551234';

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://grace.theharvest.app/api/sms/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ uid: 'admin1', tenantId: 't1', isSuperAdmin: false });
  // Today's tenant: its own credentials.
  mockGetTwilioConfig.mockResolvedValue({
    accountSid: 'AC1', authToken: 'tok', fromNumber: '+12125550000', source: 'byo',
  });
  mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1', segments: 1 });
});

describe('POST /api/sms/test — the test send declares the account it goes out on', () => {
  it('declares byo for a tenant sending on its own credentials', async () => {
    const res = await POST(makeRequest({ mode: 'sms', to: TO }));

    expect(res.status).toBe(200);
    expect(mockSendSms.mock.calls[0][3]).toEqual({ tenantId: 't1', source: 'byo' });
  });

  it('declares platform when the credentials are Harvest\'s', async () => {
    mockGetTwilioConfig.mockResolvedValue({
      accountSid: 'ACplatform', authToken: 'ptok', fromNumber: '+18005550000', source: 'platform',
    });

    await POST(makeRequest({ mode: 'sms', to: TO }));

    expect(mockSendSms.mock.calls[0][3]).toEqual({ tenantId: 't1', source: 'platform' });
  });

  it('still answers a capped platform send with a 403 and the upgrade CTA', async () => {
    mockGetTwilioConfig.mockResolvedValue({
      accountSid: 'ACplatform', authToken: 'ptok', fromNumber: '+18005550000', source: 'platform',
    });
    mockSendSms.mockResolvedValue({ ok: false, code: 'sms_cap_reached', error: 'CAP', used: 250, cap: 250 });

    const res = await POST(makeRequest({ mode: 'sms', to: TO }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'sms_cap_reached', used: 250, cap: 250 });
  });

  it('a super admin is still unmetered on either account', async () => {
    mockRequireAdmin.mockResolvedValue({ uid: 'super1', tenantId: null, isSuperAdmin: true });

    await POST(makeRequest({ mode: 'sms', to: TO }));

    // tenantId null → no tenants/null/usage write, whichever account paid.
    expect(mockSendSms.mock.calls[0][3]).toMatchObject({ tenantId: null });
  });
});
