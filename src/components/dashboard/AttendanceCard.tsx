"use client";
/**
 * THE-294 — "Attendance & check-in": how many people have scanned in, across
 * every session this ministry has run.
 *
 * ─── The read needs no clever query ─────────────────────────────────────────
 *
 * `attendeeCount` is stored ON the session document, so the total is a sum over
 * a complete read of `tenants/{t}/checkinSessions` — one subcollection, no
 * `where`, no `orderBy`, no index. Counting the `attendees` subcollection under
 * each session would be exact but is one aggregation query PER SESSION, which
 * is unbounded fan-out from a dashboard read.
 *
 * ─── 🔴 AND THE FIELD BEING SUMMED CAN DRIFT SHORT ──────────────────────────
 *
 * `/api/checkin/submit` writes the attendee row and increments the counter as
 * TWO SEQUENTIAL AWAITS with no transaction:
 *
 *     await sessionRef.collection('attendees').add({ ... });
 *     await sessionRef.set({ attendeeCount: FieldValue.increment(1) }, { merge: true });
 *
 * A failure between them leaves a person recorded in `attendees` and never
 * counted. There is no reconciliation job, no decrement path and nothing that
 * ever recomputes the field, so the shortfall is PERMANENT.
 * `src/lib/checkin-session-delete.ts` carries the same warning at its own read
 * ("NOT A COUNT"), and #431 found it; this widget is the surface that sums the
 * field, so it names it here and says so on screen.
 *
 * ⚠️ THE DRIFT IS ONE-DIRECTIONAL AND BOUNDED. It can only ever be SHORT, never
 * over — an increment that never ran cannot inflate anything — and only by as
 * many check-ins as the second write failed on, which is bounded by the
 * failure rate of a single Firestore `set`. So it is small, and the honest
 * description of the number is a FLOOR: at least this many people checked in.
 *
 * 🔴 IT IS NOT "FIXED" HERE, and the choice is deliberate rather than deferred
 * by oversight. Making the counter correct is a transaction in a route this
 * ticket does not own; recomputing it from `attendees` is the fan-out above.
 * Reporting the floor is the honest option available to a read layer, and
 * saying "at least" is the difference between a number a founder can trust and
 * one they cannot.
 *
 * ─── 🔴 Aggregates only. Never an attendee ──────────────────────────────────
 *
 * A session's `attendees` subcollection holds a first name, last name, email and
 * `crmContactId` per person. NONE of it is read: `toSessionRow` reads
 * `attendeeCount` and nothing else, so no identifier reaches this component even
 * in memory and {@link AttendanceSummary} has no field that could hold one.
 * `AdminCheckin` is where the per-person list legitimately lives, behind
 * `manageCheckin`.
 */
import React from 'react';
import { QrCode } from 'lucide-react';

import { WidgetFrame, type WidgetState } from './WidgetFrame';
import { REASON, type AttendanceSummary } from './engagement-data';

const count = (n: number) => n.toLocaleString();

/** One figure and its label. No bar, no colour, nothing conveyed by shape alone. */
function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0" data-attendance-figure={label}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function AttendanceCard({ summary, reason }: {
  readonly summary: AttendanceSummary | null;
  readonly reason: string | null;
}) {
  const state: WidgetState = summary === null && reason === null
    ? { kind: 'loading' }
    : summary === null
      ? { kind: 'unavailable', reason: reason ?? REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="Attendance & check-in"
      description="Everyone who has scanned in, across every session."
      icon={QrCode}
      state={state}
      skeletonClassName="h-40 w-full"
    >
      <div className="space-y-3" data-attendance>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/*
            🔴 "At least" is in the FIGURE, not only in the footnote. A reader who
            never reaches the note below still gets the true claim, and a number
            that can only be short is a floor whether or not anyone scrolls.
          */}
          <Figure
            label="Check-ins recorded"
            value={summary ? `At least ${count(summary.checkIns)}` : ''}
          />
          <Figure
            label="Sessions"
            value={summary ? count(summary.sessions) : ''}
            note={summary && summary.empty > 0
              ? `${count(summary.empty)} with nobody checked in`
              : undefined}
          />
          <Figure
            label="Best attended session"
            value={summary ? `At least ${count(summary.busiest)}` : ''}
          />
        </div>

        {/*
          ⚠️ THE DRIFT, STATED. See the header for the mechanism. It is written
          out rather than left in a code comment because the number on screen is
          a floor and a founder comparing it against a door count deserves to
          know which direction the difference can run in.
        */}
        <p className="text-xs text-muted-foreground" data-attendance-drift>
          Each session stores its own running counter, and the check-in endpoint
          records the attendee and increments that counter as two separate
          writes. If the second one fails the attendee is still recorded and the
          counter stays one behind, permanently — nothing recomputes it. So these
          totals can only ever be short, never over, and they are shown as a
          floor for that reason.
        </p>
      </div>
    </WidgetFrame>
  );
}
