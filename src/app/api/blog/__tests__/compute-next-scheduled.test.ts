import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: () => ({}) } }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'ts', increment: () => 'inc' },
}));
vi.mock('@/lib/ai-config', () => ({
  getMimoChatUrl: () => 'https://mimo.test/chat',
  MIMO_MODEL: 'mimo-test',
}));

const { computeNextScheduled } = await import('../generate/route');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeNextScheduled', () => {
  it('defaults to UTC when timezone is omitted (back-compat, unchanged behavior)', () => {
    // Wed 2026-07-15 12:00:00 UTC
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const next = computeNextScheduled('daily', 1, 8);
    expect(next.toISOString()).toBe('2026-07-16T08:00:00.000Z');
  });

  it('treats an explicit "UTC" timezone identically to the pre-timezone behavior', () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const next = computeNextScheduled('daily', 1, 8, 'UTC');
    expect(next.toISOString()).toBe('2026-07-16T08:00:00.000Z');
  });

  it('converts a local hour in a non-UTC timezone to the correct UTC instant (PDT, summer)', () => {
    // 2026-07-15 is in Pacific Daylight Time (UTC-7).
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const next = computeNextScheduled('daily', 1, 8, 'America/Los_Angeles');
    // 8 AM PDT (UTC-7) on 2026-07-16 == 15:00 UTC.
    expect(next.toISOString()).toBe('2026-07-16T15:00:00.000Z');
  });

  it('converts a local hour in a non-UTC timezone to the correct UTC instant (PST, winter — DST case)', () => {
    // 2026-01-15 is in Pacific Standard Time (UTC-8).
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const next = computeNextScheduled('daily', 1, 8, 'America/Los_Angeles');
    // 8 AM PST (UTC-8) on 2026-01-16 == 16:00 UTC.
    expect(next.toISOString()).toBe('2026-01-16T16:00:00.000Z');
  });

  it('resolves the correct UTC day across a DST transition boundary', () => {
    // 2026-03-08 is the day of the US spring-forward transition (2 AM -> 3 AM PDT).
    vi.setSystemTime(new Date('2026-03-08T05:00:00Z')); // 2026-03-07 21:00 PST
    const next = computeNextScheduled('daily', 1, 8, 'America/Los_Angeles');
    // Next day (2026-03-08) is already in PDT (UTC-7) since the transition is at 2 AM.
    expect(next.toISOString()).toBe('2026-03-08T15:00:00.000Z');
  });

  it('computes the correct weekly target day in the tenant timezone', () => {
    // 2026-07-15 is a Wednesday. dayOfWeek 1 = Monday -> next Monday 2026-07-20.
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const next = computeNextScheduled('weekly', 1, 8, 'America/Los_Angeles');
    expect(next.toISOString()).toBe('2026-07-20T15:00:00.000Z');
  });

  it('handles a timezone ahead of UTC, rolling the UTC date backward', () => {
    // Asia/Tokyo is UTC+9. 8 AM JST on 2026-07-16 == 2026-07-15 23:00 UTC.
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    const next = computeNextScheduled('daily', 1, 8, 'Asia/Tokyo');
    expect(next.toISOString()).toBe('2026-07-15T23:00:00.000Z');
  });
});
