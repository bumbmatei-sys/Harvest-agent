/**
 * Eden's Publish → Queue (docs/prd/screenshots/14-social-scheduler, 011/012):
 * three columns, Drafts · Scheduled · Sent, with Scheduled grouped under day
 * headings ("Today Oct 21", "Tomorrow Oct 22", "Thursday Oct 23") in the
 * ministry's zone, soonest first, and Sent newest first.
 */
import { calendarDayKey } from './calendar';

export interface QueuePost {
  readonly id: string;
  readonly status: 'draft' | 'scheduled' | 'sent' | string;
  readonly scheduledFor: string | null;
}

export interface QueueDay<T> { readonly key: string; readonly label: string; readonly date: string; readonly posts: T[] }

const noonOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const addDays = (key: string, days: number) => {
  const next = noonOf(key);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

/** "Today", "Tomorrow", else the weekday; and "Oct 21". */
export function queueDayLabel(key: string, todayKey: string): { label: string; date: string } {
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(noonOf(key));
  if (key === todayKey) return { label: 'Today', date };
  if (key === addDays(todayKey, 1)) return { label: 'Tomorrow', date };
  if (key === addDays(todayKey, -1)) return { label: 'Yesterday', date };
  return { label: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(noonOf(key)), date };
}

const instant = (post: QueuePost) => (post.scheduledFor ? Date.parse(post.scheduledFor) : NaN);

/** Scheduled posts by day in the zone, soonest first; a post with no time sits under "No time". */
export function scheduledByDay<T extends QueuePost>(posts: readonly T[], timeZone: string, now: Date): QueueDay<T>[] {
  const todayKey = calendarDayKey(now.toISOString(), timeZone) ?? now.toISOString().slice(0, 10);
  const days = new Map<string, T[]>();
  const sorted = posts.filter(p => p.status === 'scheduled')
    .sort((a, b) => (Number.isNaN(instant(a)) ? 1 : 0) - (Number.isNaN(instant(b)) ? 1 : 0) || instant(a) - instant(b));
  for (const post of sorted) {
    const key = calendarDayKey(post.scheduledFor, timeZone) ?? '';
    days.set(key, [...(days.get(key) ?? []), post]);
  }
  return [...days].map(([key, list]) => key
    ? { key, ...queueDayLabel(key, todayKey), posts: list }
    : { key: 'none', label: 'No time', date: '', posts: list });
}

/** Sent posts, newest first. */
export function sentNewestFirst<T extends QueuePost>(posts: readonly T[]): T[] {
  return posts.filter(p => p.status === 'sent').sort((a, b) => (instant(b) || 0) - (instant(a) || 0));
}

/** "9:30 PM" for a post's time in the zone. */
export function queueTime(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(at);
}

/** "Oct 21" for a post's day in the zone. */
export function queueDate(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(at);
}
