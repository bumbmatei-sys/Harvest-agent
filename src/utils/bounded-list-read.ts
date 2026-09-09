/**
 * THE-342 — the ONE mechanism for reading a list that might not fit.
 *
 * ─── The defect this module exists to not repeat ─────────────────────────────
 *
 * #405 found FORTY-ONE files doing `limit(N)` with no `orderBy`. Firestore has
 * no default order: an unordered `limit(N)` is served in `__name__` order over
 * random document ids, so it returns N ARBITRARY documents — not the first N,
 * not the newest N, and not a stable N between two reads. Every screen built on
 * one reports a figure it cannot support and a list whose contents nobody can
 * predict.
 *
 * The sibling defect is worse and quieter: a read that is truncated, or that
 * FAILED outright, rendering as a short list with nothing on screen to say so.
 * `AGENTS.md`'s Silent-Failure Rule names it — "a default value that hides an
 * error is a bug" — and the three sites this module was written for each had
 * it. A church with 250 library courses was shown 200 in the editor and 250 on
 * the member page: two screens, one collection, two different truths.
 *
 * ─── The rule ────────────────────────────────────────────────────────────────
 *
 * A figure reaches the screen only when the read behind it is EXACT or
 * PROVABLY COMPLETE, and a list that is short of its total must SAY SO.
 *
 * Two mechanisms produce that, and this module offers only these two:
 *
 *   1. {@link readBoundedList} — count FIRST, then load under a ceiling. The
 *      count is an unclamped server-side aggregation, so `total` is exact
 *      whatever the ceiling does; `truncated` is then a fact (`rows.length <
 *      total`) rather than a flag inferred from how a loop exited. A caller
 *      that renders `total` is honest even when it can only render some rows.
 *
 *   2. {@link readDocsByIds} — when the caller already knows exactly WHICH
 *      documents it wants, fetch those and only those. No ceiling applies
 *      because no ceiling can: the result is complete by construction. This is
 *      the right shape for resolving pointers (an adoption record naming a
 *      library course), where scanning a whole collection to keep a handful of
 *      rows is both wasteful and — once a ceiling is added to that scan — a way
 *      to make an adopted course silently vanish.
 *
 * NEITHER function catches. A rejected read THROWS, and the caller renders a
 * failure. Returning `[]` here would rebuild the exact bug the module exists to
 * remove: an empty church map reads as "no churches near you", which is a lie
 * if the query threw.
 *
 * ─── Why `orderBy(documentId())` ─────────────────────────────────────────────
 *
 * `__name__` is unique, so it is a TOTAL order: the bounded window is stable
 * between reads and can neither skip nor repeat a document. It is also the one
 * order that is free here — every automatic single-field index is keyed
 * `(field, __name__)`, so an equality `where` plus this ordering is a prefix
 * scan of an index Firestore maintains already, and NO COMPOSITE INDEX IS
 * INVOLVED. That matters twice: `query-helpers.ts` documents that this codebase
 * avoids composite indexes by design, and `firestore.indexes.json` is NOT
 * deployed by `deploy-rules.yml` (which runs `firestore:rules,storage`), so an
 * index added there would be INERT and the query would throw
 * `failed-precondition` in production.
 *
 * Ordering by a DATA field would have been wrong three times over. It needs
 * a composite index alongside any `where` (see above). It SILENTLY EXCLUDES
 * every document missing that field, which is a quiet lie of its own. And
 * `invoices.issuedAt` and `contactActivities.createdAt` each hold BOTH ISO
 * strings and Timestamps, and Firestore sorts across types by TYPE first, so a
 * mixed column pages in two blocks and a `limit()` on top of it is a biased
 * sample. Ordering by `documentId()` keeps single-typedness a property of the
 * data rather than a dependency of the read.
 *
 * Callers sort the finished set in memory, and that sort is correct BECAUSE the
 * set is either complete or openly declared short. Sorting a truncated set
 * without saying it was truncated is what made the original bug invisible.
 *
 * ─── Relationship to `dashboard-data.ts` ─────────────────────────────────────
 *
 * `countedRead` there answers a different question and deliberately keeps its
 * different answer: a TREND over a truncated set is not a weaker trend, it is a
 * wrong one, so it refuses rows entirely above its ceiling. A LIST is still
 * useful truncated — provided it says so — so this module returns the rows and
 * the truth about them together. The two share the rule (exact or provably
 * complete) and differ only in what they do when the ceiling is hit.
 */
import {
  collection,
  documentId,
  getCountFromServer,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type {
  CollectionReference,
  DocumentData,
  Firestore,
  Query,
} from 'firebase/firestore';

/**
 * A list read together with the truth about how much of it arrived.
 *
 * `total` is EXACT — a server-side aggregation, never clamped by `ceiling`. A
 * surface may therefore always render `total`, and must render the truncation
 * notice whenever `truncated` is true.
 */
export interface BoundedList<T> {
  /** The documents that fit under the ceiling, in `__name__` order. */
  readonly rows: T[];
  /** EXACT count of everything the query matches, from `getCountFromServer`. */
  readonly total: number;
  /** `rows.length < total` — a fact, not an inference. */
  readonly truncated: boolean;
}

/**
 * Firestore's `in` operator takes at most 30 values per query, so a by-id read
 * of more than 30 pointers is chunked. Chunks run sequentially: these sets are
 * small (a church's adopted courses), and a burst of parallel queries buys
 * nothing measurable while making a partial failure harder to reason about.
 */
export const IN_QUERY_CHUNK_SIZE = 30;

/** Split `xs` into runs of at most `size`. Exported for its own test. */
export function chunk<T>(xs: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Count first, then load up to `ceiling` documents in `__name__` order.
 *
 * THROWS if either read is rejected. That is the point: the caller must
 * distinguish "this church has no courses" from "we could not read the
 * courses", and it cannot do that if this function answers both with `[]`.
 */
export async function readBoundedList<T>(
  base: Query<DocumentData> | CollectionReference<DocumentData>,
  ceiling: number,
  map: (id: string, data: DocumentData) => T,
): Promise<BoundedList<T>> {
  if (!Number.isInteger(ceiling) || ceiling < 1) {
    throw new Error(`readBoundedList: ceiling must be a positive integer, got ${ceiling}`);
  }
  const q = base as Query<DocumentData>;
  // The aggregation runs over the WHOLE query and loads no documents, so this
  // figure survives the ceiling below.
  const total = (await getCountFromServer(q)).data().count;
  const snap = await getDocs(query(q, orderBy(documentId()), fsLimit(ceiling)));
  const rows = snap.docs.map((d) => map(d.id, d.data()));
  return { rows, total, truncated: rows.length < total };
}

/**
 * Fetch exactly the documents named by `ids` — complete by construction.
 *
 * Ids that do not resolve are simply absent from the result; the caller knows
 * which it asked for and can compare. Order is not guaranteed and callers sort
 * in memory, which is correct because the set is complete.
 *
 * THROWS if any chunk is rejected, for the same reason as above.
 */
export async function readDocsByIds<T>(
  db: Firestore,
  path: string,
  ids: readonly string[],
  map: (id: string, data: DocumentData) => T,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
  if (unique.length === 0) return [];
  const col = collection(db, path) as CollectionReference<DocumentData>;
  const out: T[] = [];
  for (const ids30 of chunk(unique, IN_QUERY_CHUNK_SIZE)) {
    const snap = await getDocs(query(col, where(documentId(), 'in', ids30)));
    snap.docs.forEach((d) => out.push(map(d.id, d.data())));
  }
  return out;
}

/**
 * The one sentence a truncated surface shows, so no two screens word it
 * differently. `nf` lets a caller pass its own number formatter.
 *
 * "Showing 200 of 250" is honest; showing 200 silently is the quiet lie.
 */
export function truncationNotice(
  shown: number,
  total: number,
  noun: string,
  nf: (n: number) => string = (n) => String(n),
): string {
  return `Showing ${nf(shown)} of ${nf(total)} ${noun}.`;
}
