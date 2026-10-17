/**
 * Calendar day keys for the social scheduler.
 *
 * A key is `YYYY-MM-DD` in the ministry's timezone. Undated drafts are not
 * days. The default day is today when something is scheduled then, otherwise
 * the next scheduled day, otherwise today.
 */

export interface CalendarPost {
  readonly scheduledFor: string | null;
}

export function calendarDayKey(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) return null;
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

export function defaultCalendarDay(
  posts: readonly CalendarPost[],
  timeZone: string,
  now: Date,
): string {
  const today = calendarDayKey(now.toISOString(), timeZone) ?? now.toISOString().slice(0, 10);
  const keys = posts
    .map((post) => calendarDayKey(post.scheduledFor, timeZone))
    .filter((key): key is string => Boolean(key));
  if (keys.includes(today)) return today;
  const upcoming = keys.filter((key) => key > today).sort();
  return upcoming[0] ?? today;
}

export function postsOnCalendarDay<T extends CalendarPost>(
  posts: readonly T[],
  day: string,
  timeZone: string,
): T[] {
  return posts.filter((post) => calendarDayKey(post.scheduledFor, timeZone) === day);
}

export function undatedDrafts<T extends CalendarPost>(posts: readonly T[]): T[] {
  return posts.filter((post) => post.scheduledFor == null);
}
