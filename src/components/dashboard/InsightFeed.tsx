"use client";
/**
 * THE-276 — "What changed": the insight feed.
 * THE-328 — what it says, and who it says it to.
 *
 * ─── Every line here is a sentence about a read, and carries it ──────────────
 *
 * An insight feed is where a dashboard is most tempted to invent. It reads as
 * prose, so a sentence with no number in it hides the fact that nothing was
 * measured, and a sentence with a number in it is trusted more than the chart
 * the number came from.
 *
 * So insights are BUILT, not written: {@link buildInsights} is a pure function
 * over the same `Figure`s and `Series` the cards use, it can only emit a line
 * for an input that is `complete`, and every line it emits carries the `source`
 * it was derived from. A feed with nothing to say says so, rather than filling
 * itself with encouragement.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE-328, DEFECT 1 — THE PROVENANCE WAS PRINTED AT A PASTOR.
 *
 * `source` was rendered under every line, as `AlertDescription` and
 * `ItemDescription`. It reads:
 *
 *     tenants/{id}/invoices, summed from amount (cents) over a complete read
 *
 * That is a Firestore path, a field name and a completeness claim — provenance
 * for a CODE REVIEWER, printed on a church's dashboard. The rule it encodes is
 * right and is untouched; SHOWING it was the defect.
 *
 * 🔵 `source` IS KEPT AS A FIELD AND IS NO LONGER RENDERED. The alternatives
 * were weighed and rejected:
 *
 *   • Moving it to a comment loses the one property that makes it a rule: a
 *     comment cannot be asserted, whereas a required field on every `Insight`
 *     means a new branch that emits a sentence without naming its read does not
 *     compile, and `the-276-dashboard-overview` already asserts every emitted
 *     insight carries one.
 *   • Putting it behind a `collapsible` disclosure was rejected on the ticket's
 *     own terms: a disclosure still renders the schema string to the same
 *     pastor, one tap away, and it would sit in the DOM for the sweep in
 *     THE-328's guard to find. The audience for `tenants/{id}/invoices` is a
 *     reviewer reading `buildInsights` — who is already in this file. A
 *     `tooltip` was rejected for the same reason plus being unreachable on a
 *     phone.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE-328, DEFECT 2 — THE PANEL RESTATED THE CARDS ABOVE IT.
 *
 * "2 members joined in the last seven days" is the Members KPI card's own
 * sparkline bucket, and that card ALSO carries a `+N% vs last week` badge. A
 * sentence that repeats a card adds nothing but length.
 *
 * ⚠️ WHAT IS ACTUALLY IN HAND, established before any sentence was written:
 * `useOverviewData` reads each series as {@link TREND_WEEKS} WEEKLY BUCKETS, so
 * the previous period is ALREADY READ. No comparison here adds a read — this
 * file issues none and imports no query builder.
 *
 * So a line is emitted only when the week has a SHAPE the card cannot show, and
 * {@link shapeOf} names the three:
 *
 *   • `drought` — this week is empty and so were the ones before it. A card
 *     showing `0` and `+0% vs last week` cannot say "for four weeks running",
 *     and an absence with a length is the thing a church can act on.
 *   • `firstIn` — something arrived after a run of empty weeks. The card's
 *     percentage is undefined against a zero week (`deltaOf` returns null), so
 *     this is precisely the case the badge goes BLANK for.
 *   • `highest` — more than in any week read. A sparkline implies it; nothing
 *     on the card states it.
 *
 * Anything else is a week that looks like the weeks around it, and this panel
 * says exactly that ({@link STEADY}) rather than restating a card.
 *
 * 🔴 THE CONTACTS INSIGHT IS GONE, AND THAT IS THE HONEST ANSWER, NOT A
 * SHORTFALL. `contacts` is a lone `getCountFromServer` figure with NO series
 * behind it, so there is no previous period to compare and no shape to find.
 * "2 contacts are on the CRM pipeline" was a verbatim restatement of the
 * Contacts card two inches above it. Adding a read to give it something to say
 * is the one thing this ticket forbids, so the line is dropped instead.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE-328, DEFECT 3 — A REFUSED READ LEFT NO TRACE.
 *
 * `buildInsights` skipped an `unavailable` input silently. With giving refused
 * and members fine, the feed rendered the members line and NOTHING about
 * giving — and when every input was refused it returned `[]`, which this
 * component turned into
 *
 *     "Nothing in this ministry's data records anything that changed this week."
 *
 * That sentence claims the DATA is empty when the truth is the READ FAILED.
 * It is the Silent-Failure Rule's quiet lie in its purest form: "no receipts
 * this week" and "we could not read receipts" are different sentences.
 *
 * 🔴 So a refused series now emits its own line, `tone: 'failure'`, rendered as
 * a destructive `alert` — role="alert", carried to a screen reader — with the
 * refusal REASON as its description. It carries no figure, and it is emitted
 * whether it is the only refusal or one of three.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE-328, DEFECT 4 — THE PANEL IMPLIED A MODEL THAT DOES NOT EXIST.
 *
 * The founder: "if it is no ai involved don't call ai". Nothing here calls a
 * model — every sentence below is a template branch over arithmetic. The
 * implication was carried entirely by the ICON: `Sparkles` on the panel header
 * and `Sparkles` again as the `flat` direction glyph on each row. A sparkle is
 * the industry's AI glyph and it is the only thing on this panel a reader could
 * have taken for one. Both are gone: the header takes `CalendarDays`, which is
 * what the panel actually measures — a seven-day window against the weeks
 * before it — and `flat` takes `Minus`.
 *
 * ⚠️ NOT TOUCHED, and deliberately: `AI Knowledge` and AI Chat are genuine
 * model-backed features and keep their names and their sparkles.
 */
import React from 'react';
import { CalendarDays, CircleAlert, Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '../ui/item';
import { REASON, deltaOf, type Series, type SeriesPoint } from './dashboard-data';
import { WidgetFrame, type WidgetState } from './WidgetFrame';

/**
 * A note about the week, or a read that did not complete.
 *
 * 🔴 `failure` is not a variant of `note` with sadder wording. A note carries a
 * figure and a claim about the ministry; a failure carries NEITHER and says
 * only that this app could not read something. Collapsing the two is exactly
 * the substitution the Silent-Failure Rule forbids.
 */
export type InsightTone = 'note' | 'failure';

export interface Insight {
  readonly key: string;
  readonly headline: string;
  /**
   * Where the number came from.
   *
   * 🔴 NOT RENDERED — THE-328. This is provenance for a reviewer reading this
   * function, and it is a required field rather than a comment so that a branch
   * emitting a sentence without naming its read cannot be written. The rule it
   * records — a figure ships only from an exact or provably complete read — is
   * unchanged and is still enforced by the `kind` guards below.
   */
  readonly source: string;
  readonly direction: 'up' | 'down' | 'flat';
  readonly tone: InsightTone;
  /** Why a read was refused. Rendered on a `failure` line — it is the point. */
  readonly detail?: string;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The newest bucket of a series, or null when the series was refused. */
const latest = (series: Series | null): number | null =>
  series?.kind === 'complete' && series.points.length > 0 ? series.points[series.points.length - 1].value : null;

export interface InsightInputs {
  readonly memberSeries: Series | null;
  readonly givingSeries: Series | null;
  readonly submissionsSeries: Series | null;
}

/**
 * What this week is, against the weeks already in hand.
 *
 * 🔴 EVERY BRANCH READS ONLY `points`, which the caller already holds. There is
 * no query here and no argument that could become one: a comparison this panel
 * cannot make from the buckets it was given is a comparison it does not make.
 */
export type WeekShape =
  /** This week is empty, and so were `weeks - 1` before it. Always ≥ 2. */
  | { readonly kind: 'drought'; readonly weeks: number }
  /** Something arrived after `weeks - 1` empty weeks. Always ≥ 2. */
  | { readonly kind: 'firstIn'; readonly weeks: number }
  /** More than in any of the `over` weeks read before it. Always ≥ 1. */
  | { readonly kind: 'highest'; readonly over: number };

export function shapeOf(points: readonly SeriesPoint[]): WeekShape | null {
  if (points.length === 0) return null;
  const current = points[points.length - 1].value;
  const earlier = points.slice(0, -1);

  /** How many of the weeks before this one were empty, newest first. */
  let quiet = 0;
  for (let i = earlier.length - 1; i >= 0 && earlier[i].value === 0; i -= 1) quiet += 1;

  if (current === 0) {
    // ⚠️ A single empty week is NOT a drought — it is one bucket of a sparkline
    // the card already draws. Only a run says something the card cannot.
    return quiet >= 1 ? { kind: 'drought', weeks: quiet + 1 } : null;
  }
  if (quiet >= 1) return { kind: 'firstIn', weeks: quiet + 1 };
  if (earlier.length > 0 && earlier.every((p) => p.value < current)) {
    return { kind: 'highest', over: earlier.length };
  }
  return null;
}

/** `more than in any of the previous N weeks`, with N = 1 written as English. */
const beatingEarlier = (over: number) =>
  over === 1 ? 'more than the week before' : `more than in any of the previous ${over} weeks`;

/**
 * One metric's sentences. Split out per metric rather than templated over a
 * noun, because "Nobody new has joined" and "No giving has been recorded" are
 * different sentences and a shared template would produce neither.
 */
interface MetricCopy {
  readonly key: string;
  readonly source: string;
  /** What a failure line says. Carries NO figure, by construction. */
  readonly refused: string;
  readonly say: (value: number, shape: WeekShape) => string;
}

const MEMBERS: MetricCopy = {
  key: 'members',
  source: 'users, counted by createdAt over a complete read',
  refused: 'New members could not be read for the last seven days.',
  say: (value, shape) => {
    switch (shape.kind) {
      case 'drought':
        return `Nobody new has joined for ${shape.weeks} weeks running.`;
      case 'firstIn':
        return `${plural(value, 'member', 'members')} joined in the last seven days — the first in ${shape.weeks} weeks.`;
      case 'highest':
        return `${plural(value, 'member', 'members')} joined in the last seven days — ${beatingEarlier(shape.over)}.`;
    }
  },
};

const GIVING: MetricCopy = {
  key: 'giving',
  source: 'tenants/{id}/invoices, summed from amount (cents) over a complete read',
  refused: 'Giving could not be read for the last seven days.',
  say: (cents, shape) => {
    const amount = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(cents / 100);
    switch (shape.kind) {
      case 'drought':
        return `Nobody has given for ${shape.weeks} weeks running.`;
      case 'firstIn':
        return `${amount} came in over the last seven days — the first giving in ${shape.weeks} weeks.`;
      case 'highest':
        return `${amount} came in over the last seven days — ${beatingEarlier(shape.over)}.`;
    }
  },
};

const SUBMISSIONS: MetricCopy = {
  key: 'submissions',
  source: 'tenants/{id}/forms/{id}/submissions, counted by submittedAt over a complete read',
  refused: 'Form submissions could not be read for the last seven days.',
  say: (value, shape) => {
    switch (shape.kind) {
      case 'drought':
        return `No form submissions have arrived for ${shape.weeks} weeks running.`;
      case 'firstIn':
        return `${plural(value, 'form submission', 'form submissions')} arrived in the last seven days — the first in ${shape.weeks} weeks.`;
      case 'highest':
        return `${plural(value, 'form submission', 'form submissions')} arrived in the last seven days — ${beatingEarlier(shape.over)}.`;
    }
  },
};

/**
 * What the panel says when every read landed and no week had a shape.
 *
 * 🔴 THIS IS NOT AN EMPTY STATE AND MUST NEVER BE REACHED BY A FAILED READ. It
 * is a positive claim — the weeks are alike — and it is only ever rendered when
 * at least one series came back `complete` and none came back refused.
 */
export const STEADY = 'The last seven days look much like the weeks before them.';

/**
 * Turn trustworthy reads into sentences.
 *
 * 🔴 Every note below is guarded on `kind === 'complete'` by way of `latest()`,
 * so there is no path that emits a FIGURE from a refused input. A refused input
 * takes the other path and emits a line that carries no figure at all.
 */
export function buildInsights({ memberSeries, givingSeries, submissionsSeries }: InsightInputs): Insight[] {
  const out: Insight[] = [];

  for (const [metric, series] of [
    [MEMBERS, memberSeries],
    [GIVING, givingSeries],
    [SUBMISSIONS, submissionsSeries],
  ] as const) {
    if (series?.kind === 'unavailable') {
      out.push({
        key: `${metric.key}-unread`,
        headline: metric.refused,
        detail: series.reason,
        source: metric.source,
        direction: 'flat',
        tone: 'failure',
      });
      continue;
    }

    const value = latest(series);
    if (value === null) continue;
    const shape = shapeOf(series?.kind === 'complete' ? series.points : []);
    if (shape === null) continue;

    const delta = series?.kind === 'complete' ? deltaOf(series.points) : null;
    out.push({
      key: metric.key,
      headline: metric.say(value, shape),
      source: metric.source,
      direction: delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
      tone: 'note',
    });
  }

  return out;
}

const DIRECTION_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

export function InsightFeed({ inputs, loading }: { inputs: InsightInputs; loading: boolean }) {
  const insights = loading ? [] : buildInsights(inputs);
  const failures = insights.filter((i) => i.tone === 'failure');
  const notes = insights.filter((i) => i.tone === 'note');

  /**
   * 🔴 THE ONLY `unavailable` CASE IS "NO READ WAS SUPPLIED AT ALL". A read that
   * was ATTEMPTED and refused renders as a failure LINE, above, so it is
   * visible next to whatever else did land; a read that never happened has no
   * line to carry and is the frame's own empty state. Neither is ever `STEADY`.
   */
  const supplied = [inputs.memberSeries, inputs.givingSeries, inputs.submissionsSeries]
    .filter((s) => s !== null);
  const state: WidgetState = loading
    ? { kind: 'loading' }
    : supplied.length === 0
      ? { kind: 'unavailable', reason: REASON.readFailed }
      : { kind: 'ready' };

  return (
    <WidgetFrame
      title="What changed"
      description="The last seven days, against the weeks before them."
      icon={CalendarDays}
      state={state}
      skeletonClassName="h-40 w-full"
    >
      <div className="space-y-3">
        {failures.map((failure) => (
          <Alert key={failure.key} variant="destructive" data-insight-failure={failure.key}>
            <CircleAlert aria-hidden />
            <AlertTitle>{failure.headline}</AlertTitle>
            {failure.detail && <AlertDescription>{failure.detail}</AlertDescription>}
          </Alert>
        ))}
        {(notes.length > 0 || failures.length === 0) && (
          <ItemGroup>
            {notes.map((insight) => {
              const Icon = DIRECTION_ICON[insight.direction];
              return (
                <Item key={insight.key} size="sm" data-insight={insight.key}>
                  <ItemMedia variant="icon">
                    <Icon aria-hidden />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="font-normal">{insight.headline}</ItemTitle>
                  </ItemContent>
                </Item>
              );
            })}
            {notes.length === 0 && (
              <Item size="sm" data-insight="steady">
                <ItemMedia variant="icon">
                  <Minus aria-hidden />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="font-normal">{STEADY}</ItemTitle>
                </ItemContent>
              </Item>
            )}
          </ItemGroup>
        )}
      </div>
    </WidgetFrame>
  );
}
