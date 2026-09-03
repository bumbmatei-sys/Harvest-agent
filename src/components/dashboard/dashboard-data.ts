/**
 * THE-276 — the Overview tab's read layer, and the rule that decides whether a
 * number is allowed on screen at all.
 *
 * ─── The defect this file exists to not repeat ───────────────────────────────
 *
 * `AdminDashboardHome` reads `limit(500)` with no `orderBy`, three times, and
 * then reports `members.length` as "Members" and the newest five of those rows
 * as "Recent Members". Firestore serves an unordered `limit(N)` in `__name__`
 * order and document ids are random, so those 500 rows are an ARBITRARY sample,
 * not the newest 500 and not the whole collection. A tenant with 800 members is
 * told it has 500; the "Recent Members" list is the newest five of a random
 * sample; "new this week" counts only whichever new members happened to fall
 * inside it. #405 found 41 files with that shape and 11 of them on the money
 * path. A trend chart drawn on it would be a lie with a nice curve.
 *
 * ─── The rule ────────────────────────────────────────────────────────────────
 *
 * 🔴 A figure reaches the screen only when the read behind it is EXACT or
 * PROVABLY COMPLETE. There is no third case, and no widget may fall back to a
 * zero: a `0` and a "we could not read this" render identically, which is the
 * whole failure above. Everything a widget wants is therefore one of two types
 * — {@link Figure} or {@link Series} — and each of them carries either a value
 * or a REASON, so the empty state can say what is missing rather than implying
 * the ministry has none of it.
 *
 * Two mechanisms produce a trustworthy read, and this module uses only these:
 *
 *   1. EXACT — `getCountFromServer()`. A server-side aggregation over the whole
 *      query; it does not load documents and it is not clamped by any ceiling.
 *      Every count on the Overview tab comes from one. (`useCRMCounts` already
 *      established this here — THE-67 replaced exactly this defect in the CRM.)
 *
 *   2. COMPLETE — the whole matching set, held at once. A series needs dates,
 *      which means documents, so the count is taken FIRST: at or under
 *      {@link CRM_FETCH_LIMIT} every matching document is fetched and the
 *      buckets are computed over all of them. Above it the series is refused.
 *
 * ⚠️ WHY COMPLETENESS AND NOT ORDERING, for the series. An ordered window would
 * be the cheaper proof — fetch the newest N and check the oldest one predates
 * the window — but it cannot be used for the two collections that matter here:
 *
 *   • `users` has NO composite index for (tenantId, createdAt) in
 *     firestore.indexes.json, so `where('tenantId') + orderBy('createdAt')`
 *     fails at runtime with failed-precondition. It cannot be ordered from
 *     here at all.
 *   • `invoices.issuedAt` holds BOTH ISO strings and Timestamps (see the
 *     `DateLike` annotation on AdminAccounting's Invoice — the donation webhook
 *     writes a string, other paths write a Timestamp). Firestore orders across
 *     types by TYPE FIRST, so `orderBy('issuedAt','desc')` returns every string
 *     row before any Timestamp row. It is a stable order; it is not a
 *     chronological one, and a `limit()` on top of it is a biased sample.
 *
 * Completeness sidesteps both: when every matching document is in hand, the
 * order they arrived in cannot change what the buckets add up to. It also needs
 * no index that does not already exist, which is why this ticket adds none.
 */
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Query,
} from 'firebase/firestore';

import { db } from '../../firebase';
import { CRM_FETCH_LIMIT } from '../../hooks/queries/useCRMQueries';
import { toSafeDate, type DateLike } from '../../utils/format-date';

/**
 * The ceiling a COMPLETE read is allowed to reach, imported rather than
 * restated: it is the same ceiling the CRM's list reads use, and a second
 * number here would be a second answer to "how much is this app willing to
 * load at once".
 */
export const DASHBOARD_FETCH_LIMIT = CRM_FETCH_LIMIT;

/** How many weekly buckets a trend covers. */
export const TREND_WEEKS = 8;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* ── The two shapes a widget is allowed to read ───────────────────────────── */

/**
 * One number, or the reason there isn't one.
 *
 * 🔴 There is deliberately no `value: number | null` variant. A nullable number
 * invites `?? 0` at the call site, and `0` is the exact lie this type exists to
 * make unspellable.
 */
export type Figure =
  | { readonly kind: 'exact'; readonly value: number }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** A single bucket of a trend: the label on the axis and what fell into it. */
export interface SeriesPoint {
  readonly label: string;
  readonly value: number;
}

/** A whole trend, or the reason there isn't one. Same discipline as `Figure`. */
export type Series =
  | { readonly kind: 'complete'; readonly points: readonly SeriesPoint[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** The reason strings, written once so a widget cannot invent a nicer one. */
export const REASON = {
  /** The read was refused — rules, network, or a missing index. */
  readFailed: 'This read did not complete, so no figure can be shown.',
  /** More documents match than may be loaded at once, so no series is safe. */
  tooManyToChart: `More than ${DASHBOARD_FETCH_LIMIT.toLocaleString()} records match, so a complete trend cannot be read from here.`,
  /** No tenant in scope: the query would be unscoped and would be rejected. */
  noTenant: 'No ministry is in scope, so this cannot be read.',
  /** The schema carries nothing to build this from. */
  noSource: (what: string) => `Nothing in this ministry's data records ${what}.`,
  /** A receipt on the ledger has no readable amount, so no total is honest. */
  unreadableReceipts: (bad: number, total: number) =>
    `${bad.toLocaleString()} of ${total.toLocaleString()} receipts carry no readable amount or type, so no giving total here would be complete.`,
} as const;

const unavailable = (reason: string) => ({ kind: 'unavailable', reason }) as const;

/* ── The two trustworthy reads ────────────────────────────────────────────── */

/**
 * EXACT — a server-side count of everything the query matches.
 *
 * Never clamped, never sampled, and it loads no documents. A rejection returns
 * `unavailable`, never `0`.
 */
export async function exactCount(q: Query, reason = REASON.readFailed): Promise<Figure> {
  try {
    return { kind: 'exact', value: (await getCountFromServer(q)).data().count };
  } catch {
    return unavailable(reason);
  }
}

/**
 * COMPLETE — every matching document, or nothing.
 *
 * The count runs first and decides. Fetching `limit(N)` and checking whether
 * `snap.size < N` would be the same test one read later, but it would also have
 * already paid for N documents to answer a question an aggregation answers for
 * a fraction of one — and on a collection above the ceiling it would hand back
 * a truncated set that looks complete.
 */
export async function completeRead<T>(
  q: Query,
  bounded: Query,
  map: (data: Record<string, unknown>, id: string) => T,
): Promise<{ kind: 'complete'; rows: T[] } | { kind: 'unavailable'; reason: string }> {
  const count = await exactCount(q);
  if (count.kind !== 'exact') return unavailable(count.reason);
  if (count.value > DASHBOARD_FETCH_LIMIT) return unavailable(REASON.tooManyToChart);
  try {
    const snap = await getDocs(bounded);
    return { kind: 'complete', rows: snap.docs.map((d) => map(d.data() as Record<string, unknown>, d.id)) };
  } catch {
    return unavailable(REASON.readFailed);
  }
}

/* ── Bucketing ────────────────────────────────────────────────────────────── */

/**
 * The last {@link TREND_WEEKS} week-boundaries, oldest first, as [start, label].
 *
 * Anchored to `now` rather than to a calendar week so the rightmost bucket is
 * always the seven days ending now — the window every delta on this tab is
 * measured over, and the one a reader assumes when a card says "this week".
 */
export function weekBuckets(now: number, weeks: number = TREND_WEEKS): { start: number; label: string }[] {
  const out: { start: number; label: string }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = now - (i + 1) * WEEK_MS;
    out.push({
      start,
      label: new Date(start + WEEK_MS - 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    });
  }
  return out;
}

/**
 * Sum `weigh(row)` into weekly buckets by `dateOf(row)`.
 *
 * ⚠️ A row whose date cannot be read is COUNTED NOWHERE and the series stays
 * `complete`, which is correct and deserves saying out loud: completeness is a
 * claim about the READ, not about the data quality of every field in it. A row
 * with an unparseable `createdAt` belongs to no week, and putting it in the
 * newest bucket (or in bucket zero) would invent a date nobody recorded.
 *
 * 🔴 EVERY ROW IS ACCOUNTED FOR, in exactly one of three places: a bucket,
 * `undatedRows`, or `outsideWindow`. That is not bookkeeping for its own sake —
 * an earlier draft dropped a row dated more than eight weeks in the FUTURE
 * silently, while counting one dated up to a week ahead into "this week", so a
 * receipt with a bad date could vanish from the chart while still being summed
 * into the ledger total beside it. Two numbers on one screen disagreeing, with
 * nothing to say which was short. The window is now closed at both ends and
 * what falls outside it is returned rather than discarded.
 *
 * `outsideWindow` is INFORMATIONAL, not a fault: most of a mature ledger is
 * older than eight weeks, and that is what a bounded window means.
 */
export function bucketWeekly<T>(
  rows: readonly T[],
  now: number,
  dateOf: (row: T) => DateLike,
  weigh: (row: T) => number = () => 1,
): { points: SeriesPoint[]; undatedRows: number; outsideWindow: number } {
  const buckets = weekBuckets(now);
  const values = new Array<number>(buckets.length).fill(0);
  let undatedRows = 0;
  let outsideWindow = 0;

  for (const row of rows) {
    const at = toSafeDate(dateOf(row))?.getTime();
    if (at == null) { undatedRows++; continue; }
    // The window is [oldest bucket start, now] — closed at both ends, so a
    // future date is outside it rather than being folded into the newest week.
    if (at < buckets[0].start || at > now) { outsideWindow++; continue; }
    // Newest bucket last: the last boundary at or before `at`.
    let idx = 0;
    for (let i = 0; i < buckets.length; i++) if (at >= buckets[i].start) idx = i;
    values[idx] += weigh(row);
  }

  return { points: buckets.map((b, i) => ({ label: b.label, value: values[i] })), undatedRows, outsideWindow };
}

/** The newest bucket against the one before it, as a signed proportion. */
export function deltaOf(points: readonly SeriesPoint[]): number | null {
  if (points.length < 2) return null;
  const current = points[points.length - 1].value;
  const previous = points[points.length - 2].value;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

/* ── Query builders — every one of them index-free ────────────────────────── */

/**
 * A tenant-scoped collection query.
 *
 * 🔴 ONE equality constraint and nothing else. That is not a simplification, it
 * is the reason this ticket needs no index: a single equality is served by the
 * automatic single-field index every Firestore collection already has, so every
 * read here works on a database nobody has migrated. `bounded` adds the ceiling
 * and still adds no ordering — ordering is what would demand a composite index,
 * and {@link completeRead} does not need one because it holds everything.
 */
export const scopedQuery = (name: string, tenantId: string) =>
  query(collection(db, name), where('tenantId', '==', tenantId));

export const boundedScopedQuery = (name: string, tenantId: string) =>
  query(collection(db, name), where('tenantId', '==', tenantId), limit(DASHBOARD_FETCH_LIMIT));

/** The tenant's receipt ledger. A subcollection, so it needs no `where` at all. */
export const invoicesQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'invoices'));

export const boundedInvoicesQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'invoices'), limit(DASHBOARD_FETCH_LIMIT));

/**
 * Published courses.
 *
 * Two equalities, which the (tenantId, status, createdAt) composite index in
 * firestore.indexes.json already serves as a prefix. The only query here that
 * leans on a declared index, and it is declared.
 */
export const publishedCoursesQuery = (tenantId: string) =>
  query(collection(db, 'courses'), where('tenantId', '==', tenantId), where('status', '==', 'published'));

/* ── Row shapes, read from the documents this app actually writes ─────────── */

export interface DatedRow { readonly createdAt: DateLike }

/**
 * A receipt.
 *
 * 🔴 `amountCents` and `type` are NULLABLE, and that is the whole point.
 *
 * ⚠️ `amount` is in CENTS on every invoice document — the Stripe webhook writes
 * `amount: amountCents`, and AdminAccounting divides by 100 at its own read.
 * Naming the field `amountCents` here is so a later caller cannot format it as
 * dollars by accident; that inversion shipped once already and rendered $105,500
 * as $10,550,000.
 *
 * 🔴 The earlier draft of this file coerced a missing `amount` to `0` and a
 * missing `type` to `'invoice'`, and a mutation test caught it: pointing this
 * mapper at a field the documents do not carry produced a giving total that was
 * SILENTLY TOO SMALL and a mix that filed every gift under the wrong heading,
 * with nothing on screen to say so. That is the same defect as the unordered
 * `limit(500)`, one layer down — a default standing in for a read that failed.
 * `null` has no such reading, and {@link readableReceipts} below turns it into
 * a refusal rather than a smaller number.
 */
export interface InvoiceRow {
  readonly amountCents: number | null;
  readonly issuedAt: DateLike;
  readonly type: string | null;
}

const asDate = (v: unknown): DateLike => (v ?? null) as DateLike;

export const toDatedRow = (data: Record<string, unknown>): DatedRow => ({ createdAt: asDate(data.createdAt) });

export const toInvoiceRow = (data: Record<string, unknown>): InvoiceRow => ({
  amountCents: typeof data.amount === 'number' ? data.amount : null,
  issuedAt: asDate(data.issuedAt),
  type: typeof data.type === 'string' ? data.type : null,
});

/** A receipt this app can actually read: an amount in cents and a type. */
export interface ReadableReceipt { readonly amountCents: number; readonly issuedAt: DateLike; readonly type: string }

/**
 * Narrow a complete ledger read to receipts that can be summed, or refuse.
 *
 * 🔴 STRICT ON THE MONEY PATH, deliberately, and unlike {@link bucketWeekly}'s
 * treatment of an undatable row. A gift with no readable date is missing from
 * one bar of a chart; a gift with no readable AMOUNT makes every total on the
 * screen wrong by exactly that gift, and a total that is quietly short is the
 * money-path version of the number this whole module exists to refuse. #405
 * found 11 of its 41 unordered reads on the money path for the same reason. So
 * one unreadable receipt refuses the giving figures outright and says how many
 * — a founder can then go and look at the document.
 */
export function readableReceipts(
  rows: readonly InvoiceRow[],
): { kind: 'complete'; rows: ReadableReceipt[] } | { kind: 'unavailable'; reason: string } {
  const bad = rows.filter((r) => r.amountCents === null || r.type === null).length;
  if (bad > 0) return unavailable(REASON.unreadableReceipts(bad, rows.length));
  return { kind: 'complete', rows: rows as ReadableReceipt[] };
}

/* ── Live now ─────────────────────────────────────────────────────────────── */

export interface LiveNow { readonly active: boolean; readonly title: string }

/**
 * The tenant's current livestream. One document read by id — exact by
 * construction, with no sampling for this module's rule to have an opinion on.
 */
export async function readLiveNow(tenantId: string): Promise<LiveNow | null> {
  try {
    const snap = await getDoc(doc(db, 'tenants', tenantId, 'livestream', 'current'));
    const data = snap.data();
    return { active: !!data?.active, title: (data?.title as string) || 'Live now' };
  } catch {
    return null;
  }
}
