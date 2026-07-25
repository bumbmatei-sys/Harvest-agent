import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Sentry instrumentation of the swallowed failures OUTSIDE the money paths
 * (THE-24; #221 did the eight money/provisioning files).
 *
 * Like the money-path suite, this is primarily an ANTI-REGRESSION suite. The
 * instrumentation is purely additive, so every scenario asserts the exact status
 * code and response body the handler returned BEFORE it, alongside the capture.
 * `@sentry/nextjs` is mocked but `@/lib/money-path-sentry` is NOT, so what gets
 * asserted is the tag/context shape that actually reaches Sentry.
 *
 * Three routes are covered, chosen to span the three capture shapes:
 *   • pledge/submit          — a best-effort integration (Resend) at `warning`,
 *                              and a lost public submission at `error`
 *   • forms/submit           — a lost public submission at `error`
 *   • prayer-requests/cleanup — an unattended cron at `warning`
 */

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

const { state, mockResendSend, mockSendAutomatedSms } = vi.hoisted(() => ({
  state: {
    campaign: null as any,
    pledgeAdd: null as null | (() => any),
    form: null as any,
    formSubmissionAdd: null as null | (() => any),
    prayerQuery: null as null | (() => any),
  },
  mockResendSend: vi.fn().mockResolvedValue({ error: null }),
  mockSendAutomatedSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('resend', () => ({ Resend: class { emails = { send: mockResendSend }; } }));
vi.mock('@/lib/twilio', () => ({ sendAutomatedSms: mockSendAutomatedSms }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'ts', increment: (n: number) => `inc:${n}` },
  Timestamp: { now: () => 'now' },
}));

vi.mock('@/lib/firebase-admin', () => {
  function collection(name: string): any {
    if (name === 'campaigns') {
      return { doc: () => ({ get: async () => state.campaign }) };
    }
    if (name === 'tenants') {
      return {
        doc: () => ({
          // Tenant name lookup (pledge) — always present.
          get: async () => ({ exists: true, data: () => ({ name: 'Test Ministry' }) }),
          collection: (sub: string) => {
            if (sub === 'pledges') return { add: async () => state.pledgeAdd!() };
            if (sub === 'forms') {
              return {
                doc: () => ({
                  get: async () => state.form,
                  set: async () => undefined,
                  collection: () => ({ add: async () => state.formSubmissionAdd!() }),
                }),
              };
            }
            throw new Error(`unexpected subcollection ${sub}`);
          },
        }),
      };
    }
    if (name === 'prayer_requests') {
      const q: any = { where: () => q, limit: () => q, get: async () => state.prayerQuery!() };
      return q;
    }
    if (name === 'contacts') {
      const q: any = { where: () => q, limit: () => q, get: async () => ({ docs: [] }) };
      return q;
    }
    throw new Error(`unexpected collection ${name}`);
  }
  return { adminDb: { collection, batch: () => ({ delete: () => {}, commit: async () => {} }) } };
});

const { POST: pledgePOST } = await import('../pledge/submit/route');
const { POST: formPOST } = await import('../forms/submit/route');
const { GET: cleanupGET } = await import('../prayer-requests/cleanup/route');

/** Every captureContext Sentry received this test. */
function contexts(): any[] {
  return mockCaptureException.mock.calls.map((c) => c[1]);
}
function captureFor(step: string): any {
  return contexts().find((c) => c.tags?.step === step);
}

function postJson(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://tenant.theharvest.app${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
  mockResendSend.mockResolvedValue({ error: null });
  state.campaign = {
    exists: true,
    data: () => ({ tenantId: 't1', campaignType: 'pledge', isActive: true, title: 'Building Fund' }),
  };
  state.pledgeAdd = () => ({ id: 'pl_1' });
  state.form = {
    exists: true,
    data: () => ({ active: true, fields: [], title: 'Connect Card' }),
  };
  state.formSubmissionAdd = () => ({ id: 'sub_1' });
  state.prayerQuery = () => ({ docs: [] });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// A real donor-shaped body: name, email, phone and amount are ALL present, so
// any accidental leak into a capture would show up in the PII assertion below.
const PLEDGE_BODY = {
  tenantId: 't1',
  campaignId: 'camp_1',
  donorName: 'Ada Lovelace',
  donorEmail: 'ada@example.com',
  donorPhone: '',
  pledgeAmount: 250,
  notes: 'For the roof',
};

describe('pledge/submit — best-effort confirmation email (warning)', () => {
  it('captures with step pledge-confirmation-email and still returns the SAME 200 { success: true }', async () => {
    mockResendSend.mockRejectedValueOnce(new Error('resend 503'));

    const res = await pledgePOST(postJson('/api/pledge/submit', PLEDGE_BODY));

    // Control flow is unchanged: the pledge is recorded and the caller sees success.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const capture = captureFor('pledge-confirmation-email');
    expect(capture).toBeDefined();
    expect(capture.level).toBe('warning');
    expect(capture.tags.handled_path).toBe('true');
    expect(capture.contexts.handled_path).toEqual({
      step: 'pledge-confirmation-email',
      tenantId: 't1',
      campaignId: 'camp_1',
    });
  });

  it('captures nothing when the email succeeds', async () => {
    const res = await pledgePOST(postJson('/api/pledge/submit', PLEDGE_BODY));
    expect(res.status).toBe(200);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

describe('pledge/submit — the pledge itself is lost (error)', () => {
  it('captures with step pledge-submit and still returns the SAME 500 body', async () => {
    state.pledgeAdd = () => {
      throw new Error('firestore unavailable');
    };

    const res = await pledgePOST(postJson('/api/pledge/submit', PLEDGE_BODY));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to record pledge' });

    const capture = captureFor('pledge-submit');
    expect(capture).toBeDefined();
    expect(capture.level).toBe('error');
    expect(capture.contexts.handled_path).toEqual({
      step: 'pledge-submit',
      tenantId: 't1',
      campaignId: 'camp_1',
    });
  });

  it('leaves the validation and not-available paths uncaptured', async () => {
    // Missing required fields — an expected user-input error, never a Sentry event.
    const bad = await pledgePOST(postJson('/api/pledge/submit', { tenantId: 't1' }));
    expect(bad.status).toBe(400);

    // A campaign that isn't an active pledge campaign — control flow, not a fault.
    state.campaign = {
      exists: true,
      data: () => ({ tenantId: 't1', campaignType: 'donation', isActive: true }),
    };
    const gone = await pledgePOST(postJson('/api/pledge/submit', PLEDGE_BODY));
    expect(gone.status).toBe(410);

    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

describe('forms/submit — a lost public submission (error)', () => {
  it('captures with step form-submit and still returns the SAME 500 body', async () => {
    state.formSubmissionAdd = () => {
      throw new Error('firestore unavailable');
    };

    const res = await formPOST(
      postJson('/api/forms/submit', { tenantId: 't1', formId: 'f1', answers: { q1: 'yes' } }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to submit form' });

    const capture = captureFor('form-submit');
    expect(capture).toBeDefined();
    expect(capture.level).toBe('error');
    expect(capture.contexts.handled_path).toEqual({
      step: 'form-submit',
      tenantId: 't1',
      formId: 'f1',
    });
  });

  it('captures nothing on the success path', async () => {
    const res = await formPOST(
      postJson('/api/forms/submit', { tenantId: 't1', formId: 'f1', answers: { q1: 'yes' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, crmContactId: null });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

describe('prayer-requests/cleanup — an unattended cron (warning)', () => {
  function cronRequest(auth = 'Bearer cron-secret'): NextRequest {
    return new NextRequest('https://theharvest.app/api/prayer-requests/cleanup', {
      headers: { authorization: auth },
    });
  }

  it('captures with step prayer-requests-cleanup-cron and still returns the SAME 500 body', async () => {
    state.prayerQuery = () => {
      throw new Error('query failed');
    };

    const res = await cleanupGET(cronRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Cleanup failed' });

    const capture = captureFor('prayer-requests-cleanup-cron');
    expect(capture).toBeDefined();
    expect(capture.level).toBe('warning');
    expect(capture.contexts.handled_path).toEqual({ step: 'prayer-requests-cleanup-cron' });
  });

  it('does not capture an unauthorized call — that is the gate working, not a fault', async () => {
    const res = await cleanupGET(cronRequest('Bearer wrong'));
    expect(res.status).toBe(401);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

describe('no PII reaches Sentry from any captured path', () => {
  it('captures identifiers only, even when the request body is full of donor data', async () => {
    // Fail BOTH the email and the write so every pledge capture fires at once.
    mockResendSend.mockRejectedValue(new Error('resend 503'));
    await pledgePOST(postJson('/api/pledge/submit', PLEDGE_BODY));
    state.pledgeAdd = () => {
      throw new Error('firestore unavailable');
    };
    await pledgePOST(postJson('/api/pledge/submit', PLEDGE_BODY));

    expect(mockCaptureException.mock.calls.length).toBeGreaterThan(0);
    for (const ctx of contexts()) {
      const serialized = JSON.stringify(ctx).toLowerCase();
      for (const leak of ['ada', 'lovelace', 'example.com', '250', 'roof', '@']) {
        expect(serialized).not.toContain(leak);
      }
      // The whole surface is level/tags/contexts — no `extra`, no `user`.
      expect(Object.keys(ctx).sort()).toEqual(['contexts', 'level', 'tags']);
    }
  });
});
