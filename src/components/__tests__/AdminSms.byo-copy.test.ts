import { describe, it, expect, vi } from 'vitest';

/**
 * A tenant sending on its OWN Twilio credentials is subject to no Harvest
 * allotment, so the SMS surface must not show it one. This pins the copy that
 * replaces the meter for those tenants: their own volume, who bills them, and
 * no ceiling — the advertised-vs-delivered gap THE-20 closed, kept closed.
 *
 * Firebase is mocked out only so the component module can be imported for its
 * exported constants; nothing is rendered.
 */
vi.mock('@/firebase', () => ({ db: {}, auth: {}, app: {}, messaging: Promise.resolve(null) }));

const { BYO_BILLING_NOTE, segmentUnitNote } = await import('../AdminSms');
const { BYO_CREDENTIALS_NOTE } = await import('../settings/SmsSection');

describe('the BYO billing note', () => {
  it('says whose account it is and who Twilio bills', () => {
    expect(BYO_BILLING_NOTE).toMatch(/your own Twilio account/i);
    expect(BYO_BILLING_NOTE).toMatch(/Twilio bills you directly/i);
  });

  it("says the plan's SMS allotment does not apply", () => {
    expect(BYO_BILLING_NOTE).toMatch(/allotment doesn't apply/i);
  });

  it('never promises or implies a limit they are not subject to', () => {
    expect(BYO_BILLING_NOTE).not.toMatch(/upgrade/i);
    expect(BYO_BILLING_NOTE).not.toMatch(/limit reached|sending is paused|out of segments/i);
    // No "N of M" ceiling, and no allotment number quoted at them.
    expect(BYO_BILLING_NOTE).not.toMatch(/\b(250|500|2,000|4,000)\b/);
  });

  it('still states the SEGMENT unit, like the metered copy does', () => {
    expect(BYO_BILLING_NOTE).toMatch(/160 characters counts as more than one segment/i);
    // The metered copy keeps quoting the cap — that path is unchanged.
    expect(segmentUnitNote(4_000)).toMatch(/^4,000 SMS segments per month/);
  });
});

describe('the Twilio settings note', () => {
  it('says these are the church\'s own credentials and that Twilio bills them', () => {
    expect(BYO_CREDENTIALS_NOTE).toMatch(/your own Twilio credentials/i);
    expect(BYO_CREDENTIALS_NOTE).toMatch(/Twilio bills you directly/i);
    expect(BYO_CREDENTIALS_NOTE).toMatch(/allotment doesn't apply/i);
  });

  it('still states the US-only destination limit, which applies to BYO too', () => {
    expect(BYO_CREDENTIALS_NOTE).toMatch(/only be sent to US numbers/i);
  });
});
