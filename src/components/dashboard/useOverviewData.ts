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
import {
  ROSTER_REASON,
  countryTally,
  givingFunnel,
  toContactRow,
  toMemberRow,
  topGivers,
  type CountryTally,
  type StageCount,
  type TopGiver,
} from './roster-data';

/**
 * THE-287 — what the Growth and Giving tabs render from.
 *
 * 🔴 EVERY FIELD IS `T | null` WITH A REASON BESIDE IT, exactly like `Figure`
 * and `Series`. `null` with a `null` reason is "still reading"; `null` with a
 * reason is "this could not be read completely, and here is why". There is no
 * third state and no empty array standing in for a refusal — an empty table and
 * an unreadable one look identical on screen, which is the defect THE-276's
 * whole read layer exists to make unspellable.
 */
export interface RosterData {
  /** Country and city COUNTS, with the coverage that qualifies them. */
  readonly countries: CountryTally | null;
  readonly countriesReason: string | null;
  /** Member / Giving / Champion tier sizes. A giving funnel, not a devotion one. */
  readonly funnel: readonly StageCount[] | null;
  readonly funnelReason: string | null;
  /** The largest givers, ranked client-side over the complete contact set. */
  readonly givers: readonly TopGiver[] | null;
  readonly giversReason: string | null;
}

const ROSTER_PENDING: RosterData = {
  countries: null, countriesReason: null,
  funnel: null, funnelReason: null,
  givers: null, giversReason: null,
};

const rosterRefused = (reason: string): RosterData => ({
  countries: null, countriesReason: reason,
  funnel: null, funnelReason: reason,
  givers: null, giversReason: reason,
});

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
  /**
   * THE-287 — the Growth and Giving tabs, from the SAME two reads.
   *
   * ⚠️ Additive, and deliberately a sub-object rather than six more top-level
   * fields: nothing above it changes value, shape or provenance, so Overview's
   * figures are the same figures. The countries tally is grouped from the
   * `users` documents this hook ALREADY loads for `memberSeries` — zero extra
   * Firestore cost — and the two giving widgets share one new complete read of
   * `contacts`, which is the read `fetchCRMContacts` already makes in
   * production.
   */
  readonly roster: RosterData;
}

const PENDING: OverviewData = {
  loading: true,
  members: null, contacts: null, courses: null, posts: null, articles: null, submissions: null,
  seventh: { label: 'Receipts', figure: null },
  memberSeries: null, givingSeries: null, submissionSeries: null,
  invoiceRows: null, invoiceReason: null, liveNow: null,
  roster: ROSTER_PENDING,
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

      /**
       * THE-287 — ONE complete read of `users`, serving two tabs.
       *
       * 🔴 The member trend is RELOCATED to Growth, not rebuilt there. This is
       * the same `completeRead` THE-276 made, over the same query, bucketed by
       * the same `bucketWeekly` call against the same frozen `readAt` — the
       * only change is that the mapper now also carries `country` and `city`
       * off documents it was already loading. `toMemberRow.createdAt` and
       * `toDatedRow.createdAt` are the same expression, so `memberSeries` is
       * point-for-point what Overview showed before this ticket, and the SAME
       * object is handed to both tabs rather than a second one computed to
       * match.
       *
       * ⚠️ The countries table therefore costs ZERO additional Firestore
       * reads. It is a client-side grouping of a set already in memory.
       */
      const membersRead = await (async () => {
        const q = scope('users');
        const bounded = boundedScope('users');
        if (!q || !bounded) return { kind: 'unavailable', reason: REASON.noTenant } as const;
        return completeRead(q, bounded, toMemberRow);
      })();

      const memberSeries: Series = membersRead.kind === 'complete'
        ? { kind: 'complete', points: bucketWeekly(membersRead.rows, readAt, (r) => r.createdAt).points }
        : refused(membersRead.reason);

      const submissionSeries = await seriesIn('submissions');

      /**
       * THE-287 — the ONE read this ticket adds: every `contacts` document.
       *
       * It feeds both giving widgets, so the collection is counted once and
       * loaded once. Same gate as everything else here: `completeRead` takes
       * the exact count FIRST and refuses above the ceiling rather than
       * handing back a truncated set that a `sort()` would make look ordered.
       *
       * 🔴 No `orderBy`. `contacts` has no (tenantId, totalDonated) composite
       * index, `firestore.indexes.json` does not deploy on merge, and a
       * complete set in memory sorts exactly. See `roster-data.ts`.
       */
      const contactsRead = await (async () => {
        const q = scope('contacts');
        const bounded = boundedScope('contacts');
        if (!q || !bounded) return { kind: 'unavailable', reason: REASON.noTenant } as const;
        return completeRead(q, bounded, toContactRow);
      })();

      const roster: RosterData = (() => {
        // Each half refuses on its own read. A ministry whose members are
        // readable and whose contacts are not gets the countries table and an
        // explicit reason where the funnel would be, not a blank tab.
        const countries = membersRead.kind === 'complete'
          ? (() => {
              const tally = countryTally(membersRead.rows);
              // 🔴 Not one member carries a country, so there is no table to
              // draw. That is "nothing records this", not "we could not read
              // it", and the two say different things to a founder.
              return tally.covered === 0
                ? { tally: null, reason: ROSTER_REASON.noCountries }
                : { tally, reason: null };
            })()
          : { tally: null, reason: membersRead.reason };

        if (contactsRead.kind !== 'complete') {
          return {
            ...rosterRefused(contactsRead.reason),
            countries: countries.tally,
            countriesReason: countries.reason,
          };
        }

        const givers = topGivers(contactsRead.rows);
        return {
          countries: countries.tally,
          countriesReason: countries.reason,
          funnel: givingFunnel(contactsRead.rows),
          funnelReason: null,
          givers,
          // An empty leaderboard is not an unreadable one: it means no contact
          // has a recorded donation, which the empty state says in those words.
          giversReason: givers.length === 0 ? ROSTER_REASON.noGivers : null,
        };
      })();

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
        roster,
      });
    })();

    return () => { cancelled = true; };
  }, [tenantId, isSuperAdmin, readAt]);

  return data;
}
