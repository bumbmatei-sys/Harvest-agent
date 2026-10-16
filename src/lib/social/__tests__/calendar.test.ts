import { describe, expect, it } from 'vitest';
import { calendarDayKey, defaultCalendarDay, postsOnCalendarDay, undatedDrafts } from '../calendar';

const zone = 'America/Chicago';
const now = new Date(Date.UTC(2024, 2, 15, 12));

const posts = [
  { id: 'draft', scheduledFor: null, content: 'undated' },
  { id: 'today', scheduledFor: '2024-03-15T18:00:00.000Z', content: 'today' },
  { id: 'later', scheduledFor: '2024-03-20T15:00:00.000Z', content: 'later' },
  { id: 'past', scheduledFor: '2024-03-04T15:00:00.000Z', content: 'past' },
];

describe('social calendar days', () => {
  it('keys a timestamp in the ministry timezone and leaves an undated draft off the calendar', () => {
    expect(calendarDayKey('2024-03-12T15:00:00.000Z', zone)).toBe('2024-03-12');
    expect(calendarDayKey(null, zone)).toBeNull();
    expect(undatedDrafts(posts).map((post) => post.id)).toEqual(['draft']);
  });

  it('defaults to today when today has a post, otherwise the next scheduled day, otherwise today', () => {
    expect(defaultCalendarDay(posts, zone, now)).toBe('2024-03-15');
    expect(defaultCalendarDay(posts.filter((post) => post.id !== 'today'), zone, now)).toBe('2024-03-20');
    expect(defaultCalendarDay(posts.filter((post) => post.id === 'past' || post.id === 'draft'), zone, now)).toBe('2024-03-15');
  });

  it('lists only the selected day and never the undated draft', () => {
    expect(postsOnCalendarDay(posts, '2024-03-20', zone).map((post) => post.id)).toEqual(['later']);
    expect(postsOnCalendarDay(posts, '2024-03-15', zone).map((post) => post.content)).not.toContain('undated');
    expect(postsOnCalendarDay(posts, '2024-03-16', zone)).toEqual([]);
  });
});
