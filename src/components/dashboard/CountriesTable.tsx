"use client";
/**
 * THE-287 — "Where your people are", as COUNTS.
 *
 * ─── 🔴 The privacy property, and why it is structural rather than careful ───
 *
 * This widget never lists or plots a member as an individual. "12 in Nairobi",
 * not twelve rows naming people. That is not a rule this component remembers to
 * follow — it is a rule it CANNOT break, because the only thing it is given is
 * {@link CountryTally}, whose row types are a label and an integer. There is no
 * name, id, email or document here to render; a mutation that tried to print a
 * member would have to change the aggregation's types first.
 *
 * A church admin screen that itemises individuals by location is a posture to
 * avoid on its own merits, and it is also not the question: "where are our
 * people" is answered by the aggregate. `AdminSignups` remains the screen for
 * working with a named list, gated by the same `analytics` permission.
 *
 * ─── ⚠️ Coverage is the headline, not a footnote ─────────────────────────────
 *
 * `users.country` comes from `CountrySelect`'s fixed 195-name list and
 * `users.city` is a free-text input, but NEITHER is written at signup:
 * `AuthPage` creates the document with uid, email, displayName, createdAt,
 * role, tenantId, newsletter and termsAccepted, and nothing else. Both fields
 * arrive only from Onboarding's location step or from a later edit in
 * `PersonalInformationModal`. So:
 *
 *   • `country` is present exactly when a member has been through one of those
 *     two screens. Onboarding will not advance past the step without it
 *     (`validate`'s `default_location` arm), so a COMPLETED onboarding always
 *     has one — and an abandoned one has none.
 *   • ⚠️ A TENANT OWNER TYPICALLY HAS NEITHER. All three provisioning paths —
 *     `free-provisioning.ts` and the Stripe and Dodo handlers — write
 *     `onboardingCompleted: true` directly, so the owner never sees the form
 *     and carries no country until they edit their profile.
 *   • `city` is validated nowhere, so it can be blank even on a completed
 *     onboarding. `cityCovered` is reported separately for that reason.
 *
 * 🔴 The live fraction cannot be known from here — it depends on how many of a
 * ministry's members finished onboarding — which is exactly why it is MEASURED
 * at read time and stated ABOVE the table, in the widget's own description,
 * every time. A "top countries" table built from a partially-populated field is
 * a wrong number wearing a table: twelve rows summing to forty, on a roster of
 * eight hundred, reads as "we are in twelve countries" and means "forty of our
 * members told us where they are". Not a caveat, and not behind a threshold
 * somebody has to pick.
 */
import React from 'react';
import { MapPin } from 'lucide-react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { WidgetFrame, type WidgetState } from './WidgetFrame';
import type { CountryTally } from './roster-data';

/** How many cities are named per country before the rest are summarised. */
export const CITIES_PER_COUNTRY = 3;

/**
 * The cities cell for one country, already reduced to counts.
 *
 * ⚠️ The overflow is DISCLOSED, not dropped: three named cities and then
 * "+4 more" means the row still accounts for everyone in it. Silently showing
 * the top three would make the city counts appear to sum to the country's
 * total when they do not.
 */
export function cityLabel(
  cities: readonly { readonly city: string; readonly members: number }[],
  cityless: number,
  cap: number = CITIES_PER_COUNTRY,
): string {
  const shown = cities.slice(0, cap).map((c) => `${c.city} ${c.members.toLocaleString()}`);
  const rest = cities.length - shown.length;
  if (rest > 0) shown.push(`+${rest.toLocaleString()} more`);
  if (cityless > 0) shown.push(`${cityless.toLocaleString()} no city`);
  return shown.join(' · ') || 'No city recorded';
}

/** The sentence that qualifies every number below it. */
export function coverageNote(tally: CountryTally): string {
  const share = tally.total === 0 ? 0 : Math.round((tally.covered / tally.total) * 100);
  return `${tally.covered.toLocaleString()} of ${tally.total.toLocaleString()} members (${share}%) have a recorded country, `
    + `and ${tally.cityCovered.toLocaleString()} have a city. The counts below cover only those members.`;
}

export function CountriesTable({ tally, reason }: {
  readonly tally: CountryTally | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = tally === null && reason === null
    ? { kind: 'loading' }
    : tally === null
      ? { kind: 'unavailable', reason: reason ?? '' }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Countries and cities"
      description={tally ? coverageNote(tally) : 'How many members are in each country, and in which cities.'}
      icon={MapPin}
      state={state}
      skeletonClassName="h-56 w-full"
    >
      {/*
        ⚠️ `Table` renders its own `data-slot="table-container"` wrapper at
        `relative w-full overflow-x-auto`, so a table too wide for a 380px phone
        scrolls INSIDE this card and the page body never moves. That is #422's
        pattern, taken from the primitive rather than re-spelled here — see
        `AdminSignups`' UserTable for the hand-rolled original.
      */}
      <Table data-countries-table>
        <TableHeader>
          <TableRow>
            <TableHead>Country</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead>Cities</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tally?.rows ?? []).map((row) => (
            <TableRow key={row.country} data-country-row={row.country}>
              <TableCell className="font-medium text-foreground">{row.country}</TableCell>
              <TableCell className="text-right tabular-nums" data-country-members>
                {row.members.toLocaleString()}
              </TableCell>
              {/*
                ⚠️ The primitive's own `whitespace-nowrap` is kept, deliberately.
                Letting this cell WRAP made the table fit a 380px phone — and
                turned every row into five or six lines of stacked city names.
                Scrolling the table sideways inside its own card is #422's
                established pattern and the one this screen follows.
              */}
              <TableCell className="text-muted-foreground">
                {cityLabel(row.cities, row.cityless)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </WidgetFrame>
  );
}
