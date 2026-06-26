import type { Timestamp } from 'firebase/firestore';

/**
 * Client-side query helpers.
 *
 * These exist so that Firestore listeners can filter by a SINGLE field on the
 * server (which only needs an automatic single-field index) and then apply any
 * additional filtering/sorting in memory. This deliberately avoids composite
 * indexes entirely — no `where(A) + where(B)` and no `where(A) + orderBy(B)`
 * combinations that would otherwise require a manually-created index.
 */

type TimestampLike = Timestamp | { toMillis?: () => number; seconds?: number } | null | undefined;

/**
 * Milliseconds for a Firestore Timestamp-like value.
 * Pending writes (serverTimestamp() not yet resolved) and null sort to the end,
 * so an optimistic just-sent message lands at the bottom of an ascending list.
 */
export function tsMillis(v: TimestampLike): number {
  if (v && typeof (v as any).toMillis === 'function') return (v as any).toMillis();
  if (v && typeof (v as any).seconds === 'number') return (v as any).seconds * 1000;
  return Number.MAX_SAFE_INTEGER;
}

/** Return a new array sorted by a Timestamp field. Default ascending. */
export function sortByTime<T>(arr: T[], field: keyof T, dir: 'asc' | 'desc' = 'asc'): T[] {
  const sorted = [...arr].sort((a, b) => tsMillis(a[field] as TimestampLike) - tsMillis(b[field] as TimestampLike));
  return dir === 'desc' ? sorted.reverse() : sorted;
}

/** Return a new array sorted by a string field (locale-aware). Default ascending. */
export function sortByString<T>(arr: T[], field: keyof T, dir: 'asc' | 'desc' = 'asc'): T[] {
  const sorted = [...arr].sort((a, b) =>
    String(a[field] ?? '').localeCompare(String(b[field] ?? ''))
  );
  return dir === 'desc' ? sorted.reverse() : sorted;
}

/** Return a new array sorted by a numeric field. Default ascending. */
export function sortByNumber<T>(arr: T[], field: keyof T, dir: 'asc' | 'desc' = 'asc'): T[] {
  const sorted = [...arr].sort((a, b) => Number(a[field] ?? 0) - Number(b[field] ?? 0));
  return dir === 'desc' ? sorted.reverse() : sorted;
}
