import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The settings test-send is a real billed send, so it goes through the same
 * funnel as everything else. These tests pin the CALL-SITE half of the meter
 * contract: the route must declare the account the send goes out on, and it
 * must bill the tenant that asked for it.
 *
 * 🔴 THE-314 CHANGED WHAT THAT DECLARATION CAN BE. Harvest now RESELLS on one
 * vendor account, so a church holds no credentials of its own and every send is
 * a platform send. The old pair of cases — "declares byo" and "declares
 * platform" — collapsed into one, because there is no longer a second account
 * for a send to go out on. The cases are updated rather than deleted: the
 * property being guarded (the route must never mis-declare who pays) is exactly
 * as load-bearing as before, and more so now that the payer is always Harvest.
 */

const { mockRequireAdmin, mockGetNumber, mockSendSms, mockGetZernioNumber } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetNumber: vi.fn(),
  mockSendSms: vi.fn(),
  mockGetZernioNumber: vi.fn(),
}));

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

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/sms-send', () => ({
  getTenantSmsNumber: mockGetNumber,
  sendSms: mockSendSms,
}));
vi.mock('@/lib/zernio', () => ({ zernioGetNumber: mockGetZernioNumber }));

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
  // Today's tenant: a number Harvest bought and holds for it.
  mockGetNumber.mockResolvedValue({
    numberId: 'num_1', phoneNumber: '+12125550000', profileId: 't1', status: 'active',
    country: 'US', monthlyCostUsd: 3, purchasedAt: '2026-09-01T00:00:00.000Z',
  });
  mockGetZernioNumber.mockResolvedValue({ ok: true, status: 200, data: { status: 'active', phoneNumber: '+12125550000' } });
  mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1', segments: 1 });
});

describe('POST /api/sms/test — the test send declares the account it goes out on', () => {
  it('🔴 declares platform — Harvest resells, so it always pays', async () => {
    const res = await POST(makeRequest({ mode: 'sms', to: TO }));

    expect(res.status).toBe(200);
    expect(mockSendSms.mock.calls[0][3]).toEqual({ tenantId: 't1', source: 'platform' });
  });

  it('sends FROM the number Harvest bought for this ministry, not one the client named', async () => {
    await POST(makeRequest({ mode: 'sms', to: TO, from: '+19995550000' }));

    // The number argument is resolved server-side from the tenant. A client that
    // could name its own `from` would send on another ministry's number.
    expect(mockSendSms.mock.calls[0][0]).toMatchObject({ phoneNumber: '+12125550000' });
  });

  it('refuses when the ministry has no number yet, without reaching the funnel', async () => {
    mockGetNumber.mockResolvedValue(null);

    const res = await POST(makeRequest({ mode: 'sms', to: TO }));

    expect(res.status).toBe(400);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('still answers a capped send with a 403 and the upgrade CTA', async () => {
    mockSendSms.mockResolvedValue({ ok: false, code: 'sms_cap_reached', error: 'CAP', used: 250, cap: 250 });

    const res = await POST(makeRequest({ mode: 'sms', to: TO }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'sms_cap_reached', used: 250, cap: 250 });
  });

  it('a super admin is still unmetered', async () => {
    mockRequireAdmin.mockResolvedValue({ uid: 'super1', tenantId: null, isSuperAdmin: true });

    await POST(makeRequest({ mode: 'sms', to: TO }));

    // tenantId null → no tenants/null/usage write.
    expect(mockSendSms.mock.calls[0][3]).toMatchObject({ tenantId: null });
  });
});
