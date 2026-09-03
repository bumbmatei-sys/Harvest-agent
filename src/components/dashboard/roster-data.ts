/**
 * THE-287 — the Growth and Giving tabs' aggregations: two reads, four widgets.
 *
 * ─── Why there is no read in this file ───────────────────────────────────────
 *
 * Every function here is PURE. The reads already exist: `useOverviewData`
 * already holds a COMPLETE set of `users` (it needs the dates for the member
 * trend), and this slice adds exactly one more — a complete set of `contacts`.
 * Both are the reads production already makes, one from THE-276's Overview tab
 * and one from `fetchCRMContacts`, so the four widgets below cost the dashboard
 * one additional Firestore query in total and the countries table costs none.
 *
 * 🔴 THAT IS WHY THESE ARE PURE FUNCTIONS OVER A COMPLETE SET, AND NOT QUERIES.
 * `dashboard-data.ts` spells the rule: a figure ships only when its read is
 * EXACT or PROVABLY COMPLETE. A "top 10 countries" or a "top 10 givers" served
 * by a Firestore `orderBy` + `limit` would be neither — and on these two
 * collections it would not even run:
 *
 *   • `users` and `contacts` carry NO (tenantId, createdAt) composite index,
 *     and `firestore.indexes.json` is NOT deployed on merge — `deploy-rules.yml`
 *     runs `firebase deploy --only firestore:rules,storage` and its `paths:`
 *     filter does not include the indexes file. So a new index declared there is
 *     inert and the query throws `failed-precondition` in production.
 *   • A complete in-memory set sorts with `Array.sort`, exactly, at any size up
 *     to the ceiling — and above the ceiling `completeRead` refuses rather than
 *     handing back a truncated set that looks whole.
 *
 * ⚠️ `@tanstack/react-table` is not installed and is not needed. It buys
 * server-side sorting, filtering and pagination over a windowed dataset; this
 * has the whole dataset in memory and one fixed order per table.
 */
import { resolvePipelineStage, type PipelineStage } from '../../hooks/queries/useCRMQueries';
import { REASON } from './dashboard-data';
import type { DateLike } from '../../utils/format-date';

/* ── Row shapes ───────────────────────────────────────────────────────────── */

/**
 * One `users` document, as the dashboard reads it.
 *
 * ⚠️ `country` and `city` are TOP-LEVEL fields on `users`, written together by
 * Onboarding's `saveToFirestore` and by `PersonalInformationModal`. They are
 * NOT the `address.country` / `address.city` on a `contacts` document, which is
 * a different collection describing different people.
 *
 * 🔴 Both are read as `string`, defaulting to `''` for absent — and `''` means
 * NOT RECORDED, never "Unknown" as a place. {@link countryTally} counts blanks
 * separately and reports them; it never files them under a country name.
 */
export interface MemberRow {
  readonly createdAt: DateLike;
  readonly country: string;
  readonly city: string;
}

/**
 * One `contacts` document, as the two giving widgets read it.
 *
 * 🔴 `totalDonated` is kept as `unknown` deliberately. It is DOLLARS on the
 * document (see the field doc on `Contact` and `CHAMPION_THRESHOLD_DOLLARS`),
 * and the one thing that must never happen to it is a silent `?? 0` on the way
 * in. Everything that consumes it goes through {@link givenDollars} or through
 * `resolvePipelineStage`, and both read it the same way.
 */
export interface ContactRow {
  readonly id: string;
  readonly name: string;
  readonly totalDonated: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const toMemberRow = (data: Record<string, unknown>): MemberRow => ({
  createdAt: (data.createdAt ?? null) as DateLike,
  country: str(data.country),
  city: str(data.city),
});

/**
 * A contact's display name, from the fields the CRM itself writes.
 *
 * Falls back to the email and then to a placeholder rather than to an empty
 * cell: a leaderboard row with a real amount and no label is still a real gift,
 * and blanking it would drop it from a list it belongs in.
 */
const nameOf = (data: Record<string, unknown>): string => {
  const full = [str(data.firstName), str(data.lastName)].filter(Boolean).join(' ');
  return full || str(data.email) || 'Unnamed contact';
};

export const toContactRow = (data: Record<string, unknown>, id: string): ContactRow => ({
  id,
  name: nameOf(data),
  totalDonated: data.totalDonated,
});

/* ── Money: dollars, and only dollars ─────────────────────────────────────── */

/**
 * What a contact has given, in DOLLARS, or `null` for "no donations recorded".
 *
 * 🔴 THIS IS NOT `invoices.amount`. That field is CENTS — the Stripe webhook
 * writes `amount: amountCents` and `GivingMix` divides by 100 at display.
 * `contacts.totalDonated` is dollars at rest and is formatted with no division
 * at all. The two are never added, compared or shown in the same figure, and
 * this slice reads only `totalDonated`.
 *
 * ⚠️ It coerces through `Number()` for one reason: so that it agrees with
 * `resolvePipelineStage`, which is the app's single definition of a giving
 * stage and does exactly the same thing. A reader that disagreed with the stage
 * function would put a contact in the funnel's Champion band and off the top
 * givers list, or the reverse.
 *
 * 🔴 `null` is not a zero and is never summed as one. Nothing in this slice
 * sums `totalDonated` at all — the funnel counts PEOPLE per stage and the
 * leaderboard RANKS individuals — which is why a missing value costs no total
 * its accuracy. (`readableReceipts` guards the read that does sum money, and is
 * untouched by this ticket.)
 */
export function givenDollars(totalDonated: unknown): number | null {
  const given = Number(totalDonated);
  return Number.isFinite(given) && given > 0 ? given : null;
}

/* ── Widget 1 · Countries and cities, as counts ───────────────────────────── */

/** How many members are in one city. A count of people, never the people. */
export interface CityCount { readonly city: string; readonly members: number }

/** One country's row: how many members, and which cities they are in. */
export interface CountryRow {
  readonly country: string;
  readonly members: number;
  readonly cities: readonly CityCount[];
  /** Members in this country whose city is blank. Disclosed, not hidden. */
  readonly cityless: number;
}

/**
 * The whole table, plus the coverage that decides whether it can be believed.
 *
 * 🔴 `covered` and `total` are not a footnote, they are the headline. A "top
 * countries" table built from a sparsely-populated field is a wrong number
 * wearing a table: 12 rows summing to 40 people, on a roster of 800, reads as
 * "we are in 12 countries" when it means "40 of our members told us where they
 * are". The widget states both, above the table, at the same visual weight.
 */
export interface CountryTally {
  readonly rows: readonly CountryRow[];
  /** Members carrying a non-blank `country`. The rows below sum to exactly this. */
  readonly covered: number;
  /** Every member in the complete read, recorded country or not. */
  readonly total: number;
  /** Members carrying a non-blank `city`. Reported for the same reason. */
  readonly cityCovered: number;
}

/**
 * Pick the spelling to display for a set of equivalent free-text values.
 *
 * ⚠️ `users.city` is a FREE-TEXT input — Onboarding renders a plain `ObInput`
 * for it while `country` comes from `CountrySelect`'s fixed 195-name list — so
 * "Nairobi" and "nairobi" are the same place typed twice. Grouping on a
 * case-folded key is what keeps them one row; showing the MOST FREQUENT
 * original spelling is what keeps the label something a member actually wrote
 * rather than something this function invented.
 *
 * ⚠️ Ties break on CODE-UNIT order, not `localeCompare`, and the difference is
 * visible: two members typing "Nairobi" and "nairobi" once each is a tie, and
 * ICU collation sorts the lowercase form first, so `localeCompare` would put
 * "nairobi 2" on screen while an equally-attested "Nairobi" sat unused. Code
 * units put uppercase first, which is the form a reader expects of a place
 * name. Either rule is deterministic — the count is 2 whichever wins — and this
 * one is the one that does not look like a defect.
 */
function dominantSpelling(spellings: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [spelling, count] of [...spellings.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (count > bestCount) { best = spelling; bestCount = count; }
  }
  return best;
}

/**
 * Group a COMPLETE set of members into country and city counts.
 *
 * 🔴 COUNTS ONLY. No row of this result carries a member's name, id, email or
 * any other per-person value, and there is no shape here that could hold one —
 * `CountryRow` and `CityCount` are a label and an integer. A church admin
 * screen that itemises individuals by location is a privacy posture to avoid,
 * and the aggregate is also the only thing the question ("where are our
 * people") actually asks.
 *
 * Ordering is `Array.sort` over the whole set: members descending, then country
 * ascending so equal counts have a stable, readable order. No Firestore
 * `orderBy` is involved and none would be valid — see this module's header.
 */
export function countryTally(rows: readonly MemberRow[]): CountryTally {
  const byCountry = new Map<string, { members: number; cities: Map<string, Map<string, number>>; cityless: number }>();
  let covered = 0;
  let cityCovered = 0;

  for (const row of rows) {
    if (row.city) cityCovered++;
    // A blank country is NOT a country called "Unknown". It is counted in
    // `total`, excluded from `covered`, and given no row.
    if (!row.country) continue;
    covered++;

    let entry = byCountry.get(row.country);
    if (!entry) { entry = { members: 0, cities: new Map(), cityless: 0 }; byCountry.set(row.country, entry); }
    entry.members++;

    if (!row.city) { entry.cityless++; continue; }
    const key = row.city.toLocaleLowerCase();
    const spellings = entry.cities.get(key) ?? new Map<string, number>();
    spellings.set(row.city, (spellings.get(row.city) ?? 0) + 1);
    entry.cities.set(key, spellings);
  }

  const rowsOut: CountryRow[] = [...byCountry.entries()].map(([country, entry]) => ({
    country,
    members: entry.members,
    cities: [...entry.cities.values()]
      .map((spellings) => ({
        city: dominantSpelling(spellings),
        members: [...spellings.values()].reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.members - a.members || a.city.localeCompare(b.city)),
    cityless: entry.cityless,
  }));

  rowsOut.sort((a, b) => b.members - a.members || a.country.localeCompare(b.country));
  return { rows: rowsOut, covered, total: rows.length, cityCovered };
}

/* ── Widget 2 · The GIVING-TIER funnel ────────────────────────────────────── */

/**
 * The three stages, widest first, spelled once.
 *
 * 🔴 THIS IS A GIVING FUNNEL AND IT SAYS SO. `devotion` is not a concept this
 * product records — there is no collection, no field and no event for a
 * devotional read, start or streak, and the only matches for the word anywhere
 * in `src/` are marketing copy. THE-276 documented that in `FunnelChart.tsx`'s
 * own header and deliberately mounted NOTHING under that label; the Overview
 * tab still carries its honest empty state saying so, and this ticket does not
 * touch it.
 *
 * ⚠️ What IS measured is `resolvePipelineStage(contact.totalDonated)` — the
 * app's single definition of a pipeline stage, derived from giving and never
 * stored. Member is "no donations recorded" (`<= 0`, or a value that is not a
 * finite number), Champion is `>= CHAMPION_THRESHOLD_DOLLARS` ($10,000), and
 * Giving is everything between. Those are the labels this widget uses, because
 * they are the ones the data supports.
 */
export const GIVING_STAGES: ReadonlyArray<{ readonly key: PipelineStage; readonly label: string }> = Object.freeze([
  { key: 'member', label: 'Member' },
  { key: 'giving', label: 'Giving' },
  { key: 'champion', label: 'Champion' },
]);

export interface StageCount { readonly key: string; readonly label: string; readonly value: number }

/**
 * Count a COMPLETE set of contacts into the three giving tiers.
 *
 * ⚠️ NOT a drop-off funnel. The three bands PARTITION the contact list — every
 * contact is in exactly one, and they sum to the whole — so the bars are tier
 * sizes, not survivors of a sequence. `FunnelChart` draws an ordered set of
 * magnitudes on a shared baseline, which is what that is; the widget's
 * description says so rather than leaving a reader to assume conversion.
 */
export function givingFunnel(rows: readonly ContactRow[]): StageCount[] {
  const counts = new Map<PipelineStage, number>(GIVING_STAGES.map((s) => [s.key, 0]));
  for (const row of rows) {
    const stage = resolvePipelineStage(givenDollars(row.totalDonated));
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return GIVING_STAGES.map((s) => ({ key: s.key, label: s.label, value: counts.get(s.key) ?? 0 }));
}

/* ── Widget 3 · Top givers ────────────────────────────────────────────────── */

export interface TopGiver {
  readonly id: string;
  readonly name: string;
  /** DOLLARS. Positive and finite by construction — see {@link givenDollars}. */
  readonly dollars: number;
  readonly stage: PipelineStage;
}

/** How many rows the leaderboard shows. A display cap on a complete set. */
export const TOP_GIVERS = 10;

/**
 * The largest givers, ranked with `Array.sort` over the whole contact list.
 *
 * 🔴 THE CAP IS ON THE DISPLAY, NOT ON THE READ, and the difference is the
 * whole point. `completeRead` has already established that every matching
 * contact is in hand, so ranking them is exact and slicing the top ten off the
 * end cannot change who is in it. A Firestore `orderBy('totalDonated','desc')
 * .limit(10)` would look identical and would be an unordered sample of an
 * unindexed collection — the THE-276 defect with a different field name.
 *
 * ⚠️ Contacts with no recorded giving are ABSENT rather than ranked last at
 * $0: they have not given, and a leaderboard that pads itself to ten rows with
 * zeroes states something about people who are simply not donors.
 */
export function topGivers(rows: readonly ContactRow[], cap: number = TOP_GIVERS): TopGiver[] {
  return rows
    .map((row) => {
      const dollars = givenDollars(row.totalDonated);
      return dollars === null ? null : {
        id: row.id,
        name: row.name,
        dollars,
        stage: resolvePipelineStage(dollars),
      };
    })
    .filter((g): g is TopGiver => g !== null)
    .sort((a, b) => b.dollars - a.dollars || a.name.localeCompare(b.name))
    .slice(0, cap);
}

/* ── The reasons these widgets refuse with ────────────────────────────────── */

/**
 * ⚠️ Composed from {@link REASON}, never written fresh. The empty states on
 * this tab have to be indistinguishable in kind from THE-276's: "we could not
 * read this" and "there is none of this" are different claims and the shared
 * strings are what keeps a widget from inventing a friendlier third one.
 */
export const ROSTER_REASON = {
  noCountries: REASON.noSource('where its members are — no member carries a country'),
  noGivers: REASON.noSource('a donation against any contact'),
} as const;
