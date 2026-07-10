import type { Timestamp } from 'firebase/firestore';

/**
 * Every shape a Firestore date field can actually arrive in across the codebase's
 * many writers:
 *  - a Firestore `Timestamp` (client or admin SDK) — has `.toDate()`
 *  - a serialized Timestamp-like `{ seconds, nanoseconds }`
 *  - an ISO string (the donation webhook writes `new Date().toISOString()`)
 *  - a JS `Date`
 *  - epoch millis as a number
 *  - `null` / `undefined`
 *
 * The CRM white-screened with "e.toDate is not a function" because its formatter
 * assumed every date was a Timestamp, but donation-linked docs store ISO strings.
 */
export type DateLike =
  | Timestamp
  | { toDate?: () => Date; seconds?: number }
  | Date
  | string
  | number
  | null
  | undefined;

/**
 * Coerce any {@link DateLike} into a valid `Date`, or `null` if it can't be
 * parsed. Never throws — a formatter built on this stays crash-proof regardless
 * of which writer produced the value.
 */
export function toSafeDate(ts: DateLike): Date | null {
  if (ts == null) return null;

  // Firestore Timestamp (or anything else exposing toDate()).
  if (typeof (ts as { toDate?: unknown }).toDate === 'function') {
    try {
      const d = (ts as { toDate: () => Date }).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }

  // Serialized Timestamp-like: { seconds, nanoseconds }.
  if (typeof (ts as { seconds?: unknown }).seconds === 'number') {
    const d = new Date((ts as { seconds: number }).seconds * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ISO string or epoch millis number.
  if (typeof ts === 'string' || typeof ts === 'number') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Already a Date.
  if (ts instanceof Date) {
    return Number.isNaN(ts.getTime()) ? null : ts;
  }

  return null;
}
