import { describe, expect, it } from 'vitest';

import {
  editorConfirmSentence,
  initialScheduleWallClock,
  publicPostMatchesHost,
  readBlogCategory,
  scheduleWallClockError,
  wallClockAfterPickerChange,
} from '@/lib/blog/visibility';

const NOW = new Date('2026-06-01T15:00:00.000Z');
const ZONE = 'America/Los_Angeles';

describe('schedule wall clock', () => {
  it('requires a date and a real future instant', () => {
    expect(scheduleWallClockError('', ZONE, NOW)).toBe('Choose a date and time.');
    expect(scheduleWallClockError('   ', ZONE, NOW)).toBe('Choose a date and time.');
    expect(scheduleWallClockError('2026-07-20T09:00', '', NOW)).toBe('Choose a timezone.');
    expect(scheduleWallClockError('2026-07-20T09:00', 'Not/AZone', NOW)).toBe('Choose a timezone.');
    expect(scheduleWallClockError('2026-03-08T02:30', ZONE, NOW)).toBe('That date does not exist in this timezone.');
    expect(scheduleWallClockError('2020-01-01T09:00', ZONE, NOW)).toBe('Scheduled date must be in the future.');
    expect(scheduleWallClockError('2026-07-20T09:00', ZONE, NOW)).toBeNull();
  });

  it('keeps the chosen date when the picker is cancelled', () => {
    expect(wallClockAfterPickerChange('2026-07-20T09:00', '')).toBe('2026-07-20T09:00');
    expect(wallClockAfterPickerChange('', '')).toBe('');
    expect(wallClockAfterPickerChange('2026-07-20T09:00', '2026-07-21T10:00')).toBe('2026-07-21T10:00');
  });

  it('does not offer a published post its past publish date', () => {
    expect(initialScheduleWallClock({
      status: 'published',
      publishedAt: '2026-09-28T16:00:00.000Z',
    }, ZONE)).toBe('');
    expect(initialScheduleWallClock({ status: 'draft', publishedAt: '2026-09-28T16:00:00.000Z' }, ZONE)).toBe('');
    expect(initialScheduleWallClock(null, ZONE)).toBe('');
    expect(initialScheduleWallClock({
      status: 'scheduled',
      publishedAt: '2026-12-01T18:00:00.000Z',
    }, 'UTC')).toBe('2026-12-01T18:00');
  });

  it('describes a schedule before any request', () => {
    expect(editorConfirmSentence('schedule', '2026-12-01T10:00', 'UTC')).toContain('hidden until');
    expect(editorConfirmSentence('publishNow', '', 'UTC')).toBe('This post becomes public on the ministry page now.');
    expect(editorConfirmSentence('unschedule', '', 'UTC')).toBe('This post returns to a draft and leaves the ministry page.');
  });
});

describe('public article host', () => {
  it('shows a post on its own ministry and on a host with no ministry', () => {
    expect(publicPostMatchesHost('sample', 'sample')).toBe(true);
    expect(publicPostMatchesHost('sample', null)).toBe(true);
    expect(publicPostMatchesHost('sample', 'other')).toBe(false);
  });
});

describe('blog category', () => {
  it('reads only a stored string', () => {
    expect(readBlogCategory(null)).toBe('');
    expect(readBlogCategory({})).toBe('');
    expect(readBlogCategory({ category: '  Communion  ' })).toBe('Communion');
    expect(readBlogCategory({ category: '' })).toBe('');
    expect(readBlogCategory({ category: { name: 'Communion' } })).toBe('');
  });
});
