import { describe, it, expect } from 'vitest';
import {
  MEMBER_CAP_REFUSED_CODE,
  MEMBER_CAP_UNAVAILABLE_CODE,
  MEMBER_CAP_UNAVAILABLE_MESSAGE,
  memberCapRefusalMessage,
} from '../member-cap-copy';

/**
 * THE-201 / AC-9 — the refusal copy.
 *
 * The person reading this string is a new believer someone just led to Christ,
 * standing next to the person who invited them, on a phone. Not an admin, not a
 * buyer. They cannot see the plan, cannot upgrade it, and did nothing wrong.
 *
 * These assertions pin the four things the copy must DO and the one big thing
 * it must NOT: mention money, plans, limits, capacity or error codes.
 */
describe('memberCapRefusalMessage', () => {
  it('names the ministry it was given', () => {
    expect(memberCapRefusalMessage('Grace Church')).toContain('Grace Church');
  });

  it('points at whoever invited them', () => {
    expect(memberCapRefusalMessage('Grace Church')).toMatch(/invited you/i);
  });

  it('promises the same email works once room is made', () => {
    expect(memberCapRefusalMessage('Grace Church')).toMatch(/same email/i);
  });

  it('says it is not their fault', () => {
    expect(memberCapRefusalMessage('Grace Church')).toMatch(/nothing went wrong on your end/i);
  });

  it('mentions no plan, upgrade, billing, limit, cap, quota, error code or Harvest', () => {
    // D10. The reader can act on none of these, and naming them turns a human
    // problem into a billing one addressed to the wrong person.
    expect(memberCapRefusalMessage('Grace Church')).not.toMatch(
      /plan|upgrade|billing|subscription|tier|support|limit|cap|quota|error|contact us|Harvest/i,
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
  ])('falls back to "This ministry" for %s — never a blank, an id, or "Harvest"', (_l, name) => {
    const message = memberCapRefusalMessage(name as string | null | undefined);
    expect(message.startsWith('This ministry')).toBe(true);
    expect(message).not.toMatch(/Harvest/i);
  });

  it('differs from the named variant ONLY in the leading noun phrase', () => {
    // One shared body constant, so the two can never drift apart.
    const named = memberCapRefusalMessage('Grace Church');
    const fallback = memberCapRefusalMessage(null);
    expect(named.slice('Grace Church'.length)).toBe(fallback.slice('This ministry'.length));
  });

  it('trims a padded name rather than rendering the padding', () => {
    expect(memberCapRefusalMessage('  Grace Church  ')).toBe(
      memberCapRefusalMessage('Grace Church'),
    );
  });
});

describe('MEMBER_CAP_UNAVAILABLE_MESSAGE (C3)', () => {
  it('never claims the ministry is full — we do not know that', () => {
    // The count or the tenant read failed. Telling a real new believer that a
    // ministry with room to spare is full, over an infrastructure blip, is the
    // exact silent lie the Silent-Failure Rule exists to prevent.
    expect(MEMBER_CAP_UNAVAILABLE_MESSAGE).not.toMatch(/full|capacity|limit|invited/i);
  });

  it('says the failure is ours and invites a retry with the same address', () => {
    expect(MEMBER_CAP_UNAVAILABLE_MESSAGE).toMatch(/on our side/i);
    expect(MEMBER_CAP_UNAVAILABLE_MESSAGE).toMatch(/try again/i);
    expect(MEMBER_CAP_UNAVAILABLE_MESSAGE).toMatch(/still available/i);
  });
});

describe('the machine codes', () => {
  it('are the exact strings both routes and AuthPage key off', () => {
    // Clients branch on these, never on the prose — so the prose can be
    // rewritten without breaking a caller, and these cannot be.
    expect(MEMBER_CAP_REFUSED_CODE).toBe('member_cap_reached');
    expect(MEMBER_CAP_UNAVAILABLE_CODE).toBe('capacity_check_unavailable');
  });
});
