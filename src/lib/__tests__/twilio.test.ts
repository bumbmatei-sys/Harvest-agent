import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockTwilioGet, mockSmsLogAdd } = vi.hoisted(() => ({
  mockTwilioGet: vi.fn(),
  mockSmsLogAdd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        // tenants/{id}/integrations/twilio → get
        // tenants/{id}/smsLogs → add
        collection: () => ({
          doc: () => ({ get: mockTwilioGet }),
          add: mockSmsLogAdd,
        }),
      }),
    }),
  },
}));

const { sendAutomatedSms } = await import('@/lib/twilio');

// ── Helpers ────────────────────────────────────────────────────────────────
function withConfig(templates: Record<string, { enabled: boolean; text: string }>) {
  mockTwilioGet.mockResolvedValue({
    exists: true,
    data: () => ({ accountSid: 'AC1', authToken: 'tok', fromNumber: '+1000', templates }),
  });
}

function stubFetch(ok: boolean, payload: object) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 201 : 400,
    json: vi.fn().mockResolvedValue(payload),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── The disabled-trigger convention (C) ─────────────────────────────────────
describe('sendAutomatedSms — disabled-trigger convention', () => {
  it('does NOT send or log when the template is disabled (enabled: false)', async () => {
    withConfig({ pledge_confirmation: { enabled: false, text: 'Thanks {name}' } });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', '+15551234567', { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSmsLogAdd).not.toHaveBeenCalled();
  });

  it('does NOT send when the template is missing entirely', async () => {
    withConfig({}); // no pledge_confirmation key at all
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', '+15551234567', { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSmsLogAdd).not.toHaveBeenCalled();
  });

  it('does NOT send when enabled but text is empty', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: '' } });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', '+15551234567', { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSmsLogAdd).not.toHaveBeenCalled();
  });

  it('does NOT send when there is no recipient phone', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', null, { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSmsLogAdd).not.toHaveBeenCalled();
  });
});

// ── Honest status logging (D) ───────────────────────────────────────────────
describe('sendAutomatedSms — honest status logging', () => {
  it('logs status "delivered" with null errorCode on a successful send', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}, ${amount}' } });
    stubFetch(true, { sid: 'SM123' });

    await sendAutomatedSms('t1', 'pledge_confirmation', '+15551234567', { name: 'Ada', amount: '50' });

    expect(mockSmsLogAdd).toHaveBeenCalledTimes(1);
    const logged = mockSmsLogAdd.mock.calls[0][0];
    expect(logged).toMatchObject({
      trigger: 'pledge_confirmation',
      phone: '+15551234567',
      status: 'delivered',
      errorCode: null,
    });
  });

  it('logs status "failed" with the error on a failed send (never "delivered")', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    stubFetch(false, { message: 'The number is not a valid phone number.' });

    await sendAutomatedSms('t1', 'pledge_confirmation', '+1invalid', { name: 'Ada' });

    expect(mockSmsLogAdd).toHaveBeenCalledTimes(1);
    const logged = mockSmsLogAdd.mock.calls[0][0];
    expect(logged.status).toBe('failed');
    expect(logged.status).not.toBe('delivered');
    expect(logged.errorCode).toBe('The number is not a valid phone number.');
  });
});
