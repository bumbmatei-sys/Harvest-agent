import { createHash } from 'crypto';
import type { Query, DocumentReference, WriteBatch } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

/**
 * Shared primitives for the two deletion routes — /api/account/delete (a member
 * removes themselves) and /api/tenants/delete (a super admin removes a church).
 *
 * Three things live here because getting them WRONG is the whole class of bug
 * this module exists to close:
 *
 *   1. {@link assertConcreteScope} — the null-scope guard. `getTenantScope()`
 *      returns `null` for a super admin and, on a READ, null means "every
 *      tenant". On a DELETE that is catastrophic, so nothing in either route may
 *      build a query from a scope value it has not first proven concrete.
 *   2. {@link deleteByQuery} / {@link anonymiseByQuery} — Firestore's WriteBatch
 *      caps at 500 operations. A church with 2,000 contacts must be chunked or
 *      the commit throws and the run half-fails. Every sweep goes through these.
 *   3. {@link DeletionReport} — a deletion that clears 15 of 21 collections and
 *      returns 200 is worse than one that fails loudly. The report carries a
 *      per-collection count AND the failures, and the caller maps a non-empty
 *      failure list to a non-2xx.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. The null-scope guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prove a query scope is a concrete, non-empty string before it is used to build
 * a delete.
 *
 * ⚠️ THIS IS THE ONE GUARD THAT MATTERS. `where('tenantId', '==', undefined)` is
 * a runtime throw, but `where('tenantId', '==', null)` is a legal query that
 * matches every doc whose field is absent, and a scope silently dropped from a
 * query builder matches EVERYTHING. On a read that surfaces the wrong rows; on a
 * delete it destroys another tenant's data. Failing loudly here — before a
 * single write — is the only acceptable outcome, so this throws rather than
 * returning a boolean a caller could forget to check.
 *
 * Two kinds of scope are accepted, and the distinction is deliberate:
 *   • a TENANT id — bounds the sweep to one church.
 *   • a MEMBER identity (uid or email) — bounds the sweep to one person. A uid
 *     is globally unique and belongs to exactly the member being deleted, so a
 *     uid-keyed query cannot over-match even without a tenant filter. That is
 *     what makes the handful of uid-keyed sweeps (below) safe.
 *
 * What is NOT acceptable in either case is an empty, null or undefined value.
 */
export function assertConcreteScope(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Refusing to run a delete with a non-concrete ${label} (got ${JSON.stringify(value)}). ` +
        'A null or empty scope matches across tenants.',
    );
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Firestore's WriteBatch hard-caps at 500 operations. 400 keeps headroom and is
 * also the query page size, so one page maps to exactly one commit — a tenant
 * with 2,000 contacts is five pages, five commits, and never lands in memory at
 * once. Matches BATCH_LIMIT in /api/tenants/delete.
 */
export const CHUNK_LIMIT = 400;

/**
 * Page a query and hard-delete each page in its own batch.
 *
 * The loop re-queries the SAME filter after each commit rather than paging with
 * a cursor: the just-deleted docs drop out of the result set, so the next page is
 * the next set of survivors and the loop terminates when a page comes back empty.
 * A cursor would need a stable sort the caller may not have an index for.
 *
 * `guard` is a belt-and-braces re-check of each matched doc, for sweeps whose
 * query cannot express the full condition (e.g. filtering `type` in memory).
 * Returning false skips the doc — it is never a reason to abort the page.
 */
export async function deleteByQuery(
  query: Query,
  guard?: (data: Record<string, unknown>) => boolean,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(CHUNK_LIMIT).get();
    if (snap.empty) break;
    const targets = guard
      ? snap.docs.filter((d) => guard((d.data() ?? {}) as Record<string, unknown>))
      : snap.docs;
    if (targets.length > 0) {
      const batch: WriteBatch = adminDb.batch();
      targets.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      removed += targets.length;
    }
    // A full page that the guard emptied would loop forever (nothing was
    // deleted, so the same page comes back). Stop instead: the remaining docs
    // are ones the guard deliberately spared.
    if (snap.size < CHUNK_LIMIT || targets.length === 0) break;
  }
  return removed;
}

/**
 * Page a query and OVERWRITE identifying fields on each match, in batches.
 *
 * The anonymise counterpart of {@link deleteByQuery}, used where a record must
 * survive its subject — donation invoices above all. It cannot re-query the same
 * filter to advance (the docs still match after the update), so it pages with a
 * cursor on the last doc of each page; `patch` is applied per doc so a stable
 * pseudonym can be derived from the row itself.
 */
export async function anonymiseByQuery(
  query: Query,
  patch: (data: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<number> {
  let changed = 0;
  let cursor: unknown = undefined;
  for (;;) {
    const page = cursor === undefined ? query.limit(CHUNK_LIMIT) : query.startAfter(cursor).limit(CHUNK_LIMIT);
    const snap = await page.get();
    if (snap.empty) break;
    const batch: WriteBatch = adminDb.batch();
    let queued = 0;
    for (const d of snap.docs) {
      const update = patch((d.data() ?? {}) as Record<string, unknown>);
      if (!update) continue;
      batch.update(d.ref, update);
      queued += 1;
    }
    if (queued > 0) {
      await batch.commit();
      changed += queued;
    }
    if (snap.size < CHUNK_LIMIT) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return changed;
}

/** Delete a known set of document refs, chunked to stay under the batch cap. */
export async function deleteRefs(refs: DocumentReference[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < refs.length; i += CHUNK_LIMIT) {
    const slice = refs.slice(i, i + CHUNK_LIMIT);
    const batch: WriteBatch = adminDb.batch();
    slice.forEach((r) => batch.delete(r));
    await batch.commit();
    removed += slice.length;
  }
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The partial report
// ─────────────────────────────────────────────────────────────────────────────

/** One collection's failure, named so a reader knows exactly what survived. */
export interface DeletionFailure {
  /** The label from the disposition table — never a raw query. */
  collection: string;
  message: string;
}

/**
 * What a deletion actually did, per collection.
 *
 * Shape follows the SMS broadcast's partial report (THE-29): explicit per-target
 * counters, an explicit `status` of 'complete' | 'partial', and — when partial —
 * an `error` string saying so in words, rather than a bare success body that a
 * caller has to diff to notice something was left behind.
 */
export interface DeletionReport {
  status: 'complete' | 'partial';
  /** Collection label → docs removed. Present for every attempted collection. */
  cleared: Record<string, number>;
  /** Collection label → docs anonymised rather than removed (donations). */
  anonymised: Record<string, number>;
  /** Collections deliberately left alone, with the reason. */
  retained: Record<string, string>;
  failures: DeletionFailure[];
  error?: string;
}

export function emptyReport(): DeletionReport {
  return { status: 'complete', cleared: {}, anonymised: {}, retained: {}, failures: [] };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Run one collection's sweep and record the outcome, whichever way it goes.
 *
 * A throw is recorded against the collection BY NAME and flips the report to
 * 'partial' — it never aborts the remaining sweeps, because a member is better
 * served by 20 of 21 collections cleared plus an honest report naming the 21st
 * than by a run that stops at the first error and reports nothing about the rest.
 * The caller decides what to do with a partial report; what it must not do is
 * return 200.
 */
export async function record(
  report: DeletionReport,
  collection: string,
  run: () => Promise<number>,
  kind: 'cleared' | 'anonymised' = 'cleared',
): Promise<void> {
  try {
    const n = await run();
    report[kind][collection] = (report[kind][collection] ?? 0) + n;
  } catch (e) {
    report[kind][collection] = report[kind][collection] ?? 0;
    report.failures.push({ collection, message: errMsg(e) });
    report.status = 'partial';
    report.error = `Deletion was incomplete — ${report.failures.length} collection(s) could not be cleared.`;
  }
}

/** Note a collection that is kept on purpose, with the reason a reader needs. */
export function retain(report: DeletionReport, collection: string, reason: string): void {
  report.retained[collection] = reason;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Donation pseudonymisation
// ─────────────────────────────────────────────────────────────────────────────

/** Marks every record whose subject was deleted but whose figures were kept. */
export const DELETED_DONOR_NAME = 'Deleted donor';

/**
 * A stable, non-reversible stand-in for a deleted donor's email address.
 *
 * ⚠️ Donation invoices CANNOT simply have `recipientEmail` cleared. The annual
 * giving statement groups a tenant's gifts by that field and skips any invoice
 * whose value is empty (`if (!donorEmail) continue`), so blanking it would
 * silently drop the gifts out of the church's year-end statement — destroying the
 * books to satisfy an erasure request. A stable pseudonym keeps every grouping,
 * total and receipt intact while carrying nothing that identifies the donor.
 *
 * Derived from uid + tenant so it is:
 *   • deterministic — a second deletion pass produces the same value, which is
 *     what makes anonymisation idempotent;
 *   • unique per donor per church — two deleted donors never merge into one line
 *     on a statement;
 *   • one-way — the hash cannot be walked back to the uid or the address.
 *
 * The `.invalid` TLD is reserved by RFC 2606 and can never be delivered to, so a
 * pseudonym can never accidentally email a real person.
 */
export function anonymisedDonorEmail(uid: string, tenantId: string): string {
  assertConcreteScope(uid, 'uid');
  assertConcreteScope(tenantId, 'tenantId');
  const digest = createHash('sha256').update(`${uid}:${tenantId}`).digest('hex').slice(0, 24);
  return `deleted-donor-${digest}@deleted.invalid`;
}

/** True for an address this module minted — the marker the send path skips on. */
export function isAnonymisedDonorEmail(email: unknown): boolean {
  return typeof email === 'string' && email.endsWith('@deleted.invalid');
}
