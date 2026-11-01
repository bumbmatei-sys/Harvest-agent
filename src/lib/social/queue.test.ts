import { describe, expect, it } from 'vitest';
import { queueDate, queueDayLabel, queueTime, scheduledByDay, sentNewestFirst } from './queue';

const post = (id: string, status: string, scheduledFor: string | null) => ({ id, status, scheduledFor });

describe("Eden's Publish queue (#581)", () => {
  it('names days Today, Tomorrow and Yesterday, then by weekday', () => {
    expect(queueDayLabel('2026-10-21', '2026-10-21')).toEqual({ label: 'Today', date: 'Oct 21' });
    expect(queueDayLabel('2026-10-22', '2026-10-21')).toEqual({ label: 'Tomorrow', date: 'Oct 22' });
    expect(queueDayLabel('2026-10-20', '2026-10-21')).toEqual({ label: 'Yesterday', date: 'Oct 20' });
    expect(queueDayLabel('2026-10-23', '2026-10-21')).toEqual({ label: 'Friday', date: 'Oct 23' });
    expect(queueDayLabel('2026-11-01', '2026-10-31')).toEqual({ label: 'Tomorrow', date: 'Nov 1' });
  });

  it('groups scheduled posts by day in the zone, soonest first, and leaves drafts and sent out', () => {
    const now = new Date('2026-10-21T15:00:00Z');
    const days = scheduledByDay([
      post('late', 'scheduled', '2026-10-22T03:30:00Z'), // 10:30 PM Oct 21 in Chicago
      post('next', 'scheduled', '2026-10-22T15:00:00Z'),
      post('early', 'scheduled', '2026-10-21T16:00:00Z'),
      post('draft', 'draft', '2026-10-21T17:00:00Z'),
      post('sent', 'sent', '2026-10-20T17:00:00Z'),
      post('undated', 'scheduled', null),
    ], 'America/Chicago', now);
    expect(days.map(d => [d.label, d.date, d.posts.map(p => p.id)])).toEqual([
      ['Today', 'Oct 21', ['early', 'late']],
      ['Tomorrow', 'Oct 22', ['next']],
      ['No time', '', ['undated']],
    ]);
  });

  it('lists sent posts newest first', () => {
    expect(sentNewestFirst([post('a', 'sent', '2026-10-01T00:00:00Z'), post('b', 'sent', '2026-10-05T00:00:00Z'), post('c', 'draft', null)]).map(p => p.id)).toEqual(['b', 'a']);
  });

  it('shows the time and day in the zone, and nothing for a missing or bad time', () => {
    expect(queueTime('2026-10-22T03:30:00Z', 'America/Chicago')).toBe('10:30 PM');
    expect(queueDate('2026-10-22T03:30:00Z', 'America/Chicago')).toBe('Oct 21');
    expect(queueTime(null, 'UTC')).toBe('');
    expect(queueDate('nonsense', 'UTC')).toBe('');
  });
});
