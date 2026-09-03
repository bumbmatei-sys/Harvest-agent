"use client";
/**
 * THE-276 — every read the Overview tab makes, in one place.
 *
 * ─── Scope, and why the platform case is not a special case ──────────────────
 *
 * `AdminDashboardHome` is mounted in two contexts: a tenant admin on a church's
 * subdomain (`tenantId` set) and a super admin on the apex (`tenantId` null).
 * The scoping below mirrors `fetchCRMCounts` in useCRMQueries exactly — scoped
 * equality for a tenant, an unscoped read for a super admin on the apex, and
 * NEITHER for anyone else, because an unscoped list query from a tenant admin is
 * rejected wholesale by rules and that rejection would render as "this ministry
 * has nothing". It becomes {@link REASON.noTenant} instead.
 *
 * ⚠️ The giving widgets have no platform-wide form and do not get one. Receipts
 * live in `tenants/{id}/invoices`, one ledger per tenant; there is no apex-level
 * ledger to read and summing every tenant's would be a number this product does
 * not define. On the apex they report that, and the ministries count takes the
 * seventh card instead.
 */
import { useEffect, useState } from 'react';
import { collection, query } from 'firebase/firestore';

import { db } from '../../firebase';
import {
  REASON,
  bucketWeekly,
  boundedInvoicesQuery,
  boundedScopedQuery,
  completeRead,
  exactCount,
  invoicesQuery,
  publishedCoursesQuery,
  readLiveNow,
  scopedQuery,
  readableReceipts,
  toDatedRow,
  toInvoiceRow,
  type Figure,
  type LiveNow,
  type ReadableReceipt,
  type Series,
} from './dashboard-data';

/** Everything the Overview tab renders from. `null` means "still reading". */
export interface OverviewData {
  readonly loading: boolean;
  readonly members: Figure | null;
  readonly contacts: Figure | null;
  readonly courses: Figure | null;
  readonly posts: Figure | null;
  readonly articles: Figure | null;
  readonly submissions: Figure | null;
  /** The seventh card: receipts for a tenant, ministries on the apex. */
  readonly seventh: { readonly label: string; readonly figure: Figure | null };
  readonly memberSeries: Series | null;
  readonly givingSeries: Series | null;
  readonly submissionSeries: Series | null;
  /** Receipt rows for the mix — `null` with a reason when the read was refused. */
  readonly invoiceRows: readonly ReadableReceipt[] | null;
  readonly invoiceReason: string | null;
  readonly liveNow: LiveNow | null;
}

const PENDING: OverviewData = {
  loading: true,
  members: null, contacts: null, courses: null, posts: null, articles: null, submissions: null,
  seventh: { label: 'Receipts', figure: null },
  memberSeries: null, givingSeries: null, submissionSeries: null,
  invoiceRows: null, invoiceReason: null, liveNow: null,
};

const refused = (reason: string) => ({ kind: 'unavailable', reason }) as const;

/**
 * Read the Overview tab.
 *
 * `now` is a parameter so a test can pin the week boundaries instead of racing
 * the clock; production never passes it.
 *
 * 🔴 IT IS CAPTURED ONCE PER MOUNT, and that is load-bearing. `Date.now()` as a
 * default argument produces a NEW value on every render, so leaving it in the
 * effect's dependency array makes the effect re-run on the very state update it
 * just caused: an unbounded loop that re-issues every read on this tab, forever,
 * against a billed database. Freezing it in state is what closes that loop, and
 * it is also the behaviour the widgets want — the week boundaries a reader is
 * looking at should not shift underneath them mid-session.
 */
export function useOverviewData(
  tenantId: string | null,
  isSuperAdmin: boolean,
  now: number = Date.now(),
): OverviewData {
  const [data, setData] = useState<OverviewData>(PENDING);
  const [readAt] = useState(() => now);

  useEffect(() => {
    let cancelled = false;
    setData(PENDING);

    const platformWide = !tenantId && isSuperAdmin;
    /** A collection query in the caller's scope, or null when they have none. */
    const scope = (name: string) =>
      tenantId ? scopedQuery(name, tenantId) : platformWide ? query(collection(db, name)) : null;
    const boundedScope = (name: string) =>
      tenantId ? boundedScopedQuery(name, tenantId) : platformWide ? query(collection(db, name)) : null;

    const countIn = async (name: string): Promise<Figure> => {
      const q = scope(name);
      return q ? exactCount(q) : refused(REASON.noTenant);
    };

    /**
     * A weekly series over a collection's `createdAt`, or the reason there is
     * none. The count gate lives in `completeRead`; this only shapes the result.
     */
    const seriesIn = async (name: string): Promise<Series> => {
      const q = scope(name);
      const bounded = boundedScope(name);
      if (!q || !bounded) return refused(REASON.noTenant);
      const read = await completeRead(q, bounded, toDatedRow);
      if (read.kind !== 'complete') return refused(read.reason);
      return { kind: 'complete', points: bucketWeekly(read.rows, readAt, (r) => r.createdAt).points };
    };

    (async () => {
      const [members, contacts, courses, posts, articles, submissions] = await Promise.all([
        countIn('users'),
        countIn('contacts'),
        tenantId ? exactCount(publishedCoursesQuery(tenantId)) : countIn('courses'),
        countIn('community_posts'),
        countIn('blog_posts'),
        countIn('submissions'),
      ]);

      const seventh = tenantId
        ? { label: 'Receipts', figure: await exactCount(invoicesQuery(tenantId)) }
        : {
            label: 'Ministries',
            figure: platformWide ? await exactCount(query(collection(db, 'tenants'))) : refused(REASON.noTenant),
          };

      const [memberSeries, submissionSeries] = await Promise.all([
        seriesIn('users'),
        seriesIn('submissions'),
      ]);

      // Receipts: one complete read serves BOTH the trend and the mix, so the
      // ledger is counted once and loaded once.
      let givingSeries: Series = refused(REASON.noTenant);
      let invoiceRows: readonly ReadableReceipt[] | null = null;
      let invoiceReason: string | null = REASON.noTenant;
      if (tenantId) {
        const read = await completeRead(invoicesQuery(tenantId), boundedInvoicesQuery(tenantId), toInvoiceRow);
        // Two gates, in order: the ledger must be COMPLETE (every receipt in
        // hand), and then every receipt in it must be READABLE. A total that
        // silently omits either is wrong by exactly what it omitted.
        const money = read.kind === 'complete' ? readableReceipts(read.rows) : read;
        if (money.kind === 'complete') {
          invoiceRows = money.rows;
          invoiceReason = null;
          givingSeries = {
            kind: 'complete',
            points: bucketWeekly(money.rows, readAt, (r) => r.issuedAt, (r) => r.amountCents).points,
          };
        } else {
          invoiceReason = money.reason;
          givingSeries = refused(money.reason);
        }
      }

      const liveNow = tenantId ? await readLiveNow(tenantId) : { active: false, title: 'Live now' };

      if (cancelled) return;
      setData({
        loading: false,
        members, contacts, courses, posts, articles, submissions, seventh,
        memberSeries, givingSeries, submissionSeries,
        invoiceRows, invoiceReason, liveNow,
      });
    })();

    return () => { cancelled = true; };
  }, [tenantId, isSuperAdmin, readAt]);

  return data;
}
