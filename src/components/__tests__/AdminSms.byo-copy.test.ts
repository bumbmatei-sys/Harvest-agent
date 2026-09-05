import { describe, it, expect, vi } from 'vitest';

/**
 * 🔴 THE-314 REVERSED WHAT THIS FILE GUARDS, and the reversal is the point.
 *
 * It used to pin the BRING-YOUR-OWN copy: a church on its own Twilio
 * credentials is billed by Twilio directly and is subject to no Harvest
 * allotment, so the SMS surface must not show it one.
 *
 * Harvest now RESELLS. It buys and holds the number, pays for every segment,
 * and bills the church — so the old copy is not merely stale, it is FALSE, and
 * a false statement about who bills you sits on a money surface. The property
 * being guarded has not changed at all: the copy must say who pays, and must
 * never show a ceiling that does not apply or hide one that does. Only the
 * truth it has to tell has changed.
 *
 * Firebase is mocked out only so the component module can be imported for its
 * exported constants; nothing is rendered.
 */
vi.mock('@/firebase', () => ({ db: {}, auth: {}, app: {}, messaging: Promise.resolve(null) }));

const { LEGACY_BYO_BILLING_NOTE, segmentUnitNote } = await import('../AdminSms');
const { RESOLD_NUMBER_NOTE, RELEASE_WARNING } = await import('../settings/SmsSection');

describe('the resold-number note', () => {
  it('says Harvest provides and bills for the number', () => {
    expect(RESOLD_NUMBER_NOTE).toMatch(/Harvest buys and holds this number/i);
    expect(RESOLD_NUMBER_NOTE).toMatch(/bills you for it/i);
  });

  it("says the plan's allowance DOES apply — the opposite of the BYO note it replaced", () => {
    expect(RESOLD_NUMBER_NOTE).toMatch(/charged against your plan/i);
    expect(RESOLD_NUMBER_NOTE).not.toMatch(/allotment doesn't apply/i);
  });

  it('🔴 never tells a church it holds a carrier account or is billed by one', () => {
    // The exact false claim the swap creates if this copy is left alone.
    expect(RESOLD_NUMBER_NOTE).not.toMatch(/twilio/i);
    expect(RESOLD_NUMBER_NOTE).not.toMatch(/your own (account|credentials)/i);
    expect(RESOLD_NUMBER_NOTE).not.toMatch(/bills you directly/i);
  });

  it('still states the US-only destination limit, which is unchanged', () => {
    expect(RESOLD_NUMBER_NOTE).toMatch(/only be sent to US numbers/i);
  });
});

describe('the release warning', () => {
  it('🔴 says the number cannot be recovered and cannot be moved elsewhere', () => {
    // The vendor documents no port-out. A church that published this number
    // loses it, and it must be told that BEFORE the button, not after.
    expect(RELEASE_WARNING).toMatch(/cannot be recovered/i);
    expect(RELEASE_WARNING).toMatch(/cannot be moved to another provider/i);
  });
});

describe('the historical BYO volume note', () => {
  it('describes months recorded before Harvest provided numbers', () => {
    expect(LEGACY_BYO_BILLING_NOTE).toMatch(/before Harvest provided numbers/i);
    expect(LEGACY_BYO_BILLING_NOTE).toMatch(/no Harvest plan allotment applied/i);
  });

  it('no longer claims a third party bills the church, because none does', () => {
    expect(LEGACY_BYO_BILLING_NOTE).not.toMatch(/twilio/i);
    expect(LEGACY_BYO_BILLING_NOTE).not.toMatch(/bills you directly/i);
  });

  it('never promises or implies a limit they are not subject to', () => {
    expect(LEGACY_BYO_BILLING_NOTE).not.toMatch(/upgrade/i);
    expect(LEGACY_BYO_BILLING_NOTE).not.toMatch(/limit reached|sending is paused|out of segments/i);
    // No "N of M" ceiling, and no allotment number quoted at them.
    expect(LEGACY_BYO_BILLING_NOTE).not.toMatch(/\b(250|500|2,000|4,000)\b/);
  });

  it('still states the SEGMENT unit, like the metered copy does', () => {
    expect(LEGACY_BYO_BILLING_NOTE).toMatch(/160 characters counts as more than one segment/i);
    // The metered copy keeps quoting the cap — that path is unchanged, and it
    // is the path every sending tenant is on now.
    expect(segmentUnitNote(2_000)).toMatch(/^2,000 SMS segments per month/);
  });
});
