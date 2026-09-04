/**
 * THE-283 — the Growth tab's read layer: where the ministry's people are.
 *
 * ─── This module answers ONE question, and it answers it completely ──────────
 *
 * "How many members are in each country and city." Not "who is in Nairobi" —
 * see the privacy note below — and not "the top five countries", which is a
 * different and much weaker claim than the one this file is willing to make.
 *
 * 🔴 THE COVERAGE PROBLEM, MEASURED RATHER THAN ASSUMED. `city` and `country`
 * are TOP-LEVEL fields on a `users` document, and they are written by exactly
 * two paths: `Onboarding.saveToFirestore` and `PersonalInformationModal`. They
 * are therefore ABSENT on a member document at the moment it is created —
 * `AuthPage` writes `uid/email/displayName/createdAt/role/tenantId/newsletter/
 * termsAccepted` and nothing else — and they stay absent until that member
 * finishes onboarding. Three provisioning paths (`lib/free-provisioning`, the
 * Stripe webhook and `lib/dodo/provisioning`) set `onboardingCompleted: true`
 * WITHOUT ever writing either field, so a tenant owner who arrived by
 * purchasing a plan has neither, permanently. And within onboarding itself only
 * `country` is validated — `default_location` refuses an empty COUNTRY and
 * accepts an empty CITY — so `city` is the sparser of the two by construction.
 *
 * ⚠️ So a "top countries" table over this field is a table over a partial
 * column, and the honest response is neither to draw it silently nor to refuse
 * outright. It is to make the partiality a FIGURE — see
 * {@link LocationBreakdown}, where `withCountry + countryUnrecorded === total`
 * is an invariant, not a hope. Every member the read returned lands in exactly
 * one place: a country row, or the unrecorded tally that is rendered beside the
 * table. That is the same discipline `bucketWeekly` applies to an undatable row,
 * and for the same reason — a member missing from a table without being counted
 * anywhere is the silent shortfall this whole feature exists to refuse.
 *
 * 🔴 NO `|| ''` AND NO `'Unknown'` BUCKET. `AdminSignups` reads the same two
 * fields as `data.city || ""` / `data.country || ""` and then groups; the empty
 * string becomes a real key, and a member with no country is silently filed
 * under a country named "". {@link toMemberLocation} returns `null` instead,
 * which has no such reading and cannot be summed into a row by accident. It is
 * the same coercion `toInvoiceRow` refuses on the money path, one field over.
 *
 * ─── 🔴 Aggregates only. Never a person ──────────────────────────────────────
 *
 * Nothing this module produces carries a member's id, name, email or phone, and
 * that is a deliberate ceiling rather than an omission: an admin screen that
 * itemises individuals by where they live is a surveillance affordance, and the
 * question the widget asks ("where are our people") is fully answered by counts.
 * {@link CountryRow} and {@link CityCount} have no field that could hold an
 * identifier, so the privacy property is enforced by the TYPE, not by the
 * discipline of whoever writes the next widget. `AdminSignups` is where a
 * per-person list legitimately lives; it is a tool you work in, gated by the
 * same `analytics` permission, and it is not this.
 *
 * ─── Why the read is COMPLETE and not ordered ────────────────────────────────
 *
 * Unchanged from THE-276, and it still binds: `users` has no (tenantId,
 * createdAt) composite index and this repo avoids composite indexes by design,
 * so an ordered window is not available here at all. {@link completeRead} takes
 * the count first and refuses above the ceiling, which is what makes the
 * aggregation below exact — with every matching document in hand, the order
 * they arrived in cannot change what the rows add up to.
 */
import {
  REASON,
  boundedScopedQuery,
  completeRead,
  scopedQuery,
} from './dashboard-data';

export { boundedScopedQuery, completeRead, scopedQuery };

/* ── The row shape, read from the documents this app actually writes ──────── */

/**
 * One member's recorded location.
 *
 * 🔴 Both fields are NULLABLE and neither has a default. `null` means "this
 * member never recorded it", which is a true and useful thing to count; `''`
 * and `'Unknown'` are values that look like places.
 */
export interface MemberLocation {
  readonly country: string | null;
  readonly city: string | null;
}

/** A trimmed non-empty string, or `null`. A whitespace-only field is not a place. */
const place = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * 🔴 Reads ONLY the two location fields. It does not read `displayName`,
 * `email`, `phone` or `uid`, so no identifier is carried past this boundary
 * even in memory — the aggregation downstream could not leak one if it tried.
 */
export const toMemberLocation = (data: Record<string, unknown>): MemberLocation => ({
  country: place(data.country),
  city: place(data.city),
});

/* ── The aggregate ────────────────────────────────────────────────────────── */

/** Members in one city. A count and a place name; there is no third field. */
export interface CityCount {
  readonly city: string;
  readonly members: number;
}

/** Members in one country, broken down by the cities they recorded. */
export interface CountryRow {
  readonly country: string;
  readonly members: number;
  readonly cities: readonly CityCount[];
  /** Members in this country who recorded no city. Never folded into a city. */
  readonly citiesUnrecorded: number;
}

/**
 * The whole answer, including the part that is missing.
 *
 * 🔴 `withCountry + countryUnrecorded === total` and
 * `sum(rows[].members) === withCountry` are INVARIANTS, asserted by the test
 * suite over generated inputs. They are what makes it safe to render this: a
 * reader can add the table up and reach the member count on the Overview tab,
 * and the difference is on screen rather than lost.
 */
export interface LocationBreakdown {
  /** Members in the complete read. Equal to the tenant's member count. */
  readonly total: number;
  readonly withCountry: number;
  readonly withCity: number;
  /** Members who recorded no country at all. */
  readonly countryUnrecorded: number;
  /** Country rows, most populous first, ties broken by name so it is stable. */
  readonly rows: readonly CountryRow[];
}

/**
 * Group a COMPLETE set of member locations into country and city counts.
 *
 * ⚠️ Sorting is done HERE, in plain JavaScript over an array that is already
 * entirely in memory, and it is descending-by-count with an alphabetical
 * tiebreak so the same data always renders in the same order. 🔴 That is NOT
 * the sorting `@tanstack/react-table` sells: that package buys INTERACTIVE
 * column sorting and filtering — a header a reader can click. It is not
 * installed, it is not needed for a static ordering, and it is not added here;
 * the decision is recorded in the PR rather than taken silently.
 *
 * Case is normalised for GROUPING only ("kenya" and "Kenya" are one country),
 * while the label shown is the first spelling encountered, so nothing is
 * re-titled into a form no member typed.
 */
export function aggregateLocations(rows: readonly MemberLocation[]): LocationBreakdown {
  const countries = new Map<string, { label: string; members: number; cities: Map<string, { label: string; members: number }>; citiesUnrecorded: number }>();
  let withCountry = 0;
  let withCity = 0;

  for (const row of rows) {
    if (row.city !== null) withCity++;
    // 🔴 A member with a city but NO country is counted in `withCity` and in
    // `countryUnrecorded`, and contributes to no country row. Inventing a
    // country from a city name would be geocoding, which this app does not do.
    if (row.country === null) continue;
    withCountry++;

    const key = row.country.toLocaleLowerCase();
    let entry = countries.get(key);
    if (!entry) {
      entry = { label: row.country, members: 0, cities: new Map(), citiesUnrecorded: 0 };
      countries.set(key, entry);
    }
    entry.members++;

    if (row.city === null) {
      entry.citiesUnrecorded++;
      continue;
    }
    const cityKey = row.city.toLocaleLowerCase();
    const city = entry.cities.get(cityKey);
    if (city) city.members++;
    else entry.cities.set(cityKey, { label: row.city, members: 1 });
  }

  const byCount = <T extends { members: number; label: string }>(a: T, b: T) =>
    b.members - a.members || a.label.localeCompare(b.label);

  return {
    total: rows.length,
    withCountry,
    withCity,
    countryUnrecorded: rows.length - withCountry,
    rows: [...countries.values()].sort(byCount).map((entry) => ({
      country: entry.label,
      members: entry.members,
      citiesUnrecorded: entry.citiesUnrecorded,
      cities: [...entry.cities.values()].sort(byCount).map((c) => ({ city: c.label, members: c.members })),
    })),
  };
}

/* ── The reasons a Growth widget has nothing to show ──────────────────────── */

/**
 * Written once, here, for the same reason {@link REASON} is: a widget that
 * invents its own wording can invent a reassuring one.
 *
 * 🔴 The DEFERRED reasons are not failures and do not pretend to be. They say
 * what is missing and whose ticket it is, because "this tab has three widgets"
 * and "this tab has seven widgets and two of them could not be read" are
 * different claims and only the first is true.
 *
 * ⚠️ THERE ARE TWO NOW, NOT THREE — THE-299 built the retention heatmap and
 * DELETED its string rather than leaving it beside the widget it describes.
 */
export const GROWTH_REASON = {
  /** Read completed, but not one member has recorded a country. */
  noLocationRecorded: (total: number) =>
    `None of this ministry's ${total.toLocaleString()} members has recorded a country yet, so there is nowhere to place them. Members supply their city and country during onboarding.`,

  /*
   * ⚠️ `retentionDeferred` IS GONE, REMOVED BY THE-299 RATHER THAN LEFT
   * STANDING. It said "no heatmap component exists anywhere in this app to
   * build it from", which was a true statement about this app and a false one
   * about the world: spectrum's registry publishes `cohort-chart`, it declares
   * no dependency, and THE-299 installed it. THE-285 had already established
   * that the data exists. A deferral string beside a built widget is worse than
   * no string at all — the two reasons below are the ones that still hold.
   */

  /** Deferred: stage conversion. Two independent reasons, both stated. */
  conversionDeferred:
    'Two things are missing, not one: recharts ships no funnel series type, and this product records no devotional stage — there is no collection, no field and no event to count. The CRM giving pipeline is a real funnel, but labelling giving tiers as devotion would assert something nobody measured.',

  /** Deferred: the geo map. */
  geoDeferred:
    'A choropleth needs react-simple-maps and a world topology file of roughly 100KB — a dependency decision, not a layout one. It would also answer the same question as the countries table beside it, which was built first.',
} as const;

/** Re-exported so the Growth widgets need one import for every reason string. */
export { REASON };
