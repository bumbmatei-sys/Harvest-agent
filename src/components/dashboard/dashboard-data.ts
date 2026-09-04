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
  /**
   * THE-309 — form responses live under the ministry that owns the form, so
   * there is no apex-level set to read. Same shape as the giving widgets'
   * refusal on the apex and for the same reason: summing every church's
   * responses is a number this product does not define.
   */
  perMinistryOnly: 'Form responses are recorded per ministry, so there is no platform-wide total.',
  /**
   * THE-309 — the responses are counted one form at a time, so every form has
   * to be enumerated first. Above the ceiling that enumeration is itself a
   * truncated sample, and a total summed over a sample of the forms is short by
   * exactly the forms it never opened. Refused rather than shortened.
   */
  tooManyForms: `More than ${DASHBOARD_FETCH_LIMIT.toLocaleString()} forms exist, so every one's responses cannot be counted from here.`,
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
): Promise<CompleteRows<T>> {
  return (await countedRead(q, bounded, map)).rows;
}

/** Every matching document, or the reason there are none to be had. */
export type CompleteRows<T> =
  | { readonly kind: 'complete'; readonly rows: T[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The count AND the documents, from ONE traversal.
 *
 * 🔴 {@link completeRead} already computes both and then throws the count away,
 * which is fine when a caller wants only a series. THE-309 wants both from the
 * same read and this is the whole reason why: the "Form submissions" card shows
 * a figure and a `% vs last week` chip, and if the chip came from a SECOND read
 * the two could disagree — the card would report a total taken at one instant
 * and a trend taken at another, over a collection a public form is writing to
 * while the dashboard loads. One aggregation and one page per form, feeding
 * both, makes that disagreement unspellable rather than unlikely.
 *
 * The two halves keep their SEPARATE guarantees, exactly as KpiCard already
 * assumes: `count` is EXACT whenever the aggregation answered, even when the
 * collection is too large for its documents to be held, so a card can show a
 * trustworthy figure beside a refused trend. That is not a fallback — the
 * aggregation is unclamped and correct at any size; it is the documents that
 * have a ceiling.
 */
export interface CountedRead<T> {
  readonly count: Figure;
  readonly rows: CompleteRows<T>;
}

export async function countedRead<T>(
  q: Query,
  bounded: Query,
  map: (data: Record<string, unknown>, id: string) => T,
): Promise<CountedRead<T>> {
  const count = await exactCount(q);
  if (count.kind !== 'exact') return { count, rows: unavailable(count.reason) };
  if (count.value > DASHBOARD_FETCH_LIMIT) return { count, rows: unavailable(REASON.tooManyToChart) };
  try {
    const snap = await getDocs(bounded);
    return {
      count,
      rows: { kind: 'complete', rows: snap.docs.map((d) => map(d.data() as Record<string, unknown>, d.id)) },
    };
  } catch {
    return { count, rows: unavailable(REASON.readFailed) };
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
 *
 * ⚠️ `weeks` WAS ADDED BY THE-294 and DEFAULTS to {@link TREND_WEEKS}, so every
 * existing caller is unchanged — the Overview, Growth and Giving series are
 * still eight buckets wide and still computed by exactly this arithmetic.
 *
 * 🔴 It exists because one collection may not be charted over eight weeks at
 * all. `prayer_requests` rows are DELETED by a nightly cron thirty days after
 * they are written (`/api/prayer-requests/cleanup`, `vercel.json`), so buckets
 * older than the retention window can only ever fall towards zero — an eight-
 * week prayer-wall trend would draw a collapse that is a deletion policy rather
 * than a fact about the church. A window is the honest response; a shorter
 * chart is not a smaller claim, it is the only true one.
 */
export function bucketWeekly<T>(
  rows: readonly T[],
  now: number,
  dateOf: (row: T) => DateLike,
  weigh: (row: T) => number = () => 1,
  weeks: number = TREND_WEEKS,
): { points: SeriesPoint[]; undatedRows: number; outsideWindow: number } {
  const buckets = weekBuckets(now, weeks);
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
 * THE-309 — the tenant's custom forms.
 *
 * A subcollection under the tenant, so like the invoice ledger it needs no
 * `where` at all: the path IS the scope. No ordering, so no index.
 */
export const formsQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'forms'));

export const boundedFormsQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'forms'), limit(DASHBOARD_FETCH_LIMIT));

/**
 * THE-309 — ONE form's responses.
 *
 * ─── Why this is a path and not a `collectionGroup('submissions')` ───────────
 *
 * 🔴 A collection-group query would read every form's responses in one go and
 * would be the obvious answer. It is not available here. `firestore.rules`
 * contains no `match /{path=**}/...` rule anywhere, and a collection-group read
 * is evaluated against those recursive matches ALONE — the
 * `tenants/{tenantId}/forms/{formId}/submissions` rule that grants the read
 * below does not apply to it. So the query is denied outright rather than
 * merely unindexed, and no index would fix it. THE-285 established exactly this
 * for `attendees`; the same rules file, the same absence, the same answer.
 *
 * ⚠️ Nor could it be granted from here. `firestore.rules` auto-deploys to
 * production on merge and CI runs no emulator tests against it, so a recursive
 * match added for a KPI would reach real tenants unverified.
 *
 * ⚠️ `firestore.indexes.json` DOES carry a `submissions` entry, and it is not
 * this one: its `queryScope` is `COLLECTION`, which serves the legacy top-level
 * inbox (see {@link readFormSubmissions}). There is no COLLECTION_GROUP index
 * for `submissions`, and adding one would be inert — `deploy-rules.yml` deploys
 * `firestore:rules,storage` only.
 */
export const formSubmissionsQuery = (tenantId: string, formId: string) =>
  query(collection(db, 'tenants', tenantId, 'forms', formId, 'submissions'));

export const boundedFormSubmissionsQuery = (tenantId: string, formId: string) =>
  query(collection(db, 'tenants', tenantId, 'forms', formId, 'submissions'), limit(DASHBOARD_FETCH_LIMIT));

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

/**
 * THE-309 — a form response, dated by the field the write path actually writes.
 *
 * 🔴 `submittedAt`, NOT `createdAt`. `/api/forms/submit` writes
 * `submittedAt: FieldValue.serverTimestamp()` and THE-298 pinned it as the ONLY
 * writer of this collection, so `createdAt` is a field these documents do not
 * carry. Mapping it would hand every row a `null` date, and `bucketWeekly`
 * would then file all of them under `undatedRows` — a COMPLETE read whose trend
 * is eight empty buckets, and a `+0%` chip drawn over a form that is being
 * filled in. That is the same defect as reading the wrong collection, one field
 * down, and it would look identical on screen.
 *
 * ⚠️ There is deliberately no `?? data.createdAt` fallback. A fallback to a
 * field nothing writes cannot rescue a row; it can only hide the day the write
 * path changes its mind, which is precisely when this wants to fail loudly.
 *
 * ⚠️ It is single-typed — a server Timestamp on every row, never an ISO string
 * — which `form-answers.ts` records for the same collection and the same
 * reason. `bucketWeekly` reads it through `toSafeDate` regardless.
 */
export const toSubmissionRow = (data: Record<string, unknown>): DatedRow => ({
  createdAt: asDate(data.submittedAt),
});

/**
 * ⚠️ TIGHTENED BY THE-290: `Number.isFinite`, not `typeof === 'number'`.
 *
 * 🔴 `NaN` AND `Infinity` ARE BOTH `typeof 'number'`. A receipt carrying either
 * one passed the old test, reached `bucketWeekly` as a weight and poisoned every
 * bucket it touched into `NaN` — which renders as the literal string "NaN" on a
 * money chart, and makes the eight-week total unusable rather than short. The
 * `readableReceipts` refusal was already the right response and simply never
 * fired for those two values.
 *
 * This is the same defect #421 caught one value over, not a new rule: a missing
 * amount became `0` (a total quietly short), and a non-finite one became `NaN`
 * (a total visibly broken). Both are a read that failed wearing a number, and
 * both are now REFUSED AND COUNTED by `readableReceipts`.
 *
 * ⚠️ IT CHANGES NO FIGURE FOR ANY WELL-FORMED DOCUMENT. Every finite `amount`
 * maps exactly as before, so the Overview tab's giving total and mix are
 * unchanged for every ledger that could previously produce a usable number. What
 * changes is only the ledger that previously produced `NaN`, which now says how
 * many receipts are unreadable so a founder can go and look at them.
 */
export const toInvoiceRow = (data: Record<string, unknown>): InvoiceRow => ({
  amountCents: typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : null,
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

/* ── Form submissions ─────────────────────────────────────────────────────── */

/** The figure and the trend for the "Form submissions" card, plus what it cost. */
export interface FormSubmissionsRead {
  readonly figure: Figure;
  readonly series: Series;
  /** How many forms were opened to produce them. Reported, never rendered. */
  readonly formsRead: number;
}

/**
 * THE-309 — the responses a ministry has actually received.
 *
 * ─── The defect ──────────────────────────────────────────────────────────────
 *
 * 🔴 This card used to read a TOP-LEVEL `submissions` collection filtered by
 * `tenantId`, and nothing has written a document there for a long time. The
 * form endpoint writes to `tenants/{tenantId}/forms/{formId}/submissions`, a
 * SUBCOLLECTION per form — `/api/forms/submit` says so in its own docblock and
 * THE-298 pinned it as the only writer. So the count was a correct aggregation
 * over the wrong path: exact, unclamped, honestly computed, and always zero.
 * A founder filed a response and the dashboard told them they had none.
 *
 * ⚠️ The top-level collection is NOT dead and is not being redirected away
 * from. `firestore.rules` still carries a `match /submissions/{subId}` rule
 * calling it the "legacy top-level form-submission inbox", `AdminInbox` still
 * lists, triages and deletes it, and the tenant-delete route still sweeps it.
 * Nothing in this repository CREATES a document there any more, which is why
 * the KPI reads zero, but the rows that exist are real history and AdminInbox
 * is untouched by this ticket. This card simply stops being the thing that
 * reports on them: it names itself "Form submissions" and the live form
 * pipeline is the subcollection.
 *
 * ─── How the count is taken, and what it is worth ────────────────────────────
 *
 * 🔴 The figure is EXACT, not merely complete. Every form's responses are
 * counted by their own `getCountFromServer()` aggregation and those exact
 * counts are SUMMED; a sum of exact counts over a set of forms that is itself
 * completely enumerated is exact. It loads no documents to reach the number and
 * is not clamped by the fetch ceiling, so a form with 40,000 responses counts
 * for 40,000.
 *
 * 🔴 IF ANY PART REFUSES, THE WHOLE FIGURE REFUSES. A sum missing one form's
 * aggregation is not a smaller true number, it is a wrong one, and it would
 * render as a confident total — the #421 rule, in the one place a partial
 * result is most tempting. The same holds one level up: the forms themselves
 * must be enumerated COMPLETELY before any of this means anything, because a
 * truncated list of forms yields a total short by whatever it never opened.
 *
 * The trend comes from the SAME traversal, never a second one — see
 * {@link countedRead}. It keeps the weaker guarantee the ceiling imposes: if
 * one form holds more responses than may be loaded at once, the figure is still
 * exact and the trend is refused, and KpiCard shows the count with the reason
 * underneath it.
 *
 * ─── What this costs ─────────────────────────────────────────────────────────
 *
 * ⚠️ One aggregation for the forms, one page of form documents, then one
 * aggregation AND one page per form: `2 + 2F` round trips for `F` forms,
 * billed as roughly `1 + F` (the forms) + `F` (the aggregations) + `S` (the
 * responses themselves) reads. A church with 20 forms and 150 responses pays
 * about 191. The `S` half is not new — the old code already loaded every
 * matching document to draw the trend — so the increase this ticket introduces
 * is the `1 + 2F` the per-form fan-out costs, and it buys a number that was
 * previously always zero. The aggregations run concurrently.
 *
 * ⚠️ A DENORMALISED `submissionCount` ON THE FORM DOCUMENT WOULD BE ONE READ
 * PER FORM AND IS NOT USED. It already exists — `/api/forms/submit` increments
 * it and AdminForms renders it — and it cannot carry a KPI, for two independent
 * reasons this ticket did not introduce and does not fix:
 *
 *   • It drifts SHORT. The response `add()` and the `increment()` are two
 *     sequential awaits with no transaction, so a failure between them leaves a
 *     response that no counter counts. THE-288 found exactly this on
 *     `attendeeCount` and its warning is the reason this was checked.
 *   • It drifts LONG. `member-erasure` deletes response documents out of these
 *     subcollections and never decrements the counter, so an erasure leaves the
 *     figure permanently above the truth.
 *
 * A drifting counter is neither exact nor provably complete, so #421 forbids it
 * on screen. Making it trustworthy means a transaction in
 * `/api/forms/submit` — the write path, which is out of scope here — and it is
 * reported rather than built.
 */
export async function readFormSubmissions(
  tenantId: string,
  now: number,
  weeks: number = TREND_WEEKS,
): Promise<FormSubmissionsRead> {
  const refuse = (reason: string): FormSubmissionsRead => ({
    figure: unavailable(reason),
    series: unavailable(reason),
    formsRead: 0,
  });

  // The forms, completely or not at all — see the header. `id` is all that is
  // wanted; a form's title and fields are AdminForms' business, not this card's.
  const forms = await countedRead(formsQuery(tenantId), boundedFormsQuery(tenantId), (_data, id) => id);
  if (forms.count.kind !== 'exact') return refuse(forms.count.reason);
  if (forms.rows.kind !== 'complete') {
    // The aggregation answered, so the refusal is the ceiling rather than the
    // read: say which, because "too many forms" and "the read failed" send a
    // founder to different places.
    return refuse(forms.count.value > DASHBOARD_FETCH_LIMIT ? REASON.tooManyForms : forms.rows.reason);
  }

  // 🔴 No forms is an EXACT zero, not a refusal, and the distinction is the
  // whole point of this card: a ministry that has built no form has received no
  // response, and the aggregation above proves it. This is the one zero on this
  // card that is allowed, because it was read rather than defaulted to.
  if (forms.rows.rows.length === 0) {
    return {
      figure: { kind: 'exact', value: 0 },
      series: { kind: 'complete', points: weekBuckets(now, weeks).map((b) => ({ label: b.label, value: 0 })) },
      formsRead: 0,
    };
  }

  const reads = await Promise.all(
    forms.rows.rows.map((formId) =>
      countedRead(
        formSubmissionsQuery(tenantId, formId),
        boundedFormSubmissionsQuery(tenantId, formId),
        toSubmissionRow,
      ),
    ),
  );

  const refused = reads.find((r) => r.count.kind !== 'exact');
  if (refused && refused.count.kind === 'unavailable') return refuse(refused.count.reason);

  const value = reads.reduce((sum, r) => sum + (r.count.kind === 'exact' ? r.count.value : 0), 0);
  const figure: Figure = { kind: 'exact', value };

  // The trend, from the documents that same traversal already fetched. Gated
  // separately: one oversized form costs the shape, never the number.
  const partial = reads.find((r) => r.rows.kind !== 'complete');
  if (partial && partial.rows.kind === 'unavailable') {
    return { figure, series: unavailable(partial.rows.reason), formsRead: forms.rows.rows.length };
  }

  const rows = reads.flatMap((r) => (r.rows.kind === 'complete' ? r.rows.rows : []));
  return {
    figure,
    series: { kind: 'complete', points: bucketWeekly(rows, now, (r) => r.createdAt, undefined, weeks).points },
    formsRead: forms.rows.rows.length,
  };
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
