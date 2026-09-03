/**
 * THE-290 — the Giving tab's read layer: the ledger, the campaigns and the
 * pledges.
 *
 * ─── What this module reads, and what it deliberately does not ───────────────
 *
 * TWO collections, and neither of them is the receipt ledger. That omission is
 * the first thing to say about this file:
 *
 *   · `campaigns` — top-level, one document per fundraising or pledge campaign.
 *   · `tenants/{t}/pledges` — one document per commitment made to a pledge
 *     campaign.
 *
 * 🔴 `tenants/{t}/invoices` IS NOT READ HERE. The giving-over-time trend on this
 * tab is the SAME `givingSeries` the Overview tab plots, produced by the one
 * `useOverviewData` instance that sits above the tab strip — see
 * `AdminDashboardHome`. #429 established that pattern for the member trend and
 * the reasoning is identical: a second read of the ledger would be a second
 * chance for two tabs to disagree about how much a ministry received, taken
 * seconds apart, with nothing on either screen to say which is stale. The
 * ledger is counted once, loaded once, gated once.
 *
 * ─── 🔴 THE MONEY RULES, AND THE UNITS THEY ARE ABOUT ────────────────────────
 *
 * FOUR unit facts, every one of them verified against the code that writes the
 * documents, because three different units meet on this one tab:
 *
 *   1. `invoices.amount` is in CENTS. `src/lib/donation-webhook.ts` writes
 *      `amount: amountCents` on every receipt it issues, and `AdminAccounting`
 *      divides by 100 at its own read. `dashboard-data`'s `InvoiceRow` names the
 *      field `amountCents` precisely so a later caller cannot format it as
 *      dollars by accident — that inversion shipped once and rendered $105,500
 *      as $10,550,000.
 *   2. `campaigns.goal` and `campaigns.raised` are in DOLLARS.
 *      `/api/campaigns/adjust-raised` increments by `amountDollars`, and
 *      `incrementCampaignRaised` does the same for a Stripe gift. So the same
 *      $250 gift is `25000` on the receipt and `250` on the campaign.
 *   3. `pledges.pledgeAmount` and `pledges.paidAmount` are in DOLLARS — the
 *      field comments on `AdminFundraising`'s `Pledge` say so and
 *      `/api/pledge/submit` writes the admin's dollar figure straight through.
 *   4. `contacts.totalDonated` is in DOLLARS too (`AdminCRM` derives the CRM
 *      pipeline stage from it directly). 🔴 It is NOT READ ANYWHERE IN THIS
 *      MODULE and no figure on this tab is derived from it. Nothing here can
 *      mix it with a cents figure because nothing here has it.
 *
 * 🔴 SO NO FIGURE THIS MODULE PRODUCES IS EVER COMBINED WITH A CENTS FIGURE.
 * Every number below is dollars, every type that carries one says `Dollars` in
 * its field name, and the one cents-denominated thing on the tab — the relocated
 * `givingSeries` — is passed through untouched from the Overview hook and is
 * never added to, divided by, or compared against anything here.
 *
 * ─── 🔴 NO COERCION. #421's exact bug, and why it is spelled out again ───────
 *
 * #421 caught silent money loss in its own code: `toInvoiceRow` coerced a
 * missing `amount` to `0`, so a ledger containing one unreadable gift produced a
 * giving total quietly short by exactly that gift — a wrong number with no
 * symptom. It now returns `null` and {@link ../dashboard-data!readableReceipts}
 * turns that into a refusal that names the count.
 *
 * Every money field read below follows the same discipline, and it is enforced
 * by the TYPES rather than by the care of whoever edits this next:
 *
 *   · {@link toCampaignRow} and {@link toPledgeRow} return `number | null`.
 *     There is no `?? 0`, no `Number(...)`, no `parseFloat` and no `|| 0` in
 *     this file, and a guard test asserts their absence.
 *   · {@link readableCampaigns} and {@link readablePledges} REFUSE the whole
 *     widget when any row carries an unreadable amount, and say how many — so a
 *     founder can go and look at the document instead of trusting a total that
 *     is short by an unknown sum.
 *   · The aggregates take the NARROWED types, which have no nullable money
 *     field at all, so there is nothing left for them to fall back on.
 *
 * ⚠️ STRICTER THAN `typeof x === 'number'`. `NaN` and `Infinity` are both
 * `typeof 'number'`, and either one poisons a running total into `NaN` — which
 * renders as the literal string "NaN" beside a currency symbol. `Number.isFinite`
 * is the test, everywhere.
 *
 * ─── 🔴 `campaigns.raised` IS READ. IT IS NEVER RECOMPUTED ───────────────────
 *
 * `raised` is maintained by two writers and only two: the Stripe donation
 * webhook (`incrementCampaignRaised`, a per-payment `FieldValue.increment`) and
 * `/api/campaigns/adjust-raised` (one transaction per manual offline gift, with
 * an audit row). THE-251 removed a third writer — the campaign editor was
 * spreading a stale `raised` back on every save, so fixing a typo in a title
 * silently reset the total to its value when the modal opened and destroyed any
 * gift that had landed in between.
 *
 * 🔴 SO THIS MODULE TREATS `raised` AS AUTHORITATIVE AND DERIVES NOTHING. Summing
 * `invoices` per campaign to "check" it would create a SECOND source for one
 * number, and two sources for one number is how they drift: a receipt written
 * for an event ticket, a gift given before the campaign existed, a manual
 * offline adjustment with no receipt at all, and Stripe's own fee handling all
 * make the two legitimately differ. The widget would then have to pick one, and
 * whichever it picked would contradict the campaign screen the church actually
 * works in. There is no `invoices` read on the campaign path — a guard test
 * asserts it.
 *
 * ─── Completeness, not ordering. And 🔴 NO `orderBy`, ANYWHERE ──────────────
 *
 * Unchanged from THE-276 and THE-283, and it binds here for a THIRD reason:
 *
 *   · `invoices.issuedAt` holds BOTH ISO strings and Timestamps — the donation
 *     webhook writes `issuedAt: nowIso` while other paths write a Timestamp.
 *     Firestore orders ACROSS TYPES BY TYPE FIRST, so `orderBy('issuedAt','desc')`
 *     returns every string row before any Timestamp row. That is a stable order
 *     and it is not a chronological one, and a `limit()` on top of it is a
 *     biased sample dressed as "the most recent".
 *   · Neither `campaigns` nor `pledges` has a composite index in
 *     firestore.indexes.json for a tenant equality plus an ordering, and that
 *     file DOES NOT DEPLOY ON MERGE — `deploy-rules.yml` runs
 *     `firestore:rules,storage` only and its `paths:` filter does not even
 *     include the index file. So an index added there would be inert and the
 *     query would throw `failed-precondition` in production while every test
 *     stayed green.
 *
 * The answer is the same one: COUNT FIRST, then load everything, then sort in
 * memory with `Array.sort`. With every matching document in hand the order they
 * arrived in cannot change what the rows add up to, and no index is required
 * that does not already exist. `@tanstack/react-table` is not installed, is not
 * needed for a static ordering, and is not added.
 */
import { collection, limit, query } from 'firebase/firestore';

import { db } from '../../firebase';
import {
  DASHBOARD_FETCH_LIMIT,
  REASON,
  boundedScopedQuery,
  completeRead,
  scopedQuery,
} from './dashboard-data';
import { toSafeDate, type DateLike } from '../../utils/format-date';

export { boundedScopedQuery, completeRead, scopedQuery, REASON };

/* ── Query builders — every one of them index-free ────────────────────────── */

/**
 * The tenant's pledge commitments. A subcollection, so it needs no `where` at
 * all — and therefore no index beyond the one every collection has.
 */
export const pledgesQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'pledges'));

export const boundedPledgesQuery = (tenantId: string) =>
  query(collection(db, 'tenants', tenantId, 'pledges'), limit(DASHBOARD_FETCH_LIMIT));

/* ── Campaigns: the row, read from the documents this app actually writes ─── */

/**
 * One campaign, as `AdminFundraising` writes it.
 *
 * 🔴 `goalDollars` and `raisedDollars` are NULLABLE and neither has a default.
 * That is the #421 discipline: `null` means "this document does not carry a
 * readable amount", which {@link readableCampaigns} turns into a refusal that
 * names the count. `0` would mean "this campaign has raised nothing", which is
 * a claim about the ministry made by a mapper that read nothing.
 *
 * ⚠️ The field is `title`, NOT `name` — verified against `AdminFundraising`'s
 * payload and `useCampaignQueries`' `Campaign` interface. A mapper pointed at
 * `data.name` would find `undefined` on every document and, under the old
 * coercion, would have rendered a table of correctly-totalled unnamed rows.
 *
 * `title` is nullable for a different reason from the amounts: a campaign this
 * app cannot NAME is still a campaign whose money is real, so it is counted and
 * rendered with its namelessness stated rather than refusing the widget or
 * inventing a label. Same treatment `LocationTable` gives a member who recorded
 * no city.
 */
export interface CampaignRow {
  readonly id: string;
  readonly title: string | null;
  readonly goalDollars: number | null;
  readonly raisedDollars: number | null;
  readonly isActive: boolean;
}

/** A finite number, or `null`. ⚠️ `NaN` and `Infinity` are both `typeof 'number'`. */
const amount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** A trimmed non-empty string, or `null`. A whitespace-only field is not a name. */
const label = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * 🔴 `isActive` is compared to `true`, not coerced with `!!`. Every other value
 * a document could carry there — a string, a number, `undefined` — is not
 * "active", and `!!'false'` is `true`.
 */
export const toCampaignRow = (data: Record<string, unknown>, id: string): CampaignRow => ({
  id,
  title: label(data.title),
  goalDollars: amount(data.goal),
  raisedDollars: amount(data.raised),
  isActive: data.isActive === true,
});

/** A campaign whose money can be totalled. No nullable amount survives here. */
export interface ReadableCampaign {
  readonly id: string;
  readonly title: string | null;
  readonly goalDollars: number;
  readonly raisedDollars: number;
  readonly isActive: boolean;
}

/**
 * Narrow a COMPLETE campaign read to campaigns whose money can be read, or
 * refuse the whole widget and say how many could not.
 *
 * 🔴 STRICT, exactly as `readableReceipts` is on the ledger. A campaign row with
 * an unreadable `raised` would make the progress bar beside it wrong by an
 * unknown amount, and a fundraising screen that understates what has come in is
 * how a church stops trusting the number it plans against.
 */
export function readableCampaigns(
  rows: readonly CampaignRow[],
): { kind: 'complete'; rows: ReadableCampaign[] } | { kind: 'unavailable'; reason: string } {
  const bad = rows.filter((r) => r.goalDollars === null || r.raisedDollars === null).length;
  if (bad > 0) return { kind: 'unavailable', reason: GIVING_REASON.unreadableCampaigns(bad, rows.length) };
  return { kind: 'complete', rows: rows as ReadableCampaign[] };
}

/* ── Campaigns: the aggregate ─────────────────────────────────────────────── */

/** One campaign's progress toward its goal. */
export interface CampaignProgressRow extends ReadableCampaign {
  /**
   * How far along, as a percentage clamped to [0, 100].
   *
   * 🔴 `null` when no goal was recorded, and that is not the same as `0`. A
   * ratio with no denominator is undefined, and a 0% bar beside a campaign that
   * has raised $4,000 states that it has raised nothing. The row renders its
   * raised total and says the goal is missing instead.
   */
  readonly percent: number | null;
}

/**
 * Every campaign, and the parts of the answer that are missing.
 *
 * 🔴 `rows.length === total` is an INVARIANT: nothing is sliced, filtered or
 * dropped. `unnamed` and `withoutGoal` are counted from the same rows and
 * rendered beside the table, so a reader can account for every campaign.
 */
export interface CampaignBreakdown {
  readonly total: number;
  readonly active: number;
  /** Campaigns with no readable title. Still counted, still totalled. */
  readonly unnamed: number;
  /** Campaigns with no goal above zero, so no percentage is defined for them. */
  readonly withoutGoal: number;
  readonly goalDollars: number;
  readonly raisedDollars: number;
  readonly rows: readonly CampaignProgressRow[];
}

/**
 * Aggregate a COMPLETE set of readable campaigns.
 *
 * ⚠️ Sorting is `Array.sort` over an array already entirely in memory: active
 * first, then most raised, then by title so the order is stable across renders.
 * That is a STATIC ordering and needs no table library — see the module header.
 *
 * 🔴 `raisedDollars` here is the SUM OF THE DOCUMENTS' OWN `raised` FIELDS. It
 * is not recomputed from receipts, and no receipt is read on this path.
 */
export function aggregateCampaigns(rows: readonly ReadableCampaign[]): CampaignBreakdown {
  const withPercent: CampaignProgressRow[] = rows.map((row) => ({
    ...row,
    // A goal of zero or below defines no ratio. Guarding the division is not a
    // coercion of the amount — both amounts were read, and it is the QUOTIENT
    // that does not exist.
    percent: row.goalDollars > 0
      ? Math.min(100, Math.max(0, (row.raisedDollars / row.goalDollars) * 100))
      : null,
  }));

  return {
    total: rows.length,
    active: rows.filter((r) => r.isActive).length,
    unnamed: rows.filter((r) => r.title === null).length,
    withoutGoal: withPercent.filter((r) => r.percent === null).length,
    goalDollars: rows.reduce((sum, r) => sum + r.goalDollars, 0),
    raisedDollars: rows.reduce((sum, r) => sum + r.raisedDollars, 0),
    /*
     * ⚠️ NO `Number(...)` ANYWHERE IN THIS FILE, even on a boolean, and the
     * active-first comparison is spelled out because of it. `Number(b.isActive)`
     * would have been the terse spelling and it is indistinguishable, to a guard
     * sweeping this file for a money coercion, from `Number(data.raised)` — the
     * exact call #421's bug would be rewritten as. A guard that has to allow one
     * spelling cannot refuse the other, so the terse form is not used here.
     */
    rows: withPercent.sort(
      (a, b) =>
        (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) ||
        b.raisedDollars - a.raisedDollars ||
        (a.title ?? '').localeCompare(b.title ?? ''),
    ),
  };
}

/* ── Pledges: the row ─────────────────────────────────────────────────────── */

/**
 * One pledge commitment.
 *
 * ─── 🔴 A PLEDGE IS A COMMITMENT. IT IS NOT A RECURRING GIFT ────────────────
 *
 * THE-285 established, and this ticket re-verified, that NOTHING ANYWHERE IN
 * THIS APP MARKS A GIFT RECURRING at the tenant level:
 *
 *   · Stripe Connect is off (`STRIPE_CONNECT_ENABLED = false`; the platform
 *     account was closed as `rejected.fraud`), so there is no tenant
 *     card-giving path at all — and therefore no tenant subscription to read.
 *   · `invoices.type` is one of `donation_receipt | event_ticket | invoice`, and
 *     not one of the three says anything about cadence. A monthly partnership
 *     renewal and a single gift both land as `donation_receipt`.
 *   · ⚠️ `users.donationSubscriptionId` IS THE PLATFORM PARTNERSHIP — somebody
 *     giving to Harvest itself, cancelled through `/api/stripe/cancel-partnership`
 *     and surfaced on `Profile`. It is not a church's donor and it is NOT read
 *     here. A tenant widget built on it would report Harvest's own revenue on a
 *     church's dashboard.
 *
 * 🔴 SO NOTHING ON THIS TAB IS LABELLED RECURRING, SUBSCRIPTION OR MONTHLY
 * GIVING, and a guard test sweeps the source and the rendered output for all
 * three. What `pledges` carries is a promised amount, how much of it has been
 * paid, a status and a due date — a COMMITMENT, with no cadence anywhere in it.
 * Labelling it "recurring giving" would assert a schedule nobody recorded,
 * which is the same class of claim as a `0` standing in for a failed read.
 *
 * ─── 🔴 Aggregates only. Never a donor ───────────────────────────────────────
 *
 * A pledge document carries `donorName`, `donorEmail`, `donorPhone` and
 * `notes`. {@link toPledgeRow} READS NONE OF THEM, so no identifier crosses this
 * boundary even in memory and the summary type below has no field that could
 * hold one. That is THE-283's privacy discipline applied to a collection where
 * it matters more, not less: a dashboard that lists who has not yet paid their
 * pledge is a debtors' list, and the question this widget asks — how much of
 * what was promised has arrived — is completely answered by totals.
 * `AdminFundraising` is where the per-donor list legitimately lives, behind
 * `manageFundraising`, and it is not this.
 */
export interface PledgeRow {
  readonly pledgedDollars: number | null;
  readonly paidDollars: number | null;
  readonly status: string | null;
  readonly dueDate: DateLike;
}

const asDate = (v: unknown): DateLike => (v ?? null) as DateLike;

export const toPledgeRow = (data: Record<string, unknown>): PledgeRow => ({
  pledgedDollars: amount(data.pledgeAmount),
  paidDollars: amount(data.paidAmount),
  status: label(data.status),
  dueDate: asDate(data.dueDate),
});

/** A pledge whose money and status can both be read. */
export interface ReadablePledge {
  readonly pledgedDollars: number;
  readonly paidDollars: number;
  readonly status: string;
  readonly dueDate: DateLike;
}

/**
 * Narrow a COMPLETE pledge read, or refuse and say how many rows could not be
 * read.
 *
 * ⚠️ `status` is in the gate alongside the two amounts, for the reason `type` is
 * in `readableReceipts`': a pledge that cannot be filed under a status cannot be
 * counted as outstanding OR as fulfilled, and quietly filing it under `active`
 * would overstate what is still owed.
 */
export function readablePledges(
  rows: readonly PledgeRow[],
): { kind: 'complete'; rows: ReadablePledge[] } | { kind: 'unavailable'; reason: string } {
  const bad = rows.filter(
    (r) => r.pledgedDollars === null || r.paidDollars === null || r.status === null,
  ).length;
  if (bad > 0) return { kind: 'unavailable', reason: GIVING_REASON.unreadablePledges(bad, rows.length) };
  return { kind: 'complete', rows: rows as ReadablePledge[] };
}

/* ── Pledges: the aggregate ───────────────────────────────────────────────── */

/** Pledges sharing one status, and what they add up to. */
export interface PledgeStatusTotal {
  readonly status: string;
  readonly pledges: number;
  readonly pledgedDollars: number;
  readonly paidDollars: number;
}

/**
 * How much of what was promised has arrived.
 *
 * 🔴 `sum(byStatus[].pledges) === pledges` and `overdue + notOverdue +
 * undated === pledges` are INVARIANTS, asserted over generated inputs. Every
 * pledge the read returned is accounted for in exactly one place in each
 * partition — the discipline `bucketWeekly` applies to an undatable row and
 * `aggregateLocations` to a member who recorded no country. A pledge missing
 * from every tally while still being summed into the total is the silent
 * shortfall this whole feature refuses.
 */
export interface PledgeSummary {
  readonly pledges: number;
  readonly pledgedDollars: number;
  readonly paidDollars: number;
  /** Paid as a share of pledged, or `null` when nothing was pledged. */
  readonly percent: number | null;
  readonly byStatus: readonly PledgeStatusTotal[];
  /** Unfulfilled, with a due date that has passed. */
  readonly overdue: number;
  /** Unfulfilled, with a due date still ahead — or fulfilled already. */
  readonly notOverdue: number;
  /** 🔴 No readable due date. Counted here, never counted as overdue. */
  readonly undated: number;
}

/** The one status that means the commitment has been met. */
export const FULFILLED_STATUS = 'fulfilled';

/**
 * Summarise a COMPLETE set of readable pledges.
 *
 * `now` is a parameter rather than a `Date.now()` call so "overdue" is measured
 * against the same instant the rest of the tab was read at, and so a test can
 * pin it instead of racing the clock.
 */
export function summarisePledges(rows: readonly ReadablePledge[], now: number): PledgeSummary {
  const byStatus = new Map<string, { status: string; pledges: number; pledgedDollars: number; paidDollars: number }>();
  let pledgedDollars = 0;
  let paidDollars = 0;
  let overdue = 0;
  let notOverdue = 0;
  let undated = 0;

  for (const row of rows) {
    pledgedDollars += row.pledgedDollars;
    paidDollars += row.paidDollars;

    const key = row.status.toLocaleLowerCase();
    const entry = byStatus.get(key);
    if (entry) {
      entry.pledges++;
      entry.pledgedDollars += row.pledgedDollars;
      entry.paidDollars += row.paidDollars;
    } else {
      byStatus.set(key, {
        status: row.status,
        pledges: 1,
        pledgedDollars: row.pledgedDollars,
        paidDollars: row.paidDollars,
      });
    }

    // 🔴 A fulfilled pledge is never overdue, whatever its date says, and a
    // pledge whose date cannot be read is never overdue either — calling it
    // overdue would invent a deadline nobody recorded.
    if (key === FULFILLED_STATUS) { notOverdue++; continue; }
    const due = toSafeDate(row.dueDate)?.getTime();
    if (due == null) { undated++; continue; }
    if (due < now) overdue++;
    else notOverdue++;
  }

  return {
    pledges: rows.length,
    pledgedDollars,
    paidDollars,
    percent: pledgedDollars > 0
      ? Math.min(100, Math.max(0, (paidDollars / pledgedDollars) * 100))
      : null,
    byStatus: [...byStatus.values()].sort(
      (a, b) => b.pledgedDollars - a.pledgedDollars || a.status.localeCompare(b.status),
    ),
    overdue,
    notOverdue,
    undated,
  };
}

/* ── The reasons a Giving widget has nothing to show ──────────────────────── */

/**
 * Written once, here, for the reason {@link REASON} is written once: a widget
 * that invents its own wording can invent a reassuring one.
 *
 * 🔴 Every string below either names a READ that did not complete or states a
 * fact about the ministry's data that is true. None of them is a zero wearing a
 * sentence.
 */
export const GIVING_REASON = {
  /** Money on a campaign document that cannot be read. Refuses the widget. */
  unreadableCampaigns: (bad: number, total: number) =>
    `${bad.toLocaleString()} of ${total.toLocaleString()} campaigns carry no readable goal or raised total, so no campaign progress shown here would be complete. Every campaign's total is maintained by the giving webhook and by manual offline adjustments.`,

  /** Money or status on a pledge document that cannot be read. Refuses. */
  unreadablePledges: (bad: number, total: number) =>
    `${bad.toLocaleString()} of ${total.toLocaleString()} pledges carry no readable amount, paid total or status, so no fulfilment figure here would be complete.`,

  /** The read completed and this ministry has run no campaigns. */
  noCampaigns:
    'This ministry has not created a fundraising or pledge campaign yet, so there is no progress to show. Campaigns are created on the Fundraising screen.',

  /** The read completed and nobody has pledged to any campaign. */
  noPledges:
    'Nobody has made a pledge to this ministry yet, so there is no fulfilment to measure. Pledges arrive from a pledge campaign, or an admin records them on the Fundraising screen.',
} as const;
