import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Text-to-Give used to answer with a TwiML <Message>, which makes Twilio send a
 * BILLED outbound SMS without ever touching sendSms — so it bypassed both the
 * US-only destination gate and the tenant's segment cap. Anyone who knew a
 * tenant's keyword could run their bill up from outside the app. These tests
 * pin the reply to the single metered funnel.
 */

const { mockSendSms } = vi.hoisted(() => ({ mockSendSms: vi.fn() }));
const { mockLogAdd, docData } = vi.hoisted(() => ({
  mockLogAdd: vi.fn().mockResolvedValue(undefined),
  docData: new Map<string, any>(),
}));

function makeDocRef(path: string): any {
  return {
    async get() {
      const d = docData.get(path);
      return { exists: d !== undefined, data: () => d };
    },
    collection: (sub: string) => makeColRef(`${path}/${sub}`),
  };
}
function makeColRef(path: string): any {
  return { doc: (id: string) => makeDocRef(`${path}/${id}`), add: mockLogAdd };
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
  adminDb: { collection: (name: string) => makeColRef(name) },
}));
// Only the send itself is stubbed. `resolveTwilioConfig` is the REAL one, so
// these tests prove the route declares the source the shared resolver actually
// chose for the credentials it sends with — not a source it made up locally.
vi.mock('@/lib/twilio', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/twilio')>()),
  sendSms: mockSendSms,
}));

const { POST } = await import('../incoming/route');

const TENANT_NUMBER = '+12125550000';
const TEXTER = '+12125551234';

function makeRequest(from: string, body: string, to = TENANT_NUMBER): NextRequest {
  return new NextRequest('https://theharvest.app/api/sms/incoming', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  docData.clear();
  docData.set(`twilioNumbers/${TENANT_NUMBER.replace(/\D/g, '')}`, { tenantId: 't1' });
  docData.set('tenants/t1/integrations/twilio', {
    accountSid: 'AC1',
    authToken: 'tok',
    fromNumber: TENANT_NUMBER,
    text2give: { enabled: true, keyword: 'GIVE', responseTemplate: 'Give here: {link}' },
  });
  mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1', segments: 1 });
});

describe('POST /api/sms/incoming — the reply is metered, not TwiML', () => {
  it('sends the reply through sendSms, billed to the tenant that owns the number', async () => {
    await POST(makeRequest(TEXTER, 'give'));

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    const [cfg, to, body, meter] = mockSendSms.mock.calls[0];
    expect(cfg).toMatchObject({ accountSid: 'AC1', fromNumber: TENANT_NUMBER });
    expect(to).toBe(TEXTER);
    expect(body).toBe('Give here: https://t1.theharvest.app/?giving=1');
    // Tenant resolved SERVER-SIDE from the To-number index, not from the texter.
    // The tenant has its own credentials, so the reply is a BYO send: billed by
    // Twilio to the church, and not against Harvest's allotment.
    expect(meter).toEqual({ tenantId: 't1', source: 'byo' });
  });

  it('returns EMPTY TwiML so Twilio does not send the message a second time', async () => {
    const res = await POST(makeRequest(TEXTER, 'GIVE'));
    const xml = await res.text();

    expect(res.status).toBe(200);
    expect(xml).toContain('<Response></Response>');
    expect(xml).not.toContain('<Message>');
  });

  it('logs the reply with its real segment count', async () => {
    mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1', segments: 2 });
    await POST(makeRequest(TEXTER, 'GIVE'));
    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'text2give_inbound', status: 'replied', segments: 2 }),
    );
  });

  it('logs "blocked" — not a silent drop — when the cap refuses the reply', async () => {
    mockSendSms.mockResolvedValue({ ok: false, code: 'sms_cap_reached', error: 'cap' });
    const res = await POST(makeRequest(TEXTER, 'GIVE'));

    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'text2give_inbound', status: 'blocked', errorCode: 'cap' }),
    );
    expect(await res.text()).toContain('<Response></Response>');
  });

  it('logs "blocked" for a non-US texter (the gate applies to inbound replies too)', async () => {
    mockSendSms.mockResolvedValue({ ok: false, code: 'non_us_destination', error: 'US only' });
    await POST(makeRequest('+442071838750', 'GIVE'));
    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked', errorCode: 'US only' }),
    );
  });

  it('does not send at all when the keyword does not match', async () => {
    await POST(makeRequest(TEXTER, 'HELLO'));
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('does not send when Text-to-Give is disabled', async () => {
    docData.set('tenants/t1/integrations/twilio', {
      accountSid: 'AC1', authToken: 'tok', fromNumber: TENANT_NUMBER,
      text2give: { enabled: false, keyword: 'GIVE' },
    });
    await POST(makeRequest(TEXTER, 'GIVE'));
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('does not send for an unknown Twilio number (no tenant to bill)', async () => {
    await POST(makeRequest(TEXTER, 'GIVE', '+19995550000'));
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('logs a failure instead of sending when NEITHER the tenant nor Harvest has credentials', async () => {
    docData.set('tenants/t1/integrations/twilio', {
      text2give: { enabled: true, keyword: 'GIVE', responseTemplate: 'Give here: {link}' },
    });
    await POST(makeRequest(TEXTER, 'GIVE'));

    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
