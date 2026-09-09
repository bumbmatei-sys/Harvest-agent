import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';
import { GMAIL_FEATURE_ENABLED } from '../lib/gmail-feature';
import { PLAN_ORDER } from '../utils/plan-features';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-339 — a serving invitation still reaches a volunteer, with BOTH switches
 * off and NOTHING connected
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THIS IS THE BLOCKING QUESTION OF THE TICKET, ANSWERED BY RUNNING IT.
 *
 * #481 hid SMS on the founder's stated ground that "people can receive the
 * serving notif from church service planner through resend mail". If rota mail
 * went out over the church's own Gmail, hiding Gmail would take the replacement
 * away too and leave a volunteer with no way to learn they are on the rota.
 *
 * ⚠️ IT DOES NOT. THE-340 moved the email half onto Resend, from a
 * Harvest-controlled sender on the verified `theharvest.app` domain, before this
 * ticket existed. `rota-invite.ts` still MENTIONS Gmail thirteen times and every
 * one of them is prose — which is exactly the shape that has fooled a guard in
 * this series before, so the transport here is established by SENDING, not by
 * grepping.
 *
 * ─── 🔴 WHAT IS AND IS NOT MOCKED, AND WHY IT DECIDES THE ANSWER ────────────
 *
 * THE-324's suite mocks `SMS_FEATURE_ENABLED` to `true`. THIS ONE DOES NOT MOCK
 * EITHER SWITCH. Both are read at their real on-disk values, because the
 * question is not "does the email half work in principle" but "does a volunteer
 * hear about a service in the product as it actually ships, with SMS hidden and
 * Gmail hidden at the same time". A mocked switch could not ask that.
 *
 * Stubbed: `firebase-admin`, the `resend` PACKAGE and the SMS provider — the
 * outside world, and nothing else. `rota-invite.ts`, `transactional-email.ts`,
 * `sms-send.ts` and `plan-features.ts` are all REAL and in the path, so the
 * funnel that would have to be broken for a volunteer to hear nothing is the
 * one being exercised.
 */

const TENANT = 'grace';
const PERSON = 'user-ben';
const PHONE = '+12125551234';
const EMAIL = 'ben@example.org';

/**
 * A Sunday years out, with `toFake: ['Date']` below holding the clock still.
 *
 * ⚠️ #468 — NOT PINNED NEAR TODAY. A fixture a few days ahead of the day it was
 * written turns `main` red for everyone once the date rolls past it, and here it
 * would not even fail loudly: `recordResponse` refuses a service that has
 * already started, so the accept case would quietly begin asserting against a
 * past service instead of breaking. `toFake` is load-bearing — without it the
 * clock is real and the offsets below stop meaning anything.
 */
const SERVICE_AT = new Date('2032-09-12T10:00:00.000Z');
const NOW = new Date('2032-09-09T09:00:00.000Z');

const { docData, mockSmsSend, mockResendSend } = vi.hoisted(() => ({
  docData: new Map<string, any>(),
  mockSmsSend: vi.fn(),
  mockResendSend: vi.fn(),
}));

function makeQuery(path: string, field?: string, value?: unknown, cap?: number): any {
  return {
    where: (f: string, _op: string, v: unknown) => makeQuery(path, f, v, cap),
    limit: (n: number) => makeQuery(path, field, value, n),
    async get() {
      const prefix = `${path}/`;
      const docs = [...docData.entries()]
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .filter(([, d]) => (field === undefined ? true : d?.[field] === value))
        .map(([k, d]) => ({ id: k.slice(prefix.length), data: () => d }));
      return { docs: cap === undefined ? docs : docs.slice(0, cap), empty: docs.length === 0 };
    },
  };
}

class FakeTimestamp {
  constructor(public readonly _d: Date) {}
  toDate() { return this._d; }
}

function resolveSentinels(value: any, prev: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(value ?? {})) {
    if (v && typeof v === 'object' && (v as any).__sentinel === 'serverTimestamp') out[k] = new FakeTimestamp(NOW);
    else if (v && typeof v === 'object' && (v as any).__sentinel === 'increment') {
      out[k] = (typeof prev?.[k] === 'number' ? prev[k] : 0) + (v as any).by;
    } else out[k] = v;
  }
  return out;
}

function makeDocRef(path: string): any {
  return {
    path,
    async get() {
      const d = docData.get(path);
      return { exists: d !== undefined, data: () => d, id: path.split('/').pop() };
    },
    async set(value: any, options?: any) {
      const prev = options?.merge ? (docData.get(path) ?? {}) : {};
      docData.set(path, { ...prev, ...resolveSentinels(value, prev) });
    },
    collection: (sub: string) => makeColRef(`${path}/${sub}`),
  };
}
function makeColRef(path: string): any {
  return { ...makeQuery(path), doc: (id: string) => makeDocRef(`${path}/${id}`) };
}

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    increment: (by: number) => ({ __sentinel: 'increment', by }),
  },
  Timestamp: Object.assign(FakeTimestamp, { fromDate: (d: Date) => new FakeTimestamp(d) }),
}));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeColRef(name),
    async runTransaction(fn: (tx: any) => Promise<any>) {
      return fn({
        get: (ref: any) => ref.get(),
        set: (ref: any, value: any, options?: any) => { void ref.set(value, options); },
      });
    },
  },
}));
vi.mock('@/lib/zernio', () => ({ zernioSendSms: mockSmsSend }));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockResendSend }; } }));

/**
 * 🔴 `composio-client` is the Gmail transport, and it is stubbed to EXPLODE
 * rather than to succeed. If any part of the rota path still reached Gmail, the
 * cases below would fail with that message instead of quietly sending twice.
 */
vi.mock('@/lib/composio-client', () => ({
  executeComposioAction: vi.fn(() => {
    throw new Error('the rota path reached Composio — Gmail is still in the transport');
  }),
  getConnectionStatus: vi.fn(() => {
    throw new Error('the rota path read a Gmail connection');
  }),
}));

const { sendInvitation, recordResponse, findByToken } = await import('../lib/rota-invite');
const { isRotaToken } = await import('@/components/events/rota-invitations');

const ASSIGNMENT = {
  planId: 'plan-1',
  itemId: 'item-a',
  eventId: 'evt-1',
  eventTitle: 'Sunday Morning Gathering',
  itemTitle: 'Welcome and call to worship',
  personId: PERSON,
  personName: 'Benjamin Achterberg',
  startsAt: SERVICE_AT,
};

/** A church on `plan`, with NOTHING connected: no SMS number, no Gmail grant. */
function seed(plan: string) {
  docData.clear();
  docData.set(`tenants/${TENANT}`, { name: 'Grace Chapel', plan });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockSmsSend.mockResolvedValue({ ok: true, id: 'sm_1', segments: 1 });
  mockResendSend.mockResolvedValue({ data: { id: 're_1' }, error: null });
  process.env.RESEND_API_KEY = 're-test-key';
});

/** Every tier this build sells, so no tier is left out by being forgotten. */
const TIERS = PLAN_ORDER.filter((p) => p !== 'free');

describe('rota invitations still reach a volunteer, with SMS and Gmail both off', () => {
  it('🔴 both switches are genuinely off — these cases describe the shipped state', () => {
    // Without this the whole file could be asserting the easy case.
    expect(SMS_FEATURE_ENABLED, 'SMS came back — these cases are about it being off').toBe(false);
    expect(GMAIL_FEATURE_ENABLED, 'Gmail came back — these cases are about it being off').toBe(false);
    expect(TIERS.length, 'no paid tier was exercised').toBeGreaterThan(0);
  });

  it.each(TIERS)('%s: the volunteer receives the invitation, over Resend, with nothing connected', async (plan) => {
    seed(plan);
    expect([...docData.keys()].filter((k) => k.includes('/integrations/')),
      'the fixture connected something — this case is about a church that has not').toEqual([]);

    const report = await sendInvitation(
      TENANT, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );

    // 🔴 DELIVERED — not "the invitation exists to be shared by hand".
    expect(report.channels.email, `${plan}: the volunteer got no email`).toBe('sent');
    expect(report.delivered, `${plan}: nothing was delivered`).toBe(true);

    // 🔴 THE TRANSPORT, NAMED. One send, through the Resend package, to that
    // volunteer. Composio is stubbed to throw, so Gmail cannot have carried it.
    expect(mockResendSend, `${plan}: the email did not go through Resend`).toHaveBeenCalledTimes(1);
    const sent = mockResendSend.mock.calls[0][0];
    expect(sent.to).toBe(EMAIL);
    expect(String(sent.from), `${plan}: the sender is not a Harvest-controlled address`)
      .toContain('theharvest.app');

    // 🔴 And SMS is a named `unavailable`, not a silent nothing.
    expect(report.channels.sms, `${plan}: SMS reported something other than unavailable`).toBe('unavailable');
    expect(mockSmsSend, `${plan}: a hidden channel reached its provider`).not.toHaveBeenCalled();
  });

  it.each(TIERS)('%s: the accept link is unchanged in shape and still answerable', async (plan) => {
    seed(plan);
    const report = await sendInvitation(
      TENANT, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );

    // The URL SHAPE, not a pinned string: a token of the right kind, carried in
    // the mail the volunteer actually receives.
    expect(isRotaToken(report.token), `${plan}: the token is not a rota token`).toBe(true);
    expect(report.url, `${plan}: no accept link`).toBeTruthy();
    const url = new URL(report.url as string);
    expect(url.protocol, `${plan}: the accept link is not https`).toBe('https:');
    expect(url.searchParams.get('token') ?? url.pathname,
      `${plan}: the accept link stopped carrying the token`).toContain(report.token as string);
    expect(String(mockResendSend.mock.calls[0][0].text),
      `${plan}: the email does not carry the link`).toContain(report.url as string);

    // 🔴 SCOPE: it is answerable, and answering it records. A link nobody can
    // act on would satisfy a shape check and fail the volunteer.
    const answered = await recordResponse(TENANT, report.token as string, 'accepted', NOW);
    expect(answered?.status, `${plan}: the accept link could not be answered`).toBe('accepted');
    expect(await findByToken(TENANT, report.token as string),
      `${plan}: the invitation vanished`).not.toBeNull();
  });
});
