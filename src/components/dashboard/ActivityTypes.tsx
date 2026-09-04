"use client";
/**
 * THE-294 — "Activity type": what kind of CRM records this ministry is
 * accumulating, and who wrote them.
 *
 * ─── 🔴 THE NAME IS THE WHOLE WIDGET ────────────────────────────────────────
 *
 * The design package calls this CHANNEL SHARE. It is not built under that name
 * and the difference is not cosmetic:
 *
 *   · What this reads is `contactActivities.type`, whose five values are
 *     `note | donation | email | call | meeting` — the union declared on
 *     `ContactActivity` in `useCRMQueries` and the five buttons AdminCRM's own
 *     type picker offers. They describe WHAT A CRM ROW IS.
 *   · A marketing channel is HOW A PERSON ARRIVED. Nothing in this database
 *     records one: a contact document has no `source`, `referrer`, `campaign`
 *     or `utm` field, and the analytics that do exist record route patterns
 *     rather than campaigns.
 *
 * 🔴 So "channel share: email 40%" would tell a founder that four in ten of
 * their people came in through email, when the number actually says that four
 * in ten of the rows their staff typed were emails their staff sent. That is a
 * wrong number with a confident label, which is the defect this whole tab exists
 * to refuse — the same class of claim as a `0` standing in for a failed read.
 * THE-285 established the point; this slice keeps it, and a guard test sweeps
 * both this source and the rendered output for the word "channel".
 *
 * ─── Why there is no percentage column ──────────────────────────────────────
 *
 * ⚠️ Percentages are what make a type breakdown READ as a share of something,
 * and "share" is the framing being refused. The counts are exact and a reader
 * who wants a proportion can take one; a column that computes it for them
 * invites exactly the sentence the name above is written to prevent.
 *
 * ─── 🔴 Aggregates only. Never a person, and never a person by type ─────────
 *
 * Every row here is a TYPE and three NUMBERS. `ActivityBreakdown` has no field
 * that could hold a contact id, name or email, so this widget could not itemise
 * an individual if it tried — the property is enforced by the type it is handed,
 * exactly as THE-283 enforced it for the countries table. That matters
 * specifically here: a table of who received which kind of contact is a record
 * of pastoral care, and "what kind of records are we accumulating" is fully
 * answered by counts. `AdminCRM` is where a per-person timeline legitimately
 * lives, behind `manageCRM`.
 *
 * ─── Adopting `ui/table` ────────────────────────────────────────────────────
 *
 * ⚠️ THE-272's guard holds a CLOSED list of `table` adopters and this file is
 * added to it rather than the assertion being relaxed: a FOURTH adopter still
 * fails there. `pagination` stays adopted by nothing — at most five rows exist,
 * one per type, so there is nothing to paginate.
 *
 * ⚠️ At 380px the table is wider than the card. It scrolls INSIDE its own
 * container (`ui/table` wraps every table in `overflow-x-auto` already) and the
 * PAGE BODY does not move — measured in Chromium at all five widths.
 */
import React from 'react';
import { ListChecks } from 'lucide-react';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON, type ActivityBreakdown } from './engagement-data';

const count = (n: number) => n.toLocaleString();

export function ActivityTypes({ breakdown, reason }: {
  readonly breakdown: ActivityBreakdown | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = breakdown === null && reason === null
    ? { kind: 'loading' }
    : breakdown === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Activity type"
      description="CRM activity rows by the kind of record they are. Counts only."
      icon={ListChecks}
      state={state}
      skeletonClassName="h-56 w-full"
    >
      <div className="space-y-3" data-activity-types>
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Recorded automatically</TableHead>
                <TableHead>Logged by an admin</TableHead>
                <TableHead className="text-right">Activities</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(breakdown?.rows ?? []).map((row) => (
                <TableRow key={row.type} data-activity-row={row.type}>
                  <TableCell className="font-medium whitespace-nowrap">{row.label}</TableCell>
                  {/*
                    The two origins as counted phrases rather than bare numbers:
                    a column of digits under a two-word heading is read as a
                    proportion, and neither of these is one.
                  */}
                  <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap text-xs">
                    {count(row.appRecorded)}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap text-xs">
                    {count(row.adminLogged)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {count(row.activities)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/*
          🔴 THE CLOSED ACCOUNTING, ON SCREEN. The rows above plus `unrecognised`
          equal the total, so a reader can add the table up and land exactly on
          it. A row whose `type` is not one of the five this app writes is
          counted here rather than filed under a heading it does not belong to —
          the same refusal `toMemberLocation` makes with an empty country.
        */}
        {breakdown && (
          <p className="text-xs text-muted-foreground" data-activity-total>
            {breakdown.unrecognised === 0
              ? `${count(breakdown.total)} activity records in total, every one of them one of the five kinds above. ${count(breakdown.appRecorded)} were recorded automatically by check-in, forms, event registration or a confirmed donation; ${count(breakdown.adminLogged)} were logged by an admin working in the CRM.`
              : `${count(breakdown.total)} activity records in total. ${count(breakdown.unrecognised)} carry no recognised type and are counted here rather than placed in a row above. ${count(breakdown.appRecorded)} of all records were recorded automatically; ${count(breakdown.adminLogged)} were logged by an admin working in the CRM.`}
          </p>
        )}

        {/*
          ⚠️ Said plainly, on screen, because "logged by an admin" is a claim
          about WHO WROTE THE ROW and a reader could easily take it as a claim
          about who acted. An admin recording a cash gift is logging something
          the member did.
        */}
        {breakdown && (
          <p className="text-xs text-muted-foreground" data-activity-origin-note>
            Recorded automatically means the row was written by check-in, a form,
            an event registration or a confirmed donation, so it traces something
            the person did. Logged by an admin means somebody typed it into the
            CRM, which may still describe something the person did.
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
