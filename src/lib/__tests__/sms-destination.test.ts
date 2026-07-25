import { describe, it, expect } from 'vitest';
import { checkDestination, NON_US_MESSAGE } from '../sms-destination';

/**
 * US-only destination gate. The point of these tests is that `+1` is NOT the
 * rule — the NANP calling code covers Canada and much of the Caribbean at
 * different carrier rates, so the country comes from the AREA CODE.
 */

describe('checkDestination — US numbers pass', () => {
  it('accepts a US number in E.164', () => {
    expect(checkDestination('+12125551234')).toEqual({ allowed: true, country: 'US' });
  });

  it('accepts a US number written with spaces/punctuation', () => {
    expect(checkDestination('+1 (212) 555-1234').allowed).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(checkDestination('  +12125551234  ').allowed).toBe(true);
  });
});

describe('checkDestination — +1 is NOT enough', () => {
  it('REJECTS Canada, which shares the +1 country code', () => {
    const r = checkDestination('+16135550123'); // Ottawa
    expect(r.allowed).toBe(false);
    expect(r.country).toBe('CA');
    expect(r.reason).toBe(NON_US_MESSAGE);
  });

  it('REJECTS a Caribbean +1 number (Bahamas)', () => {
    const r = checkDestination('+12425551234');
    expect(r.allowed).toBe(false);
    expect(r.country).not.toBe('US');
  });

  it('REJECTS the Dominican Republic (+1 809)', () => {
    expect(checkDestination('+18095551234').allowed).toBe(false);
  });
});

describe('checkDestination — international numbers are rejected with a clear reason', () => {
  it.each([
    ['+442071838750', 'GB'],
    ['+5521987654321', 'BR'],
    ['+33612345678', 'FR'],
    ['+8613800138000', 'CN'],
  ])('rejects %s (%s)', (number, country) => {
    const r = checkDestination(number);
    expect(r.allowed).toBe(false);
    expect(r.country).toBe(country);
    expect(r.reason).toBe(NON_US_MESSAGE);
  });
});

describe('checkDestination — malformed / non-E.164 input fails CLOSED', () => {
  it.each([
    ['12125551234'],       // no + — not E.164
    ['not-a-number'],
    ['+1234'],             // too short to resolve
    ['+1'],
    ['555-1234'],
  ])('rejects %s without claiming a country', (input) => {
    const r = checkDestination(input);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not a valid phone number/i);
  });

  it('rejects empty / null / undefined with a "required" message', () => {
    for (const v of ['', '   ', null, undefined]) {
      const r = checkDestination(v as any);
      expect(r.allowed).toBe(false);
      expect(r.country).toBeNull();
      expect(r.reason).toMatch(/required/i);
    }
  });

  it('never throws on garbage input', () => {
    expect(() => checkDestination('☎️☎️☎️')).not.toThrow();
    expect(checkDestination('☎️☎️☎️').allowed).toBe(false);
  });
});
