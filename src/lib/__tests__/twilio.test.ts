import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockTwilioGet, mockSmsLogAdd } = vi.hoisted(() => ({
  mockTwilioGet: vi.fn(),
  mockSmsLogAdd: vi.fn().mockResolvedValue(undefined),
}));

// Metering is mocked here so these tests pin sendSms's ORCHESTRATION — the
// order of the destination gate, the cap gate and the Twilio call, and what it
// increments by. The counter arithmetic itself is covered in sms-usage.test.ts.
const { mockReserve, mockSettle, mockRefund } = vi.hoisted(() => ({
  mockReserve: vi.fn(),
  mockSettle: vi.fn().mockResolvedValue(undefined),
  mockRefund: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/lib/sms-usage', () => ({
  reserveSmsSegment: mockReserve,
  settleSmsSegments: mockSettle,
  refundSmsSegment: mockRefund,
}));

const { sendAutomatedSms, sendSms, SMS_CAP_MESSAGE } = await import('@/lib/twilio');

// ── Helpers ────────────────────────────────────────────────────────────────
const CFG = { accountSid: 'AC1', authToken: 'tok', fromNumber: '+12125550000' };
const US = '+12125551234';   // New York — resolves to US
const CANADA = '+16135550123'; // Ottawa — also +1, but NOT US
const UK = '+442071838750';

function withConfig(templates: Record<string, { enabled: boolean; text: string }>) {
  mockTwilioGet.mockResolvedValue({
    exists: true,
    data: () => ({ accountSid: 'AC1', authToken: 'tok', fromNumber: '+12125550000', templates }),
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
  // Default: under cap, reservation succeeds.
  mockReserve.mockResolvedValue({ allowed: true, used: 1, cap: 250 });
});

// ── The disabled-trigger convention (C) ─────────────────────────────────────
describe('sendAutomatedSms — disabled-trigger convention', () => {
  it('does NOT send or log when the template is disabled (enabled: false)', async () => {
    withConfig({ pledge_confirmation: { enabled: false, text: 'Thanks {name}' } });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSmsLogAdd).not.toHaveBeenCalled();
  });

  it('does NOT send when the template is missing entirely', async () => {
    withConfig({}); // no pledge_confirmation key at all
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSmsLogAdd).not.toHaveBeenCalled();
  });

  it('does NOT send when enabled but text is empty', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: '' } });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

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

  it('a disabled trigger never touches the segment allotment', async () => {
    withConfig({ pledge_confirmation: { enabled: false, text: 'Thanks {name}' } });
    stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

    expect(mockReserve).not.toHaveBeenCalled();
  });
});

// ── Honest status logging (D) ───────────────────────────────────────────────
describe('sendAutomatedSms — honest status logging', () => {
  it('logs status "delivered" with null errorCode and the real segment count', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}, ${amount}' } });
    stubFetch(true, { sid: 'SM123', num_segments: '2' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada', amount: '50' });

    expect(mockSmsLogAdd).toHaveBeenCalledTimes(1);
    expect(mockSmsLogAdd.mock.calls[0][0]).toMatchObject({
      trigger: 'pledge_confirmation',
      phone: US,
      status: 'delivered',
      errorCode: null,
      segments: 2,
    });
  });

  it('logs status "failed" with the error on a failed send (never "delivered")', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    stubFetch(false, { message: 'The number is not a valid phone number.' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

    const logged = mockSmsLogAdd.mock.calls[0][0];
    expect(logged.status).toBe('failed');
    expect(logged.status).not.toBe('delivered');
    expect(logged.errorCode).toBe('The number is not a valid phone number.');
  });

  it('logs status "blocked" — never a silent drop — for a non-US member', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', UK, { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    const logged = mockSmsLogAdd.mock.calls[0][0];
    expect(logged.status).toBe('blocked');
    expect(logged.errorCode).toMatch(/US numbers only/i);
  });

  it('logs status "blocked" with the upgrade message when the cap is reached', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    mockReserve.mockResolvedValue({ allowed: false, used: 250, cap: 250 });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

    expect(fetchMock).not.toHaveBeenCalled();
    const logged = mockSmsLogAdd.mock.calls[0][0];
    expect(logged.status).toBe('blocked');
    expect(logged.errorCode).toBe(SMS_CAP_MESSAGE);
  });
});

// ── sendSms: the single funnel ──────────────────────────────────────────────
describe('sendSms — US-only destination gate', () => {
  it('rejects a non-US number BEFORE the cap check and BEFORE Twilio', async () => {
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    const r = await sendSms(CFG, UK, 'hi', { tenantId: 't1' });

    expect(r.ok).toBe(false);
    expect(r.code).toBe('non_us_destination');
    expect(r.country).toBe('GB');
    expect(fetchMock).not.toHaveBeenCalled();
    // A rejected send consumes NO allotment — the gate runs before the reserve.
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('rejects a Canadian number even though it starts with +1', async () => {
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    const r = await sendSms(CFG, CANADA, 'hi', { tenantId: 't1' });

    expect(r.ok).toBe(false);
    expect(r.country).toBe('CA');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockReserve).not.toHaveBeenCalled();
  });

  it('rejects a malformed number as invalid, not as a country block', async () => {
    const r = await sendSms(CFG, 'not-a-number', 'hi', { tenantId: 't1' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('invalid_destination');
    expect(mockReserve).not.toHaveBeenCalled();
  });
});

describe('sendSms — cap enforcement and real segment metering', () => {
  it('under cap: sends and increments by Twilio\'s REAL segment count', async () => {
    const fetchMock = stubFetch(true, { sid: 'SM9', num_segments: '3' });

    const r = await sendSms(CFG, US, 'a long message', { tenantId: 't1' });

    expect(r.ok).toBe(true);
    expect(r.segments).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledWith('t1', 3);
  });

  it('a single-segment message settles as 1', async () => {
    stubFetch(true, { sid: 'SM9', num_segments: '1' });
    const r = await sendSms(CFG, US, 'short', { tenantId: 't1' });
    expect(r.segments).toBe(1);
    expect(mockSettle).toHaveBeenCalledWith('t1', 1);
  });

  it('at cap: blocks BEFORE the Twilio call', async () => {
    mockReserve.mockResolvedValue({ allowed: false, used: 250, cap: 250 });
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    const r = await sendSms(CFG, US, 'hi', { tenantId: 't1' });

    expect(r.ok).toBe(false);
    expect(r.code).toBe('sms_cap_reached');
    expect(r.used).toBe(250);
    expect(r.cap).toBe(250);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('refunds the reserved segment when Twilio rejects the send', async () => {
    stubFetch(false, { message: 'Twilio said no' });

    const r = await sendSms(CFG, US, 'hi', { tenantId: 't1' });

    expect(r.ok).toBe(false);
    expect(r.code).toBe('twilio_error');
    expect(mockRefund).toHaveBeenCalledWith('t1');
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('refunds the reserved segment when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const r = await sendSms(CFG, US, 'hi', { tenantId: 't1' });

    expect(r.ok).toBe(false);
    expect(r.code).toBe('send_failed');
    expect(mockRefund).toHaveBeenCalledWith('t1');
  });

  it('a delivered message is never billed as free when Twilio omits num_segments', async () => {
    stubFetch(true, { sid: 'SM9' }); // no num_segments field at all
    const r = await sendSms(CFG, US, 'hi', { tenantId: 't1' });
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(1);   // the reserved segment stands
    expect(mockSettle).toHaveBeenCalledWith('t1', 0); // adds no EXTRA segments
  });

  it('a metering failure never turns a delivered message into a failure', async () => {
    stubFetch(true, { sid: 'SM9', num_segments: '2' });
    mockSettle.mockRejectedValueOnce(new Error('firestore down'));

    const r = await sendSms(CFG, US, 'hi', { tenantId: 't1' });

    expect(r.ok).toBe(true);
  });
});

describe('sendSms — a metering outage never escapes the funnel', () => {
  it('returns a structured result instead of throwing when the reserve fails', async () => {
    mockReserve.mockRejectedValue(new Error('firestore transaction failed'));
    const fetchMock = stubFetch(true, { sid: 'SM1' });

    const r = await sendSms(CFG, US, 'hi', { tenantId: 't1' });

    expect(r.ok).toBe(false);
    expect(r.code).toBe('send_failed');
    // Fails CLOSED — an unverifiable allotment must not become an unmetered send.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendAutomatedSms still LOGS when the reserve fails — never a silent drop', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    mockReserve.mockRejectedValue(new Error('firestore transaction failed'));
    stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

    // The throw used to escape sendSms, so this write was never reached.
    expect(mockSmsLogAdd).toHaveBeenCalledTimes(1);
    expect(mockSmsLogAdd.mock.calls[0][0].status).toBe('failed');
  });
});

describe('sendAutomatedSms — logs the machine-readable code alongside the message', () => {
  it('keeps errorCode as the message and records the code separately', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    stubFetch(true, { sid: 'SM1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', UK, { name: 'Ada' });

    const logged = mockSmsLogAdd.mock.calls[0][0];
    expect(logged.code).toBe('non_us_destination');
    expect(logged.errorCode).toMatch(/US numbers only/i);
  });

  it('leaves both null on a successful send', async () => {
    withConfig({ pledge_confirmation: { enabled: true, text: 'Thanks {name}' } });
    stubFetch(true, { sid: 'SM1', num_segments: '1' });

    await sendAutomatedSms('t1', 'pledge_confirmation', US, { name: 'Ada' });

    const logged = mockSmsLogAdd.mock.calls[0][0];
    expect(logged.code).toBeNull();
    expect(logged.errorCode).toBeNull();
  });
});

describe('sendSms — super-admin bypass', () => {
  it('never meters a null tenant (no tenants/null usage write) but still sends', async () => {
    const fetchMock = stubFetch(true, { sid: 'SM9', num_segments: '2' });

    const r = await sendSms(CFG, US, 'hi', { tenantId: null });

    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('still applies the US-only gate to a super admin', async () => {
    const fetchMock = stubFetch(true, { sid: 'SM1' });
    const r = await sendSms(CFG, UK, 'hi', { tenantId: null });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
