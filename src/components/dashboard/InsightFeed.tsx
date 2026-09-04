"use client";
/**
 * THE-276 — "What changed": the insight feed.
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
 * for an input that is `exact` or `complete`, and every line it emits carries
 * the `source` it was derived from — rendered under the line, so a reader can
 * see which read produced it. A feed with nothing to say renders `empty` rather
 * than filling itself with encouragement.
 */
import React from 'react';
import { Sparkles, TrendingDown, TrendingUp, Users } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '../ui/item';
import { REASON, deltaOf, type Figure, type Series } from './dashboard-data';
import { WidgetFrame, type WidgetState } from './WidgetFrame';

export interface Insight {
  readonly key: string;
  readonly headline: string;
  /** Where the number came from. Rendered — this is not a code comment. */
  readonly source: string;
  readonly direction: 'up' | 'down' | 'flat';
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The newest bucket of a series, or null when the series was refused. */
const latest = (series: Series | null): number | null =>
  series?.kind === 'complete' && series.points.length > 0 ? series.points[series.points.length - 1].value : null;

export interface InsightInputs {
  readonly memberSeries: Series | null;
  readonly givingSeries: Series | null;
  readonly contacts: Figure | null;
  readonly submissionsSeries: Series | null;
}

/**
 * Turn trustworthy reads into sentences.
 *
 * 🔴 Every branch below is guarded on `kind === 'complete'` / `'exact'` by way
 * of `latest()` and the explicit `kind` checks — there is no path that emits a
 * line from an `unavailable` input, and none that emits a line about a number
 * it did not receive. That is what "no widget fabricates a number" means here.
 */
export function buildInsights({ memberSeries, givingSeries, contacts, submissionsSeries }: InsightInputs): Insight[] {
  const out: Insight[] = [];

  const newMembers = latest(memberSeries);
  if (newMembers !== null) {
    const delta = memberSeries?.kind === 'complete' ? deltaOf(memberSeries.points) : null;
    out.push({
      key: 'members',
      headline:
        newMembers === 0
          ? 'No new members joined in the last seven days.'
          : `${plural(newMembers, 'member', 'members')} joined in the last seven days.`,
      source: 'users, counted by createdAt over a complete read',
      direction: delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
    });
  }

  const givingCents = latest(givingSeries);
  if (givingCents !== null) {
    const delta = givingSeries?.kind === 'complete' ? deltaOf(givingSeries.points) : null;
    const amount = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(givingCents / 100);
    out.push({
      key: 'giving',
      headline:
        givingCents === 0
          ? 'No receipts were issued in the last seven days.'
          : `${amount} was received in the last seven days.`,
      source: 'tenants/{id}/invoices, summed from amount (cents) over a complete read',
      direction: delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
    });
  }

  const newForms = latest(submissionsSeries);
  if (newForms !== null && newForms > 0) {
    out.push({
      key: 'submissions',
      headline: `${plural(newForms, 'form submission', 'form submissions')} arrived in the last seven days.`,
      source: 'tenants/{id}/forms/{id}/submissions, counted by submittedAt over a complete read',
      direction: 'up',
    });
  }

  if (contacts?.kind === 'exact') {
    out.push({
      key: 'contacts',
      headline: `${plural(contacts.value, 'contact is', 'contacts are')} on the CRM pipeline.`,
      source: 'contacts, getCountFromServer aggregation',
      direction: 'flat',
    });
  }

  return out;
}

const DIRECTION_ICON = { up: TrendingUp, down: TrendingDown, flat: Sparkles } as const;

export function InsightFeed({ inputs, loading }: { inputs: InsightInputs; loading: boolean }) {
  const insights = loading ? [] : buildInsights(inputs);
  const state: WidgetState = loading
    ? { kind: 'loading' }
    : insights.length === 0
      ? { kind: 'unavailable', reason: REASON.noSource('anything that changed this week') }
      : { kind: 'ready' };

  const headline = insights[0];

  return (
    <WidgetFrame
      title="What changed"
      description="Derived from this week's reads, never from an estimate."
      icon={Sparkles}
      state={state}
      skeletonClassName="h-40 w-full"
    >
      <div className="space-y-3">
        {headline && (
          <Alert data-insight-headline>
            <Users aria-hidden />
            <AlertTitle>{headline.headline}</AlertTitle>
            <AlertDescription>{headline.source}</AlertDescription>
          </Alert>
        )}
        <ItemGroup>
          {insights.slice(1).map((insight) => {
            const Icon = DIRECTION_ICON[insight.direction];
            return (
              <Item key={insight.key} size="sm" data-insight={insight.key}>
                <ItemMedia variant="icon">
                  <Icon aria-hidden />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="font-normal">{insight.headline}</ItemTitle>
                  <ItemDescription data-insight-source>{insight.source}</ItemDescription>
                </ItemContent>
              </Item>
            );
          })}
        </ItemGroup>
      </div>
    </WidgetFrame>
  );
}
