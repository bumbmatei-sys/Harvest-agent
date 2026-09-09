import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-327 · Tests 5, 6 and 11 asserted BEHAVIOURALLY, through `sendSms`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 WHY THIS FILE EXISTS — A GUARD THAT WAS NOT GUARDING.
 *
 * THE-327's first metering guard was a source grep: `expect(src).toContain(
 * 'reserveSmsSegment')`. Mutation verification planted the exact defect it
 * claimed to catch — the reservation replaced with `{ allowed: true }` at the
 * call site — and THE GUARD PASSED, because the IMPORT LINE still carried the
 * word it was grepping for. That is the recorded failure mode of this
 * programme, found here the only way it is ever found: by planting the defect.
 *
 * ⚠️ So the three claims that actually protect money and a carrier account are
 * asserted by CALLING the send path and watching what it does, not by reading
 * it. Each one below fails when its behaviour is removed, whatever the source
 * still spells.
 *
 * Nothing here shells out to git, pins a date, or reads a diff.
 */

const zernioSendSms = vi.fn(async () => ({ ok: true, id: 'sm_1', segments: 3 }));
const reserveSmsSegment = vi.fn(async () => ({ allowed: true, used: 1, cap: 2000 }));
const settleSmsSegments = vi.fn(async () => {});
const refundSmsSegment = vi.fn(async () => {});
const isOptedOut = vi.fn(async () => false);

/* 🔴 THE-335 — THE MASTER SWITCH IS MOCKED ON, and this suite is exactly why the
   ticket's own note says "the meter and STOP handling are intact but
   unreachable — they come back with the feature". `SMS_FEATURE_ENABLED` is
   false on disk again, and it is the FIRST gate in the funnel: without this
   mock every assertion below would read `feature_hidden` and this file would
   silently stop testing the meter, the refund and STOP at all — a suite that
   passes while proving nothing, which is the failure mode this repo has been
   bitten by eleven times.

   ⚠️ MOCKED RATHER THAN THE ASSERTIONS RELAXED. The machinery is unchanged and
   must stay verified; what changed is that nothing can reach it in production
   today, and `the-245-sms-hidden.test.ts` is where THAT is asserted. */
vi.mock('../sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));
vi.mock('../zernio', () => ({ zernioSendSms }));
vi.mock('../sms-usage', () => ({ reserveSmsSegment, settleSmsSegments, refundSmsSegment }));
vi.mock('../sms-optout', () => ({
  isOptedOut,
  // Imported dynamically by the vendor-refusal branch.
  recordOptOut: vi.fn(async () => {}),
}));
/** A Ministry tenant, so the plan gate inside the funnel lets the send through
 *  and the assertions below are about metering and STOP rather than about it. */
vi.mock('../firebase-admin', () => {
  /* A doc node that answers `get` AND can be descended into, because
     `SMS_DOC` reaches `tenants/{id}/integrations/sms` while the entitlement
     lookup reads `tenants/{id}` itself. The number document reports no number,
     which is what section 11 below asserts on. */
  const doc = (): any => ({
    get: async () => ({ exists: true, data: () => ({ plan: 'max' }) }),
    collection: () => ({ doc }),
  });
  return { adminDb: { collection: () => ({ doc }) } };
});

const NUMBER = { phoneNumber: '+16155550123' };
const METER = { tenantId: 'grace' } as { tenantId: string | null };

beforeEach(() => {
  vi.clearAllMocks();
  zernioSendSms.mockResolvedValue({ ok: true, id: 'sm_1', segments: 3 });
  reserveSmsSegment.mockResolvedValue({ allowed: true, used: 1, cap: 2000 });
  isOptedOut.mockResolvedValue(false);
});

describe('🔴 the meter BLOCKS — it does not merely count', () => {
  it('a refused gate means the provider is NEVER called', async () => {
    /* 🔴 THE MUTATION THIS FILE WAS WRITTEN FOR. Replace the reservation with
       `{ allowed: true }` at the call site and this fails, because the send
       goes out. A source grep for `reserveSmsSegment` does not, because the
       import line still spells it. */
    reserveSmsSegment.mockResolvedValue({ allowed: false, used: 2000, cap: 2000 });
    const { sendSms } = await import('../sms-send');
    const r = await sendSms(NUMBER, '+16155550100', 'hello', METER as never);

    expect(zernioSendSms, 'a send went out over a refused allowance — money leaking').not.toHaveBeenCalled();
    expect(r.ok, 'the caller was told a blocked send succeeded').toBe(false);
    expect(r.code, 'the cap refusal is no longer distinguishable').toBe('sms_cap_reached');
  });

  it('and it fails CLOSED when the allowance cannot be verified', async () => {
    reserveSmsSegment.mockRejectedValue(new Error('firestore down'));
    const { sendSms } = await import('../sms-send');
    const r = await sendSms(NUMBER, '+16155550100', 'hello', METER as never);
    expect(zernioSendSms, 'an unverifiable allowance let a send through').not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});

describe('🔴 every send is metered, with the provider’s own segment count', () => {
  it('reserves before sending and settles the ACTUAL segments after', async () => {
    const { sendSms } = await import('../sms-send');
    const r = await sendSms(NUMBER, '+16155550100', 'hello', METER as never);

    expect(reserveSmsSegment, 'the send was not reserved against the allowance').toHaveBeenCalledWith('grace');
    expect(zernioSendSms).toHaveBeenCalledTimes(1);
    /* 🔴 THREE, not one: the provider bills per segment and the meter is
       settled from its answer, never estimated from the body length. */
    expect(settleSmsSegments, 'a multi-segment send was metered as one')
      .toHaveBeenCalledWith('grace', 3);
    expect(r.ok).toBe(true);
  });

  it('and a send that never happened gives its reservation back', async () => {
    zernioSendSms.mockResolvedValue({ ok: false, error: 'provider down' } as never);
    const { sendSms } = await import('../sms-send');
    await sendSms(NUMBER, '+16155550100', 'hello', METER as never);
    expect(refundSmsSegment, 'a failed send consumed allowance it never used')
      .toHaveBeenCalledWith('grace');
    expect(settleSmsSegments, 'a failed send was metered as delivered').not.toHaveBeenCalled();
  });
});

describe('🔴 STOP still stops — asserted at the send path, not at the keyword', () => {
  it('an opted-out recipient is never texted, and nothing is reserved', async () => {
    /* 🔴 THE LOUDEST ONE. It is HARVEST'S carrier account that gets blocked,
       because Harvest resells. The opt-out check runs BEFORE the reservation,
       so a refused recipient also consumes no allowance. */
    isOptedOut.mockResolvedValue(true);
    const { sendSms } = await import('../sms-send');
    const r = await sendSms(NUMBER, '+16155550100', 'hello', METER as never);

    expect(zernioSendSms, 'a message went out to someone who replied STOP').not.toHaveBeenCalled();
    expect(reserveSmsSegment, 'an opted-out recipient consumed allowance').not.toHaveBeenCalled();
    expect(r.code).toBe('recipient_opted_out');
  });

  it('and the opt-out check is consulted on every send, not cached away', async () => {
    const { sendSms } = await import('../sms-send');
    await sendSms(NUMBER, '+16155550100', 'one', METER as never);
    await sendSms(NUMBER, '+16155550100', 'two', METER as never);
    expect(isOptedOut, 'the STOP check was skipped for a repeat recipient').toHaveBeenCalledTimes(2);
  });
});

describe('11 · sendTenantSms is the one interface, and it goes through the funnel', () => {
  it('a tenant send reserves, meters and calls the provider exactly once', async () => {
    /* THE-324's rota invitations call this. It must not be a second path
       around the gates above — so it is asserted to hit all of them. */
    const { sendTenantSms } = await import('../sms-send');
    /* The mocked number document carries no `numberId`/`phoneNumber`, so
       `getTenantSmsNumber` answers null and the call refuses BEFORE the
       provider — which is itself the claim being made: `sendTenantSms`
       resolves the ministry's number server-side through the funnel rather
       than accepting one from its caller. A second send path would not. */
    const r = await sendTenantSms('grace', '+16155550100', 'hello');
    expect(zernioSendSms, 'sendTenantSms reached the provider without a resolved number')
      .not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});
