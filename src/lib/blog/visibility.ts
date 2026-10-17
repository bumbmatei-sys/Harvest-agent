import { tsMillis } from '@/utils/query-helpers';
import type { FirestoreDate } from '@/utils/firestore-date';

/**
 * When a church blog post is on the public ministry page.
 *
 * Read-time, not a cron. A draft is never public. A scheduled post is public
 * once its UTC instant has arrived, even while the stored status is still
 * `scheduled`. A published post with no instant (older documents) stays
 * public. A published post with a future instant stays hidden until then.
 */
export type BlogStoredStatus = 'draft' | 'scheduled' | 'published';

export interface BlogVisibilityPost {
  readonly status?: string | null;
  readonly publishedAt?: FirestoreDate | null;
}

export function publishedAtMillis(value: FirestoreDate | null | undefined): number | null {
  if (value == null || value === '') return null;
  let ms: number;
  try {
    ms = tsMillis(value as never);
  } catch {
    return null;
  }
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  // tsMillis uses a sentinel far past any real date for values it cannot read.
  if (ms > 8.64e15) return null;
  return date.getTime();
}

export function isBlogPostPublic(post: BlogVisibilityPost, nowMs: number): boolean {
  if (post.status === 'draft') return false;
  const at = publishedAtMillis(post.publishedAt);
  if (post.status === 'scheduled') return at != null && at <= nowMs;
  if (post.status === 'published') return at == null || at <= nowMs;
  return false;
}

/** What the admin list calls the post, derived from status and the instant. */
export type BlogListKind = 'draft' | 'scheduled' | 'published';

export function blogListKind(post: BlogVisibilityPost, nowMs: number): BlogListKind {
  if (post.status === 'draft') return 'draft';
  const at = publishedAtMillis(post.publishedAt);
  if (post.status === 'scheduled' && (at == null || at > nowMs)) return 'scheduled';
  if (post.status === 'published' && at != null && at > nowMs) return 'scheduled';
  if (post.status === 'published' || post.status === 'scheduled') return 'published';
  return 'draft';
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
}

function zonedParts(date: Date, timeZone: string): ZonedParts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const bag: Record<string, string> = {};
    for (const part of parts) bag[part.type] = part.value;
    if (!bag.year || !bag.month || !bag.day || bag.hour == null || bag.minute == null) return null;
    let hour = bag.hour;
    if (hour === '24') hour = '00';
    return { year: bag.year, month: bag.month, day: bag.day, hour, minute: bag.minute };
  } catch {
    return null;
  }
}

/** Minutes to add to this zone's wall clock to reach UTC. */
function offsetMinutes(instant: Date, timeZone: string): number | null {
  const parts = zonedParts(instant, timeZone);
  if (!parts) return null;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    0,
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** `YYYY-MM-DDTHH:mm` in `timeZone` → UTC ISO. Null when the wall clock is not real. */
export function wallClockToUtcIso(wallClock: string, timeZone: string): string | null {
  const match = WALL_CLOCK.exec(wallClock);
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [, year, month, day, hour, minute] = match;
  const naive = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0);
  const first = offsetMinutes(new Date(naive), timeZone);
  if (first == null) return null;
  const refined = offsetMinutes(new Date(naive - first * 60000), timeZone);
  if (refined == null) return null;
  const utc = new Date(naive - refined * 60000);
  if (Number.isNaN(utc.getTime())) return null;
  const back = utcIsoToWallClock(utc.toISOString(), timeZone);
  if (back !== wallClock) return null;
  return utc.toISOString();
}

/** UTC ISO → `YYYY-MM-DDTHH:mm` as a `datetime-local` value in `timeZone`. */
export function utcIsoToWallClock(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || !isValidTimeZone(timeZone)) return '';
  const parts = zonedParts(date, timeZone);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatInstantInZone(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || !isValidTimeZone(timeZone)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '';
  }
}

/** Desktop post-list sentence. Short kind names stay available for the narrow list. */
export function blogStatusLabel(
  post: BlogVisibilityPost & { scheduleTimeZone?: string | null },
  nowMs: number,
  fallbackTimeZone: string,
): string {
  const kind = blogListKind(post, nowMs);
  if (kind === 'draft') return 'Draft';
  if (kind === 'published') return 'Published';
  const zone = post.scheduleTimeZone && isValidTimeZone(post.scheduleTimeZone)
    ? post.scheduleTimeZone
    : fallbackTimeZone;
  const at = publishedAtMillis(post.publishedAt);
  if (at == null) return 'Scheduled';
  const label = formatInstantInZone(new Date(at).toISOString(), zone);
  return label ? `Scheduled for ${label}` : 'Scheduled';
}
