import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

/**
 * `/api/sms/incoming` is the PUBLIC, UNAUTHENTICATED webhook. Two properties
 * are guarded here and both are open-door properties:
 *
 *   🔴 THE SIGNATURE. ⚠️ THE TWILIO PATH VERIFIED NOTHING — there was no
 *      signature check on this route, or anywhere in the repository, before
 *      THE-314. Anyone who learned a tenant's keyword and this URL could forge
 *      an inbound message and make Harvest send a real, billed reply. Under the
 *      reseller model that reply is Harvest's money and the carrier complaint
 *      lands on Harvest's brand registration.
 *
 *   🔴 STOP. Carrier-mandated. A number that keeps sending after STOP gets
 *      flagged and then blocked — and the number is Harvest's.
 *
 * The reply itself still goes through the ONE metered funnel rather than being
 * returned inline for the provider to send, which is what stops anyone who
 * knows a keyword from running a bill up from outside the app.
 */

const SECRET = 'whsec_test_secret';
const TENANT_NUMBER = '+12125550000';
const TEXTER = '+12125551234';

const { mockSendSms, mockGetNumber } = vi.hoisted(() => ({
  mockSendSms: vi.fn(),
  mockGetNumber: vi.fn(),
}));
const { mockLogAdd, mockSet, mockDelete, docData } = vi.hoisted(() => ({
  mockLogAdd: vi.fn().mockResolvedValue(undefined),
  mockSet: vi.fn().mockResolvedValue(undefined),
  mockDelete: vi.fn().mockResolvedValue(undefined),
  docData: new Map<string, any>(),
}));

function makeDocRef(path: string): any {
  return {
    async get() {
      const d = docData.get(path);
      return { exists: d !== undefined, data: () => d };
    },
    set: (v: any, o?: any) => mockSet(path, v, o),
    delete: () => mockDelete(path),
    collection: (sub: string) => makeColRef(`${path}/${sub}`),
  };
}
function makeColRef(path: string): any {
  return { doc: (id: string) => makeDocRef(`${path}/${id}`), add: mockLogAdd };
}

vi.mock('@/lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeColRef(name) },
}));
// Only the send and the number lookup are stubbed. `verifyZernioSignature` and
// the whole of `sms-optout` are the REAL implementations — they are the two
// things under test, and a stub of either would guard nothing.
vi.mock('@/lib/sms-send', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/sms-send')>()),
  sendSms: mockSendSms,
  getTenantSmsNumber: mockGetNumber,
}));

process.env.ZERNIO_WEBHOOK_SECRET = SECRET;

const { POST } = await import('../incoming/route');

/** A genuine delivery: the provider's JSON event, signed the way it signs. */
function makeRequest(
  from: string,
  text: string,
  to = TENANT_NUMBER,
  opts: { secret?: string | null; signature?: string | null } = {},
): NextRequest {
  const body = JSON.stringify({
    type: 'message.received',
    data: { message: { platform: 'sms', from, to, text } },
  });
  const signature =
    opts.signature !== undefined
      ? opts.signature
      : crypto.createHmac('sha256', opts.secret ?? SECRET).update(body, 'utf8').digest('hex');
  return new NextRequest('https://theharvest.app/api/sms/incoming', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'x-zernio-signature': signature } : {}),
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  docData.clear();
  process.env.ZERNIO_WEBHOOK_SECRET = SECRET;
  docData.set(`smsNumbers/${TENANT_NUMBER.replace(/\D/g, '')}`, { tenantId: 't1' });
  mockGetNumber.mockResolvedValue({
    numberId: 'num_1',
    phoneNumber: TENANT_NUMBER,
    profileId: 't1',
    status: 'active',
    country: 'US',
    monthlyCostUsd: 3,
    purchasedAt: '2026-09-01T00:00:00.000Z',
    text2give: { enabled: true, keyword: 'GIVE', responseTemplate: 'Give here: {link}' },
  });
  mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1', segments: 1 });
});

// ─── 🔴 The open door ────────────────────────────────────────────────────────

describe('🔴 the public webhook rejects an unsigned or wrongly-signed request', () => {
  it('rejects a request carrying NO signature at all', async () => {
    const res = await POST(makeRequest(TEXTER, 'GIVE', TENANT_NUMBER, { signature: null }));

    expect(res.status).toBe(401);
    // Nothing was read and nothing was sent: the check is ahead of both.
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockLogAdd).not.toHaveBeenCalled();
  });

  it('rejects a signature computed with the WRONG secret', async () => {
    const res = await POST(makeRequest(TEXTER, 'GIVE', TENANT_NUMBER, { secret: 'not-the-secret' }));

    expect(res.status).toBe(401);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('rejects a signature over a DIFFERENT body — the payload cannot be swapped', async () => {
    // The attacker holds a valid signature for one message and tries to reuse
    // it for another. The HMAC covers the raw body, so it does not transfer.
    const stolen = crypto
      .createHmac('sha256', SECRET)
      .update(JSON.stringify({ type: 'message.received', data: { message: { platform: 'sms', from: TEXTER, to: TENANT_NUMBER, text: 'HELLO' } } }), 'utf8')
      .digest('hex');
    const res = await POST(makeRequest(TEXTER, 'GIVE', TENANT_NUMBER, { signature: stolen }));

    expect(res.status).toBe(401);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('rejects a malformed (non-hex) signature rather than throwing', async () => {
    const res = await POST(makeRequest(TEXTER, 'GIVE', TENANT_NUMBER, { signature: 'not-hex!!' }));
    expect(res.status).toBe(401);
  });

  it('🔴 FAILS CLOSED when no secret is configured at all', async () => {
    // "We could not check" and "it is genuine" are not the same answer. A
    // deployment that forgot the secret must refuse, not wave everything
    // through.
    delete process.env.ZERNIO_WEBHOOK_SECRET;
    const res = await POST(makeRequest(TEXTER, 'GIVE'));

    expect(res.status).toBe(401);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed delivery', async () => {
    const res = await POST(makeRequest(TEXTER, 'GIVE'));
    expect(res.status).toBe(200);
    expect(mockSendSms).toHaveBeenCalledTimes(1);
  });
});

// ─── 🔴 STOP ────────────────────────────────────────────────────────────────

describe('🔴 STOP, UNSUBSCRIBE, CANCEL, END and QUIT are all honoured', () => {
  it.each(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])(
    '%s writes the suppression record and sends nothing back',
    async (keyword) => {
      const res = await POST(makeRequest(TEXTER, keyword));

      expect(res.status).toBe(200);
      // The opt-out is recorded against the tenant, keyed by digits.
      expect(mockSet).toHaveBeenCalledWith(
        `tenants/t1/smsOptOuts/${TEXTER.replace(/\D/g, '')}`,
        expect.objectContaining({ phone: TEXTER, keyword }),
        expect.anything(),
      );
      // 🔴 No reply. A confirmation text to somebody who just asked for no more
      // messages is a billed message on the number this control protects.
      expect(mockSendSms).not.toHaveBeenCalled();
    },
  );

  it.each(['stop', ' Stop ', 'quit'])('honours %j — case and whitespace do not matter', async (keyword) => {
    await POST(makeRequest(TEXTER, keyword));
    expect(mockSet).toHaveBeenCalledWith(
      expect.stringContaining('smsOptOuts'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('does NOT treat a sentence merely containing "stop" as an opt-out', async () => {
    // "Please don't stop sending these" is the opposite request. Matching on a
    // substring would silently unsubscribe a member who asked to keep hearing.
    await POST(makeRequest(TEXTER, "Please don't stop sending these"));
    expect(mockSet).not.toHaveBeenCalledWith(
      expect.stringContaining('smsOptOuts'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('records the opt-out even when Text-to-Give is not configured', async () => {
    // STOP is not a Text-to-Give feature. It must work for a church that never
    // set a keyword up.
    mockGetNumber.mockResolvedValue({ numberId: 'num_1', phoneNumber: TENANT_NUMBER, profileId: 't1', status: 'active', country: 'US', monthlyCostUsd: 3, purchasedAt: '' });
    await POST(makeRequest(TEXTER, 'STOP'));
    expect(mockSet).toHaveBeenCalledWith(
      `tenants/t1/smsOptOuts/${TEXTER.replace(/\D/g, '')}`,
      expect.objectContaining({ phone: TEXTER }),
      expect.anything(),
    );
  });

  it('STOP wins over a matching Text-to-Give keyword', async () => {
    // A church whose keyword is literally STOP must not turn an opt-out into a
    // giving link. The opt-out branch runs first, deliberately.
    mockGetNumber.mockResolvedValue({
      numberId: 'num_1', phoneNumber: TENANT_NUMBER, profileId: 't1', status: 'active',
      country: 'US', monthlyCostUsd: 3, purchasedAt: '',
      text2give: { enabled: true, keyword: 'STOP', responseTemplate: 'Give here: {link}' },
    });
    await POST(makeRequest(TEXTER, 'STOP'));
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('START brings a member back — the carriers require the opt-IN half too', async () => {
    await POST(makeRequest(TEXTER, 'START'));
    expect(mockDelete).toHaveBeenCalledWith(`tenants/t1/smsOptOuts/${TEXTER.replace(/\D/g, '')}`);
  });

  it('logs the opt-out so an admin can see why a member stopped hearing from them', async () => {
    await POST(makeRequest(TEXTER, 'STOP'));
    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'sms_inbound', status: 'opted_out', phone: TEXTER }),
    );
  });
});

// ─── Text-to-Give ────────────────────────────────────────────────────────────

describe('POST /api/sms/incoming — the reply is metered, never returned inline', () => {
  it('sends the reply through the funnel, billed to the tenant that owns the number', async () => {
    await POST(makeRequest(TEXTER, 'give'));

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    const [number, to, body, meter] = mockSendSms.mock.calls[0];
    expect(number).toMatchObject({ phoneNumber: TENANT_NUMBER });
    expect(to).toBe(TEXTER);
    // THE-303 — the PUBLIC giving route. The reply used to carry `/?giving=1`,
    // which is the SPA root and bounces a signed-out texter to auth.
    expect(body).toBe('Give here: https://t1.theharvest.app/giving');
    // Tenant resolved SERVER-SIDE from the To-number index, not from anything
    // the texter controls. 🔴 'platform' since THE-314: Harvest pays.
    expect(meter).toEqual({ tenantId: 't1', source: 'platform' });
  });

  it('acknowledges with a plain 2xx and no message body for the provider to send', async () => {
    // A reply carried in the response would be an outbound SMS that never
    // touched the funnel — unmetered, uncapped and billed to Harvest.
    const res = await POST(makeRequest(TEXTER, 'GIVE'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it('logs the reply with its real segment count', async () => {
    mockSendSms.mockResolvedValue({ ok: true, sid: 'SM1', segments: 2 });
    await POST(makeRequest(TEXTER, 'GIVE'));
    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'sms_inbound', status: 'replied', segments: 2 }),
    );
  });

  it('logs "blocked" — not a silent drop — when the cap refuses the reply', async () => {
    mockSendSms.mockResolvedValue({ ok: false, code: 'sms_cap_reached', error: 'cap' });
    await POST(makeRequest(TEXTER, 'GIVE'));

    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'sms_inbound', status: 'blocked', errorCode: 'cap' }),
    );
  });

  it('logs "blocked" when the plan does not carry SMS', async () => {
    mockSendSms.mockResolvedValue({ ok: false, code: 'plan_not_entitled', error: 'Ministry only' });
    await POST(makeRequest(TEXTER, 'GIVE'));
    expect(mockLogAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked', errorCode: 'Ministry only' }),
    );
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
    mockGetNumber.mockResolvedValue({
      numberId: 'num_1', phoneNumber: TENANT_NUMBER, profileId: 't1', status: 'active',
      country: 'US', monthlyCostUsd: 3, purchasedAt: '',
      text2give: { enabled: false, keyword: 'GIVE' },
    });
    await POST(makeRequest(TEXTER, 'GIVE'));
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('does not send for an unknown number (no tenant to bill)', async () => {
    await POST(makeRequest(TEXTER, 'GIVE', '+19995550000'));
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('does not send when the ministry has released its number', async () => {
    mockGetNumber.mockResolvedValue(null);
    await POST(makeRequest(TEXTER, 'GIVE'));
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('ignores a signed event for another platform without acting on it', async () => {
    const body = JSON.stringify({
      type: 'message.received',
      data: { message: { platform: 'instagram', from: TEXTER, to: TENANT_NUMBER, text: 'GIVE' } },
    });
    const res = await POST(
      new NextRequest('https://theharvest.app/api/sms/incoming', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zernio-signature': crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex'),
        },
        body,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});
