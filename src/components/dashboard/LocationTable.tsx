"use client";
/**
 * THE-283 — "Countries & cities": where this ministry's members are, in counts.
 *
 * ─── 🔴 Aggregates. Never a person ───────────────────────────────────────────
 *
 * Every row below is a PLACE and a NUMBER — "Kenya · 12", "Nairobi · 7". There
 * is no row per member, no name, no email, no id, and no expander that reveals
 * one, because {@link LocationBreakdown} has no field that could carry one: the
 * privacy property is enforced by the shape of the data this widget is given,
 * not by the restraint of whoever edits it next. An admin screen that lists
 * individuals by where they live is a surveillance affordance, and the question
 * this widget asks is completely answered without it. `AdminSignups` is where a
 * per-person list legitimately lives, behind the same `analytics` permission.
 *
 * ─── The coverage line is not a footnote, it is part of the figure ───────────
 *
 * 🔴 `city` and `country` are absent on a member document until that member
 * finishes onboarding, three provisioning paths never write them at all, and
 * only `country` is validated when they do — see `growth-data`'s header for the
 * paths. So this table is drawn over a PARTIAL column, and a "top countries"
 * list that does not say so is a wrong number wearing a table.
 *
 * The response is neither to hide the widget nor to draw it quietly: the count
 * of members who recorded nothing is rendered BESIDE the table, from the same
 * read, as a number of the same standing as the rows. `withCountry +
 * countryUnrecorded === total` is an invariant of the aggregate, so a reader can
 * add this table up and land exactly on the member count the Overview tab
 * shows. Nothing is lost between the two screens.
 *
 * ─── Adopting `ui/table` ─────────────────────────────────────────────────────
 *
 * ⚠️ THE-272 installed `table` and asserted it was imported by nothing, with the
 * note that adoption is an explicit decision for a later ticket. This is that
 * decision, and it is RECORDED in that guard rather than removed from it: the
 * assertion now names this file as the one adopter and still fails on a second.
 * `pagination` and `progress` remain adopted by nothing — the long-list problem
 * here is solved by scrolling inside the card, which needs no primitive.
 *
 * ⚠️ At 380px the table is wider than the card. It scrolls INSIDE its own
 * container (`ui/table` wraps every table in `overflow-x-auto` already) and the
 * PAGE BODY does not move — the pattern THE-422 established and this widget's
 * measurement test re-asserts in a real browser at all five widths.
 */
import React from 'react';
import { MapPin } from 'lucide-react';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON, type LocationBreakdown } from './growth-data';

/**
 * How many country rows are drawn before the list scrolls rather than growing
 * the card without bound.
 *
 * 🔴 NOTHING IS DROPPED. This is a viewport on a list that is entirely present
 * — every country is in the DOM and reachable by scrolling — not a `slice()`.
 * A truncated table would be the sampling defect again, one layer up.
 */
const SCROLL_AFTER_ROWS = 8;

/** A count with its unit, so a bare number never floats free of its meaning. */
const members = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`;

export function LocationTable({ breakdown, reason }: {
  readonly breakdown: LocationBreakdown | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = breakdown === null && reason === null
    ? { kind: 'loading' }
    : breakdown === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Countries & cities"
      description="Where your members say they are. Counts only."
      icon={MapPin}
      state={state}
      skeletonClassName="h-56 w-full"
    >
      <div className="space-y-3" data-location-table>
        {/*
          `max-h` plus `overflow-y-auto` on the VERTICAL axis only. The
          horizontal scroll belongs to `ui/table`'s own container, one level in,
          which is what keeps a 380px overflow off the page body.
        */}
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead>Cities</TableHead>
                <TableHead className="text-right">Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(breakdown?.rows ?? []).map((row) => (
                <TableRow key={row.country} data-country-row={row.country}>
                  <TableCell className="font-medium whitespace-nowrap">{row.country}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {/*
                      Cities as counted phrases, not as a list of places with the
                      count implied. "Nairobi 7" reads as an aggregate; "Nairobi"
                      on its own invites the reader to ask which seven.
                    */}
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {row.cities.map((city) => (
                        <span key={city.city} data-city-count={city.city}>
                          {`${city.city} ${city.members.toLocaleString()}`}
                        </span>
                      ))}
                      {row.citiesUnrecorded > 0 && (
                        <span data-city-unrecorded={row.country}>
                          {`No city recorded ${row.citiesUnrecorded.toLocaleString()}`}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {row.members.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/*
          🔴 The part of the answer that is missing, stated as a figure. It is
          rendered unconditionally when the read succeeded — including when it is
          zero, where it is the reassurance that the table above is the whole
          membership rather than most of it.
        */}
        {breakdown && (
          <p className="text-xs text-muted-foreground" data-location-coverage>
            {breakdown.countryUnrecorded === 0
              ? `All ${members(breakdown.total)} recorded a country. ${breakdown.withCity.toLocaleString()} of them also recorded a city.`
              : `${breakdown.withCountry.toLocaleString()} of ${members(breakdown.total)} recorded a country and ${breakdown.withCity.toLocaleString()} recorded a city. The remaining ${breakdown.countryUnrecorded.toLocaleString()} are counted here but placed nowhere: members supply both during onboarding, and accounts created by a plan purchase are never asked.`}
          </p>
        )}

        {breakdown && breakdown.rows.length > SCROLL_AFTER_ROWS && (
          <p className="text-xs text-muted-foreground" data-location-scrolls>
            {`All ${breakdown.rows.length.toLocaleString()} countries are listed; the table scrolls.`}
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
