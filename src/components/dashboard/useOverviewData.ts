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
  readFormSubmissions,
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
  /**
   * CENTS, AND THE NAME SAYS SO — THE-362.
   *
   * It was `givingSeries`, and the unit lived only in a docblock. The founder:
   * "In dashboard in all charts about giving/donations instead of 50$ donated
   * it shows 5000$." Exactly 100×: `bucketWeekly` weighs each receipt by
   * `amountCents`, so every bucket is cents, and both charts that plot it drew
   * the raw number with no unit attached to it.
   *
   * THE VALUE IS UNCHANGED BY THE RENAME. Nothing here divides, and nothing
   * downstream may either — the conversion happens ONCE, at the moment a figure
   * becomes a string, through `formatCents`. `giving-data.ts` names every
   * dollar figure it produces `goalDollars` / `raisedDollars` /
   * `pledgedDollars` / `paidDollars` for precisely this reason; this field was
   * the one money-bearing thing on the tab strip without a unit in its name,
   * which is how a cents series reached two charts that formatted it as
   * dollars.
   *
   * `InsightFeed`'s `InsightInputs.givingSeries` KEEPS ITS NAME and its own
   * conversion. It was already correct (THE-328 pins `$1,235` for 123456 cents)
   * and renaming a correct, pinned input would be churn; the call site below
   * hands this field to it under that name.
   */
  readonly givingSeriesCents: Series | null;
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
  memberSeries: null, givingSeriesCents: null, submissionSeries: null,
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

    /**
     * THE-309 — the "Form submissions" card, figure and trend together.
     *
     * 🔴 ONE call produces both, and that is the fix to the `+0% vs last week`
     * chip as much as to the figure. It used to be `countIn('submissions')` and
     * `seriesIn('submissions')`, two independent reads of a TOP-LEVEL
     * `submissions` collection that the form endpoint has never written to —
     * so the card showed a zero and a chip derived from the same empty read,
     * and both were wrong in the same direction, which is what made it look
     * consistent. See {@link readFormSubmissions}.
     *
     * ⚠️ NO PLATFORM-WIDE FORM, and it is refused rather than approximated.
     * Responses hang off `tenants/{id}/forms/{formId}` — there is no apex-level
     * set to aggregate, and enumerating every ministry's forms to sum them is
     * both unbounded and a number this product does not define. The same
     * decision the giving widgets record at the top of this file.
     */
    const submissionsRead = async () =>
      tenantId
        ? await readFormSubmissions(tenantId, readAt)
        : { figure: refused(REASON.perMinistryOnly), series: refused(REASON.perMinistryOnly), formsRead: 0 };

    (async () => {
      const [members, contacts, courses, posts, articles, forms] = await Promise.all([
        countIn('users'),
        countIn('contacts'),
        tenantId ? exactCount(publishedCoursesQuery(tenantId)) : countIn('courses'),
        countIn('community_posts'),
        countIn('blog_posts'),
        submissionsRead(),
      ]);
      const submissions = forms.figure;
      const submissionSeries = forms.series;

      const seventh = tenantId
        ? { label: 'Receipts', figure: await exactCount(invoicesQuery(tenantId)) }
        : {
            label: 'Ministries',
            figure: platformWide ? await exactCount(query(collection(db, 'tenants'))) : refused(REASON.noTenant),
          };

      const memberSeries = await seriesIn('users');

      // Receipts: one complete read serves BOTH the trend and the mix, so the
      // ledger is counted once and loaded once.
      let givingSeriesCents: Series = refused(REASON.noTenant);
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
          givingSeriesCents = {
            kind: 'complete',
            points: bucketWeekly(money.rows, readAt, (r) => r.issuedAt, (r) => r.amountCents).points,
          };
        } else {
          invoiceReason = money.reason;
          givingSeriesCents = refused(money.reason);
        }
      }

      const liveNow = tenantId ? await readLiveNow(tenantId) : { active: false, title: 'Live now' };

      if (cancelled) return;
      setData({
        loading: false,
        members, contacts, courses, posts, articles, submissions, seventh,
        memberSeries, givingSeriesCents, submissionSeries,
        invoiceRows, invoiceReason, liveNow,
      });
    })();

    return () => { cancelled = true; };
  }, [tenantId, isSuperAdmin, readAt]);

  return data;
}
