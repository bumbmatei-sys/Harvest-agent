import { describe, it, expect } from 'vitest';
import { toSafeDate } from '../format-date';

describe('toSafeDate — robust to every Firestore date shape (BUG 1)', () => {
  const iso = '2026-07-04T12:00:00.000Z';
  const ms = Date.parse(iso);

  it('parses a Firestore Timestamp (has toDate)', () => {
    const ts = { toDate: () => new Date(iso) };
    expect(toSafeDate(ts)?.getTime()).toBe(ms);
  });

  it('parses an ISO string (what the donation webhook writes)', () => {
    expect(toSafeDate(iso)?.getTime()).toBe(ms);
  });

  it('parses an epoch-millis number', () => {
    expect(toSafeDate(ms)?.getTime()).toBe(ms);
  });

  it('passes a JS Date through unchanged', () => {
    expect(toSafeDate(new Date(iso))?.getTime()).toBe(ms);
  });

  it('parses a serialized { seconds } Timestamp-like', () => {
    const secs = Math.floor(ms / 1000);
    expect(toSafeDate({ seconds: secs })?.getTime()).toBe(secs * 1000);
  });

  it('returns null for null / undefined', () => {
    expect(toSafeDate(null)).toBeNull();
    expect(toSafeDate(undefined)).toBeNull();
  });

  it('returns null for an unparseable string', () => {
    expect(toSafeDate('not a date')).toBeNull();
  });

  it('never throws when toDate() throws — returns null', () => {
    const bad = { toDate: () => { throw new Error('boom'); } };
    expect(toSafeDate(bad)).toBeNull();
  });

  it('returns null when toDate() yields an invalid Date', () => {
    expect(toSafeDate({ toDate: () => new Date('nope') })).toBeNull();
  });
});
