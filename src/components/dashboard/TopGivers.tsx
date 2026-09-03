"use client";
/**
 * THE-287 — the top givers leaderboard.
 *
 * ─── 🔴 Sorted by `Array.sort`, never by a Firestore `orderBy` ───────────────
 *
 * The rows arrive as a COMPLETE set of `contacts` — `completeRead` took the
 * exact count first and refused above the ceiling — so ranking them in memory
 * is exact, and slicing the top ten off the end cannot change who is in it.
 *
 * An `orderBy('totalDonated', 'desc').limit(10)` would render identically and
 * would be neither exact nor complete: `contacts` carries no composite index
 * for it, `firestore.indexes.json` is not deployed by `deploy-rules.yml` (its
 * `paths:` filter does not even include the file), so the query would throw
 * `failed-precondition` in production — and if it somehow ran, a `limit` over
 * an unordered scan is the arbitrary sample THE-276 exists to have removed.
 *
 * ─── ⚠️ DOLLARS. Not cents. ──────────────────────────────────────────────────
 *
 * `contacts.totalDonated` is stored in DOLLARS — the donation webhook converts
 * Stripe's cent amounts before they reach it, and `CHAMPION_THRESHOLD_DOLLARS`
 * is 10000 meaning $10,000. `invoices.amount` is CENTS and `GivingMix` divides
 * it by 100. This widget divides by nothing and touches no invoice: the two
 * units never meet in one figure. AdminAccounting shipped that inversion once
 * and rendered $105,500 as $10,550,000.
 */
import React from 'react';
import { Trophy } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { GIVING_STAGES, type TopGiver } from './roster-data';
import { WidgetFrame, type WidgetState } from './WidgetFrame';

/**
 * 🔴 No `/ 100`, by construction and by test. The value is already dollars.
 */
const dollars = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const STAGE_LABEL = new Map(GIVING_STAGES.map((s) => [s.key, s.label]));

export function TopGivers({ givers, reason }: {
  readonly givers: readonly TopGiver[] | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = givers === null && reason === null
    ? { kind: 'loading' }
    : givers === null || reason !== null
      ? { kind: 'unavailable', reason: reason ?? '' }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Top givers"
      description="The largest recorded totals, ranked across every contact."
      icon={Trophy}
      state={state}
      skeletonClassName="h-56 w-full"
    >
      {/* Same `overflow-x-auto` container as the countries table, from the
          primitive: three columns scroll inside the card at 380px. */}
      <Table data-top-givers>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 text-right">#</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead className="text-right">Given</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(givers ?? []).map((giver, i) => (
            <TableRow key={giver.id} data-giver-row={giver.id}>
              <TableCell className="text-right tabular-nums text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-medium text-foreground">{giver.name}</TableCell>
              <TableCell>
                <Badge variant="secondary">{STAGE_LABEL.get(giver.stage) ?? giver.stage}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums" data-giver-dollars={giver.dollars}>
                {dollars(giver.dollars)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </WidgetFrame>
  );
}
