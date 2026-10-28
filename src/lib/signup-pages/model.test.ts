import { describe, expect, it } from 'vitest';
import { isValidSignupFieldSettings, isValidSignupHandle, signupRowsToCsv } from './model';

describe('sign-up page constraints', () => {
  it('accepts only canonical handles suitable for one URL segment', () => {
    expect(isValidSignupHandle('prayer-night-2026')).toBe(true);
    for (const handle of ['ab', 'A-name', '-abc', 'abc-', 'a--b', 'a/b', 'a.b', 'abc '.repeat(20)]) {
      expect(isValidSignupHandle(handle)).toBe(false);
    }
  });

  it('requires exact field settings and prevents required disabled fields', () => {
    const valid = {
      name: { enabled: true, required: true }, email: { enabled: false, required: false },
      phone: { enabled: false, required: false }, prayerRequest: { enabled: false, required: false },
    };
    expect(isValidSignupFieldSettings(valid)).toBe(true);
    expect(isValidSignupFieldSettings({ ...valid, extra: {} })).toBe(false);
    expect(isValidSignupFieldSettings({ ...valid, email: { enabled: false, required: true } })).toBe(false);
    expect(isValidSignupFieldSettings({ ...valid, name: { enabled: false, required: false } })).toBe(false);
  });

  it('quotes CSV delimiters and protects formula values including leading whitespace', () => {
    expect(signupRowsToCsv([['Name', 'Response'], ['A, B', 'say "hello"\nnow'], ['=1+1', '  @cmd'], ['-2', '+2']])).toBe(
      '"Name","Response"\r\n"A, B","say ""hello""\nnow"\r\n"\'=1+1","\'  @cmd"\r\n"\'-2","\'+2"',
    );
  });
});
