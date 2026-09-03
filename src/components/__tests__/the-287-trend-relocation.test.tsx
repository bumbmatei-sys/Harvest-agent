import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-287 — "the member growth trend was RELOCATED, not rebuilt", asserted as
 * OBJECT IDENTITY.
 *
 * ─── Why this file exists separately, and what it caught ─────────────────────
 *
 * 🔴 The rendered assertions in `the-287-dashboard-roster` could not see this.
 * They check the trend widget's state and its empty-state notes — and under
 * happy-dom recharts draws no axis text at all, because there is no layout
 * engine to compute ticks from, so there is nothing on screen to read the
 * plotted values off. A mutation that added 1 to every point on Growth left
 * every one of those assertions green. The guard was not guarding.
 *
 * ⚠️ So the claim is checked where it is actually made: at the prop. `TrendChart`
 * is mocked to record what it was handed, both tabs are rendered from ONE
 * `OverviewData`, and the members series must be the SAME OBJECT on both. That
 * is stronger than comparing values — a rebuild that happened to agree today
 * would still fail, which is the point of "do not rebuild it".
 *
 * 🔴 AND A RENDERED COMPARISON IS NOT AVAILABLE AS A SECOND OPINION, which was
 * checked rather than assumed. Recharts needs a MEASURED container before it
 * draws anything: under happy-dom the only `<path>` elements in a mounted
 * TrendChart are its lucide icon, identical for any data; and the Chromium
 * fixture in `the-287-roster-layout` serves static markup with no hydration, so
 * recharts never runs there at all. Reading the plotted numbers off the screen
 * would take a hydrated page in a real browser, which this repo deliberately
 * does not build (see `browser-measure.ts` on why not Playwright). The prop is
 * where the claim is checkable, so the prop is where it is checked.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { trendProps } = vi.hoisted(() => ({ trendProps: [] as Array<{ series: readonly unknown[] }> }));

vi.mock('../dashboard/TrendChart', () => ({
  TrendChart: (props: { series: readonly unknown[] }) => {
    trendProps.push(props);
    return <div data-mock-trend />;
  },
}));

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

const { GrowthTab } = await import('../dashboard/GrowthTab');
const { OverviewTab } = await import('../dashboard/OverviewTab');
const { bucketWeekly } = await import('../dashboard/dashboard-data');
const { toMemberRow } = await import('../dashboard/roster-data');
type OverviewData = import('../dashboard/useOverviewData').OverviewData;

const NOW = Date.UTC(2026, 8, 3);
const DAY = 24 * 60 * 60 * 1000;

/** Built the way `useOverviewData` builds it: one read, one bucketing. */
const MEMBER_ROWS = [
  { createdAt: new Date(NOW - 2 * DAY).toISOString(), country: 'Kenya', city: 'Nairobi' },
  { createdAt: new Date(NOW - 9 * DAY).toISOString(), country: 'Kenya', city: 'Mombasa' },
  { createdAt: new Date(NOW - 20 * DAY).toISOString(), country: 'Romania', city: 'Cluj' },
].map((r) => toMemberRow(r as Record<string, unknown>));

const MEMBER_SERIES = {
  kind: 'complete' as const,
  points: bucketWeekly(MEMBER_ROWS, NOW, (r) => r.createdAt).points,
};

const DATA = {
  loading: false,
  members: { kind: 'exact', value: 3 },
  contacts: { kind: 'exact', value: 0 },
  courses: { kind: 'exact', value: 0 },
  posts: { kind: 'exact', value: 0 },
  articles: { kind: 'exact', value: 0 },
  submissions: { kind: 'exact', value: 0 },
  seventh: { label: 'Receipts', figure: { kind: 'exact', value: 0 } },
  memberSeries: MEMBER_SERIES,
  givingSeries: { kind: 'complete', points: MEMBER_SERIES.points },
  submissionSeries: { kind: 'complete', points: MEMBER_SERIES.points },
  invoiceRows: [],
  invoiceReason: null,
  liveNow: { active: false, title: 'Live now' },
  roster: {
    countries: null, countriesReason: 'none',
    funnel: null, funnelReason: 'none',
    givers: null, giversReason: 'none',
  },
} as unknown as OverviewData;

let container: HTMLDivElement;
let root: Root | null = null;

async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}

beforeEach(() => { trendProps.length = 0; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container?.remove();
});

const membersSeriesOf = (props: { series: readonly unknown[] }) =>
  (props.series as Array<{ key: string; series: unknown }>).find((s) => s.key === 'members')!.series;

describe('the member growth trend renders on Growth with figures identical to Overview\'s', () => {
  it('Growth plots the members series, and it is the SAME object Overview plots', async () => {
    await render(<OverviewTab data={DATA} unreadCount={0} showInbox={false} />);
    expect(trendProps).toHaveLength(1);
    const fromOverview = membersSeriesOf(trendProps[0]);

    await act(async () => { root?.unmount(); });
    container.remove();
    await render(<GrowthTab data={DATA} />);
    expect(trendProps).toHaveLength(2);
    const fromGrowth = membersSeriesOf(trendProps[1]);

    /**
     * 🔴 `toBe`, not `toEqual`. The claim is that ONE read was bucketed ONCE and
     * handed to both tabs — not that two computations happen to agree. A second
     * read, a second `bucketWeekly` call, a `.map()` that copies the points, or
     * a rounding on either side all fail here, and every one of them is the
     * "rebuild" this ticket forbids.
     */
    expect(fromGrowth).toBe(fromOverview);
    expect(fromGrowth).toBe(DATA.memberSeries);
  });

  it('and the values really are the bucketed read, not a constant this test would accept', () => {
    // The vacuity guard: if the fixture's series were all zeros, identity would
    // still hold and would prove nothing about figures.
    const values = MEMBER_SERIES.points.map((p) => p.value);
    expect(values).toHaveLength(8);
    expect(values.reduce((a, b) => a + b, 0)).toBe(MEMBER_ROWS.length);
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('Growth plots members ALONE, while Overview still plots members beside giving', async () => {
    await render(<OverviewTab data={DATA} unreadCount={0} showInbox={false} />);
    expect((trendProps[0].series as Array<{ key: string }>).map((s) => s.key)).toEqual(['members', 'giving']);

    await act(async () => { root?.unmount(); });
    container.remove();
    await render(<GrowthTab data={DATA} />);
    // ⚠️ Relocation ADDED a widget; it did not take a series out of a chart
    // whose title promises both. Overview is unchanged, asserted above.
    expect((trendProps[1].series as Array<{ key: string }>).map((s) => s.key)).toEqual(['members']);
  });

  it('and both draw it in the same series colour, so the same data is not two colours', async () => {
    await render(<OverviewTab data={DATA} unreadCount={0} showInbox={false} />);
    await act(async () => { root?.unmount(); });
    container.remove();
    await render(<GrowthTab data={DATA} />);
    const varOf = (props: { series: readonly unknown[] }) =>
      (props.series as Array<{ key: string; chartVar: string }>).find((s) => s.key === 'members')!.chartVar;
    expect(varOf(trendProps[1])).toBe(varOf(trendProps[0]));
  });
});
