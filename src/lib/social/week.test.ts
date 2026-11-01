import { describe, expect, it } from 'vitest';
import { dayHeader, hourLabel, shiftDay, weekDays, weekHours, weekSlots, weekTitle } from './week';

const post = (id: string, status: string, scheduledFor: string | null) => ({ id, status, scheduledFor });

describe("Eden's week calendar (#581)", () => {
  it('walks days across month ends and names the week', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekDays('2026-10-29')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(weekTitle('2026-10-21')).toBe('Week of October 21');
    expect(dayHeader('2026-10-21')).toEqual({ weekday: 'Wed', day: '21' });
  });

  it('places scheduled and sent posts by day and hour in the zone, soonest first, and leaves drafts and other weeks out', () => {
    const days = weekDays('2026-10-21');
    const slots = weekSlots([
      post('b', 'scheduled', '2026-10-21T19:45:00Z'), // 2:45 PM Chicago
      post('a', 'sent', '2026-10-21T19:05:00Z'), // 2:05 PM Chicago
      post('late', 'scheduled', '2026-10-22T03:30:00Z'), // 10:30 PM Oct 21 Chicago
      post('draft', 'draft', '2026-10-21T19:00:00Z'),
      post('next-week', 'scheduled', '2026-10-30T15:00:00Z'),
      post('undated', 'scheduled', null),
    ], days, 'America/Chicago');
    expect([...slots].map(([key, posts]) => [key, posts.map(p => p.id)])).toEqual([
      ['2026-10-21@14', ['a', 'b']],
      ['2026-10-21@22', ['late']],
    ]);
  });

  it('draws 8 AM to 8 PM, widened for a post outside them', () => {
    expect(weekHours(new Map())).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(weekHours(new Map([['2026-10-21@6', []], ['2026-10-21@22', []]]))[0]).toBe(6);
    expect(weekHours(new Map([['2026-10-21@6', []], ['2026-10-21@22', []]])).at(-1)).toBe(22);
    expect([0, 9, 12, 13, 23].map(hourLabel)).toEqual(['12 AM', '9 AM', '12 PM', '1 PM', '11 PM']);
  });
});
