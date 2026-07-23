import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockCampaignGet, mockTenantGet, mockPledgeAdd, mockSendAutomatedSms } = vi.hoisted(() => ({
  mockCampaignGet: vi.fn(),
  mockTenantGet: vi.fn(),
  mockPledgeAdd: vi.fn().mockResolvedValue(undefined),
  mockSendAutomatedSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'campaigns') {
        return { doc: () => ({ get: mockCampaignGet }) };
      }
      // tenants
      return {
        doc: () => ({
          get: mockTenantGet,
          collection: () => ({ add: mockPledgeAdd }),
        }),
      };
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'ts' },
}));

// The route delegates all SMS behaviour to sendAutomatedSms — the single source
// of truth for the enabled-check and honest logging (tested in lib/twilio.test).
vi.mock('@/lib/twilio', () => ({ sendAutomatedSms: mockSendAutomatedSms }));

// Resend is imported at module top; email is skipped when RESEND_API_KEY is unset.
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn() }; } }));

const { POST } = await import('../submit/route');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/pledge/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  tenantId: 't1',
  campaignId: 'c1',
  donorName: 'Ada Lovelace',
  donorEmail: 'ada@example.com',
  donorPhone: '+15551234567',
  pledgeAmount: 250,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  mockCampaignGet.mockResolvedValue({
    exists: true,
    data: () => ({ tenantId: 't1', campaignType: 'pledge', isActive: true, title: 'Building Fund' }),
  });
  mockTenantGet.mockResolvedValue({ data: () => ({ name: 'Grace Church' }) });
});

describe('POST /api/pledge/submit — SMS delegation', () => {
  it('records the pledge and delegates the confirmation SMS to sendAutomatedSms', async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(mockPledgeAdd).toHaveBeenCalledTimes(1);

    expect(mockSendAutomatedSms).toHaveBeenCalledTimes(1);
    expect(mockSendAutomatedSms).toHaveBeenCalledWith('t1', 'pledge_confirmation', '+15551234567', {
      name: 'Ada Lovelace',
      amount: '250',
      tenantName: 'Grace Church',
    });
  });

  it('does not attempt any SMS when the donor left no phone number', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, donorPhone: '' }));
    expect(res.status).toBe(200);
    expect(mockSendAutomatedSms).not.toHaveBeenCalled();
  });

  it('rejects an inactive / non-pledge campaign before writing anything', async () => {
    mockCampaignGet.mockResolvedValue({
      exists: true,
      data: () => ({ tenantId: 't1', campaignType: 'pledge', isActive: false, title: 'Old' }),
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(410);
    expect(mockPledgeAdd).not.toHaveBeenCalled();
    expect(mockSendAutomatedSms).not.toHaveBeenCalled();
  });
});
