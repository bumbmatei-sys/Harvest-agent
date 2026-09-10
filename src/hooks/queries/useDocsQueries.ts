import { useQuery } from '@tanstack/react-query';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  limit,
  orderBy,
  startAfter,
  documentId,
} from 'firebase/firestore';
import type {
  DocumentData,
  Query,
  QueryConstraint,
  QueryDocumentSnapshot,
  QuerySnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { Timestamp } from 'firebase/firestore';
import { sortByTime, sortByNumber } from '../../utils/query-helpers';
import { isSuperAdmin } from '../../utils/tenant-scope';

export interface Doc {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  isPrivate: boolean;
  sharedWith: string[];
  tenantId?: string;
  pinned?: boolean;
  /**
   * THE-346 — set while a public web link is live, cleared when it is revoked.
   *
   * THIS FIELD IS A MIRROR, NOT THE PERMISSION. What actually makes a note
   * readable by a stranger is the server-only `publicNotes/{token}` record; this
   * exists so the Notes menu can say "Stop sharing" without a second read.
   * `/docs/{docId}`'s update rule lets the author write it, so it is FORGEABLE
   * from a console — and forging it grants nothing, because the reader resolves
   * the record first and a token with no record is a 404. See
   * `lib/public-note.ts`.
   */
  publicShare?: { token: string } | null;
}

export interface DocFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
  order: number;
  tenantId?: string;
}

/**
 * What a docs list read returns.
 *
 * The array alone was the bug. `useDocs` used to hand back `Doc[]` from a
 * `limit(300)` with no `orderBy`, then sort it by `updatedAt` in memory — so a
 * church with 400 notes got 300 ARBITRARY ones (Firestore orders an unordered
 * query by `__name__`, and the ids are random), sorted into a tidy newest-first
 * list that looked complete. Nothing in `Doc[]` could say otherwise.
 *
 * The list is now read to completeness (see {@link readAll}), so `truncated` is
 * false on every read a church will ever do. It exists because the ceiling that
 * stops a runaway read still exists, and a ceiling the consumer cannot see is
 * the defect this replaced. Silence is the bug; the number is secondary.
 */
export interface DocsRead<T> {
  /** Every document that matched — unless `truncated` is true. */
  items: T[];
  /**
   * True when {@link DOCS_FETCH_CEILING} stopped the read with matching
   * documents still unread. Exact, not conservative: reaching the ceiling
   * costs one extra single-document probe to answer this honestly.
   */
  truncated: boolean;
}

/**
 * Documents per round-trip while paging to completeness.
 *
 * 500, so the read cost for a normal church is unchanged: every tenant under
 * 500 notes is served by ONE query, exactly as the old `limit(300)` was — it
 * simply no longer stops there when there are more. Only a church past 500
 * pays a second round-trip, and it pays it to get its own notes back.
 */
export const DOCS_PAGE_SIZE = 500;

/**
 * Absolute ceiling on one list read, across all pages.
 *
 * Firestore bills per document read, so "page until exhausted" needs a stop.
 * 10,000 is 20 pages and roughly two orders of magnitude past the largest
 * plausible notes tree, so a real church never reaches it. The unscoped
 * platform scan below plausibly can — which is exactly why hitting this sets
 * `truncated` instead of quietly returning a short list.
 *
 * A multiple of DOCS_PAGE_SIZE on purpose: pages divide evenly into it, so the
 * ceiling is never hit mid-page.
 */
export const DOCS_FETCH_CEILING = 10_000;

/**
 * Thrown when a docs read has no tenant in context and no super-admin standing
 * to justify a platform-wide scan. Named so the UI (and the tests) can tell
 * "we could not work out which church this is" apart from a Firestore failure.
 * Mirrors NO_TENANT_SCOPE_MESSAGE in useCRMQueries (THE-44).
 */
export const NO_TENANT_SCOPE_MESSAGE =
  'Could not determine which church to load notes for. Reload the page, and if this keeps happening sign out and back in.';

/**
 * Read every document matching `constraints`, paging by document id.
 *
 * Why `orderBy(documentId())` and not `orderBy('updatedAt')`: a cursor needs a
 * total order, and `__name__` is the one order Firestore can already serve here
 * for free. `where('tenantId','==',x) + orderBy(__name__)` is answered by the
 * AUTOMATIC single-field index (`tenantId`, `__name__`); so is
 * `where('sharedWith','array-contains',uid) + orderBy(__name__)`. Neither needs
 * a composite index — which matters twice over: query-helpers.ts documents that
 * this codebase avoids composite indexes by design, and a missing composite
 * index fails SILENTLY here, so ordering by `updatedAt` would have traded a
 * silent truncation for a silent index failure. It is also the same order the
 * old unordered `limit()` was already returning, made explicit.
 *
 * `__name__` is unique, so the cursor can neither skip nor repeat a document —
 * paging on a non-unique field like `updatedAt` can do both.
 *
 * The caller sorts the finished set in memory (sortByTime / sortByNumber), and
 * that sort is now correct because the set is complete. Sorting a truncated set
 * is what made the old bug invisible.
 */
const readAll = async (
  base: Query<DocumentData>,
  constraints: QueryConstraint[],
): Promise<{ docs: QueryDocumentSnapshot<DocumentData>[]; truncated: boolean }> => {
  const out: QueryDocumentSnapshot<DocumentData>[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  for (;;) {
    const page: QuerySnapshot<DocumentData> = await getDocs(
      query(
        base,
        ...constraints,
        orderBy(documentId()),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(DOCS_PAGE_SIZE),
      ),
    );
    out.push(...page.docs);

    // A short page means the matching set is exhausted. This is the exit every
    // real church takes, on the first pass.
    if (page.docs.length < DOCS_PAGE_SIZE) return { docs: out, truncated: false };

    cursor = page.docs[page.docs.length - 1];

    if (out.length >= DOCS_FETCH_CEILING) {
      // Stopped by the ceiling rather than by running out. Whether anything is
      // actually missing takes one more document read to answer, and a flag the
      // consumer is meant to trust is worth one read.
      const probe = await getDocs(
        query(base, ...constraints, orderBy(documentId()), startAfter(cursor), limit(1)),
      );
      return { docs: out, truncated: !probe.empty };
    }
  }
};

/**
 * Tenant scoping shared by both list reads.
 *
 * `tenantId` is null in two unrelated situations and they must not be conflated
 * — the same distinction THE-44 drew for the CRM. On a READ, null does not mean
 * "no tenant", it means "no filter", i.e. every church at once:
 *
 *   1. genuine super admin, no tenant in context (apex) → platform-wide scan.
 *      Firestore's `docs` rule gates reads on `isTenantAdmin(resource.data
 *      .tenantId)`, which short-circuits true for a super admin, so this query
 *      is one they are actually allowed to run. Preserved deliberately.
 *   2. no tenant and no super-admin standing → a FAULT. Rules are not filters:
 *      a list query constraining nothing about `resource.data.tenantId` proves
 *      nothing and is rejected WHOLESALE, and the old code rendered that
 *      rejection as `docs = []` — "this church has no notes". Throw instead.
 *
 * Note `tenantId === PLATFORM_TENANT_ID` is deliberately NOT redirected to the
 * scan: AdminDocs already resolves a super admin to the platform tenant, so
 * that caller takes the scoped branch today and still does.
 */
const scopeConstraints = (tenantId: string | null | undefined): QueryConstraint[] => {
  if (tenantId) return [where('tenantId', '==', tenantId)];
  if (isSuperAdmin()) return [];
  throw new Error(NO_TENANT_SCOPE_MESSAGE);
};

export const useDocs = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['docs', tenantId],
    queryFn: async (): Promise<DocsRead<Doc>> => {
      const { docs, truncated } = await readAll(collection(db, 'docs'), scopeConstraints(tenantId));
      return {
        items: sortByTime(
          docs.map(d => ({ id: d.id, ...d.data() }) as Doc),
          'updatedAt',
          'desc',
        ),
        truncated,
      };
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useDoc = (tenantId: string | null | undefined, docId: string | null | undefined) =>
  useQuery({
    queryKey: ['doc', tenantId, docId],
    queryFn: async (): Promise<Doc | null> => {
      if (!docId) return null;
      const snap = await getDoc(doc(db, 'docs', docId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Doc;
    },
    enabled: !!docId,
    staleTime: 1000 * 60 * 5,
  });

export const useDocFolders = (tenantId: string | null | undefined, isAuthReady = true) =>
  useQuery({
    queryKey: ['docFolders', tenantId],
    queryFn: async (): Promise<DocsRead<DocFolder>> => {
      const { docs, truncated } = await readAll(
        collection(db, 'docFolders'),
        scopeConstraints(tenantId),
      );
      return {
        items: sortByNumber(
          docs.map(d => ({ id: d.id, ...d.data() }) as DocFolder),
          'order',
          'asc',
        ),
        truncated,
      };
    },
    enabled: isAuthReady && tenantId !== undefined,
    staleTime: 1000 * 60 * 5,
  });

export const useSharedDocs = (uid: string | null | undefined) =>
  useQuery({
    queryKey: ['sharedDocs', uid],
    queryFn: async (): Promise<DocsRead<Doc>> => {
      if (!uid) return { items: [], truncated: false };
      // Scoped by the viewer, not by tenant: `sharedWith array-contains uid` is
      // the constraint the `docs` rule accepts for a non-admin, so this needs no
      // tenant and gets none. Left in `__name__` order, as it always was — the
      // caller renders it as a flat "shared with me" strip.
      const { docs, truncated } = await readAll(collection(db, 'docs'), [
        where('sharedWith', 'array-contains', uid),
      ]);
      return { items: docs.map(d => ({ id: d.id, ...d.data() }) as Doc), truncated };
    },
    enabled: !!uid,
    staleTime: 1000 * 60 * 5,
  });
