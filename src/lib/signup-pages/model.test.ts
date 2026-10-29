import { describe, expect, it } from 'vitest';
import { isValidSignupFieldSettings, isValidSignupHandle, parseSignupAnswers, parseSignupPageInput, signupRowsToCsv } from './model';

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

  it('accepts only bounded, explicitly configured page properties', () => {
    const fields = {
      name: { enabled: true, required: true }, email: { enabled: true, required: false },
      phone: { enabled: false, required: false }, prayerRequest: { enabled: false, required: false },
    };
    const page = { handle: 'prayer-night', title: ' Prayer night ', message: ' Welcome ', fields };
    expect(parseSignupPageInput(page)).toEqual({ ...page, title: 'Prayer night', message: 'Welcome' });
    expect(parseSignupPageInput({ ...page, ownerId: 'attacker' })).toBeNull();
    expect(parseSignupPageInput({ ...page, title: ' '.repeat(2) })).toBeNull();
    expect(parseSignupPageInput({ ...page, message: 'x'.repeat(1001) })).toBeNull();
    expect(parseSignupAnswers({ name: ' Alex ', email: 'alex@example.org' }, fields)).toEqual({ name: 'Alex', email: 'alex@example.org' });
    expect(parseSignupAnswers({ name: ' ' }, fields)).toBeNull();
    expect(parseSignupAnswers({ name: 'Alex', phone: '123' }, fields)).toBeNull();
    expect(parseSignupAnswers({ name: 'Alex', email: 'invalid' }, fields)).toBeNull();
    expect(parseSignupAnswers({ name: 'Alex', unexpected: 'value' }, fields)).toBeNull();
  });
});
