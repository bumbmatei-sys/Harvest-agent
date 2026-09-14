import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { formatCents } from '../../lib/donation-history';
import { CampaignProgress } from '../dashboard/CampaignProgress';
import { GivingMix } from '../dashboard/GivingMix';
import { GivingTab } from '../dashboard/GivingTab';
import { OverviewTab } from '../dashboard/OverviewTab';
import { PledgeFulfilment } from '../dashboard/PledgeFulfilment';
import { TrendChart } from '../dashboard/TrendChart';
import type { GivingData } from '../dashboard/useGivingData';
import type { OverviewData } from '../dashboard/useOverviewData';

/**
 * THE-362 - the dashboard's money units, and the 100x that came of one name.
 *
 * --- The founder's bug, stated exactly ---------------------------------------
 *
 * "In dashboard in all charts about giving/donations instead of 50$ donated it
 * shows 5000$." Exactly a hundredfold, which is the signature of cents drawn as
 * dollars. `useOverviewData` buckets the ledger by `amountCents`, so every point
 * of the giving series IS cents; `TrendChart` had no idea, and
 * `ChartTooltipContent` renders a bare `value.toLocaleString()`. A $50 gift
 * therefore printed as `5,000` on the Overview tab's "Giving & growth" chart,
 * on the Giving tab's "Giving over time" chart, and in the "Giving mix" pie's
 * slice tooltip - three renderers, one series, one missing unit.
 *
 * --- Why the fix is at the RENDERER and not at the source --------------------
 *
 * The obvious fix - divide once where the series is built - is the one that
 * cannot be taken, and the reason is a figure that was ALREADY CORRECT.
 * `InsightFeed`'s giving sentence converts the very same series itself and has
 * done since THE-328, which pins `$1,235` for 123456 cents. Converting at the
 * source would have turned that $50 into $0.50: the same bug inverted, planted
 * in the one place that never had it. So the series stays in cents end to end,
 * the FIELD carries its unit in its name (`givingSeriesCents`), and the single
 * conversion happens where a number becomes text, through `formatCents` - the
 * helper written for the inverse incident, where AdminAccounting summed cents
 * and formatted them as dollars to show $10,550,000 for $105,500.
 *
 * --- What these tests will and will not measure ------------------------------
 *
 * recharts DRAWS NOTHING under happy-dom (`ResponsiveContainer` measures a zero
 * box and emits no svg), a fact THE-290's suite records, so no assertion here
 * reads a plotted number out of a rendered chart. Instead each chart's own
 * rendering FUNCTIONS are pulled off the element tree it returns - the tooltip
 * formatter and the axis tick formatter that recharts would call - and invoked
 * with a $50 gift. That is the string a founder reads, produced by the shipped
 * code path rather than asserted about it.
 */

/** A $50 gift, in the unit the ledger stores it in. */
const FIFTY_DOLLARS_IN_CENTS = 5000;

/* ═══ element-tree helpers ═════════════════════════════════════════════════ */

type AnyEl = React.ReactElement<Record<string, unknown>>;

const isElement = (n: unknown): n is AnyEl =>
  typeof n === 'object' && n !== null && 'props' in (n as object) && 'type' in (n as object);

/** Every element in a returned tree for which `pick` is true, depth first. */
function findAll(node: unknown, pick: (el: AnyEl) => boolean, out: AnyEl[] = []): AnyEl[] {
  if (Array.isArray(node)) {
    for (const kid of node) findAll(kid, pick, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (pick(node)) out.push(node);
  const props = node.props as { children?: unknown } & Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    // `content` on a recharts Tooltip is an ELEMENT, not a child, and it is
    // exactly where the formatter lives - so every prop is walked, not just
    // `children`. A `children`-only walk found nothing and would have passed
    // this whole suite vacuously.
    if (key === 'children' || isElement(value) || Array.isArray(value)) findAll(value, pick, out);
  }
  return out;
}

const nameOf = (el: AnyEl): string => {
  const t = el.type as unknown as { displayName?: string; name?: string } | string;
  return typeof t === 'string' ? t : (t.displayName || t.name || '');
};

/** The `format` each `TrendChart` in a tab's tree was handed, by series key. */
function trendFormatters(tree: unknown): Map<string, ((v: number) => string) | undefined> {
  const out = new Map<string, ((v: number) => string) | undefined>();
  for (const chart of findAll(tree, (el) => el.type === TrendChart)) {
    const series = (chart.props as { series?: ReadonlyArray<Record<string, unknown>> }).series ?? [];
    for (const s of series) {
      out.set(String(s.key), s.format as ((v: number) => string) | undefined);
    }
  }
  return out;
}

/**
 * A tab's tree with every `TrendChart` element REPLACED BY ITS OUTPUT.
 *
 * A tab returns `<TrendChart series={...}/>` - an element, not a rendering. Its
 * axis and its tooltip do not exist until the function is called, so a walk over
 * the tab's own tree finds neither and every assertion built on it would pass
 * vacuously. This calls the shipped component with the props the shipped tab
 * gave it, which is the whole point: what is measured below is the chart the tab
 * actually configures.
 */
function renderedTrends(tree: unknown): unknown[] {
  const charts = findAll(tree, (el) => el.type === TrendChart);
  expect(charts.length, 'the tab renders no TrendChart at all').toBeGreaterThan(0);
  return charts.map((el) => TrendChart(el.props as Parameters<typeof TrendChart>[0]));
}

/**
 * The tooltip formatter a chart component would hand recharts, invoked.
 *
 * Returns the STRING a reader sees for `value` on series `key`, rendered from
 * the node the formatter returns - so a formatter that dropped the number
 * entirely, or printed it beside a stale one, is visible here.
 */
function tooltipText(tree: unknown, value: number, key: string): string {
  const tooltips = findAll(tree, (el) => nameOf(el).includes('Tooltip') && 'content' in el.props);
  expect(tooltips.length, 'no chart tooltip found in the tree - the walk went blind')
    .toBeGreaterThan(0);
  const content = tooltips[0].props.content as AnyEl;
  const formatter = (content.props as {
    formatter?: (v: unknown, n: unknown, i: unknown, idx: number, p: unknown) => React.ReactNode;
  }).formatter;
  expect(formatter, 'the tooltip has no formatter - it renders the raw value').toBeTypeOf('function');
  return renderToStaticMarkup(
    <>{formatter!(value, key, { value, name: key }, 0, {})}</>,
  ).replace(/<[^>]*>/g, '');
}

/** The Y-axis tick formatter, or `undefined` when the axis keeps plain numbers. */
function axisFormatter(tree: unknown): ((v: number) => string) | undefined {
  const axes = findAll(tree, (el) => nameOf(el) === 'YAxis');
  expect(axes.length, 'no YAxis in the tree').toBeGreaterThan(0);
  return (axes[0].props as { tickFormatter?: (v: number) => string }).tickFormatter;
}

/* ═══ fixtures ═════════════════════════════════════════════════════════════ */

/** Eight weeks, and the newest one holds a single $50 gift. */
const CENTS_POINTS = [
  { label: 'W1', value: 0 },
  { label: 'W2', value: 0 },
  { label: 'W3', value: 0 },
  { label: 'W4', value: 0 },
  { label: 'W5', value: 0 },
  { label: 'W6', value: 0 },
  { label: 'W7', value: 0 },
  { label: 'W8', value: FIFTY_DOLLARS_IN_CENTS },
];

const OVERVIEW = {
  loading: false,
  members: { kind: 'exact', value: 12 },
  contacts: { kind: 'exact', value: 30 },
  courses: { kind: 'exact', value: 2 },
  posts: { kind: 'exact', value: 5 },
  articles: { kind: 'exact', value: 1 },
  submissions: { kind: 'exact', value: 4 },
  seventh: { label: 'Receipts', figure: { kind: 'exact', value: 1 } },
  memberSeries: { kind: 'complete', points: [{ label: 'W8', value: 3 }] },
  givingSeriesCents: { kind: 'complete', points: CENTS_POINTS },
  submissionSeries: { kind: 'complete', points: [{ label: 'W8', value: 2 }] },
  invoiceRows: [
    { amountCents: FIFTY_DOLLARS_IN_CENTS, issuedAt: new Date('2024-03-04'), type: 'donation_receipt' },
  ],
  invoiceReason: null,
  liveNow: { active: false, title: 'Live now' },
} as unknown as OverviewData;

/**
 * Campaigns and pledges, in DOLLARS - the unit `giving-data.ts` names in every
 * one of its field names, and the unit these widgets must keep reading.
 */
const GIVING = {
  loading: false,
  campaignReason: null,
  pledgeReason: null,
  campaigns: {
    total: 1, active: 1, unnamed: 0, withoutGoal: 0,
    goalDollars: 100, raisedDollars: 50,
    rows: [{ id: 'c1', title: 'Roof fund', goalDollars: 100, raisedDollars: 50, isActive: true, percent: 50 }],
  },
  pledges: {
    pledges: 1, pledgedDollars: 100, paidDollars: 50, percent: 50,
    byStatus: [{ status: 'active', pledges: 1, pledgedDollars: 100, paidDollars: 50 }],
    overdue: 0, notOverdue: 1, undated: 0,
  },
} as unknown as GivingData;

const overviewTree = () => OverviewTab({ data: OVERVIEW, unreadCount: 0, showInbox: false });
const givingTree = () => GivingTab({ data: OVERVIEW, giving: GIVING });

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
const text = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/<[^>]*>/g, ' ');

/* ═══ 1 · a $50 gift renders as $50, named per chart ═══════════════════════ */

describe('1 - a $50 gift renders as $50 on every dashboard chart', () => {
  /**
   * THE MUTATION EACH OF THESE CATCHES, and it is the shipped bug: render the
   * series as dollars again - drop `format` at the call site, or stop using it
   * in the chart - and the figure goes back to `5,000`. Convert twice and it
   * becomes `$0.50`. Both fail here, in opposite directions.
   */

  it('the Overview tab’s "Giving & growth" chart says $50.00, not 5,000', () => {
    const shown = tooltipText(renderedTrends(overviewTree()), FIFTY_DOLLARS_IN_CENTS, 'giving');
    expect(shown, 'the Overview giving tooltip is not money').toContain('$50.00');
    expect(shown, 'the raw cents figure is still on screen').not.toMatch(/\b5,?000\b/);
    expect(shown, 'converted twice - a $50 gift became fifty cents').not.toContain('$0.50');
  });

  it('the Giving tab’s "Giving over time" chart says $50.00, not 5,000', () => {
    const shown = tooltipText(renderedTrends(givingTree()), FIFTY_DOLLARS_IN_CENTS, 'giving');
    expect(shown, 'the Giving tab tooltip is not money').toContain('$50.00');
    expect(shown, 'the raw cents figure is still on screen').not.toMatch(/\b5,?000\b/);
    expect(shown, 'converted twice - a $50 gift became fifty cents').not.toContain('$0.50');
  });

  it('the Overview tab’s "Giving mix" slice tooltip says $50.00, not 5,000', () => {
    // The pie's `dataKey` IS `cents`, so this tooltip was handed the rawest
    // possible figure - and the legend beneath it said `$50.00` for the same
    // slice. One widget, one receipt, two answers, 100x apart.
    const mix = GivingMix({ rows: OVERVIEW.invoiceRows, reason: null });
    const shown = tooltipText(mix, FIFTY_DOLLARS_IN_CENTS, 'donation_receipt');
    expect(shown, 'the mix slice tooltip is not money').toContain('$50.00');
    expect(shown, 'the raw cents figure is still on screen').not.toMatch(/\b5,?000\b/);
  });

  it('the "Giving mix" legend beneath it agrees, to the cent', () => {
    const rendered = text(GivingMix({ rows: OVERVIEW.invoiceRows, reason: null }) as React.ReactElement);
    expect(rendered).toContain('$50.00');
    expect(rendered, 'the legend and the tooltip must not disagree').not.toMatch(/\b5,?000\b/);
  });

  it('and both trend charts get their money string from the SAME helper', () => {
    // Not "both are right today" - both are the one function. Two call sites
    // that each formatted money their own way is how the two tabs would drift.
    const overview = trendFormatters(overviewTree()).get('giving');
    const giving = trendFormatters(givingTree()).get('giving');
    expect(overview, 'the Overview giving series carries no formatter').toBe(formatCents);
    expect(giving, 'the Giving tab series carries no formatter').toBe(formatCents);
    expect(overview).toBe(giving);
  });

  it('a COUNT on the same chart is still a count, not money', () => {
    // The fix must not turn everything into dollars: the member series shares
    // the Overview chart and is people, not money.
    expect(trendFormatters(overviewTree()).get('members')).toBeUndefined();
    const shown = tooltipText(renderedTrends(overviewTree()), 3, 'members');
    expect(shown).toContain('3');
    expect(shown, 'a member count is being rendered as money').not.toContain('$');
  });

  it('the Y axis takes the unit only where every series on it agrees', () => {
    /**
     * ONE AXIS SERVES EVERY SERIES. The Giving tab plots giving alone, so its
     * ticks can say dollars. Overview plots money against a member COUNT, and
     * there is no tick string honest for both - so that axis stays plain and
     * the unit is said in the tooltip, which is per-series.
     */
    const givingAxis = axisFormatter(renderedTrends(givingTree()));
    expect(givingAxis, 'the single-series money axis has no formatter').toBeTypeOf('function');
    expect(givingAxis!(FIFTY_DOLLARS_IN_CENTS)).toBe('$50.00');

    expect(
      axisFormatter(renderedTrends(overviewTree())),
      'the mixed count/money axis is labelling a member count as dollars',
    ).toBeUndefined();
  });
});

/* ═══ 2 · every money figure on every tab, enumerated with its unit ════════ */

describe('2 - every money figure on every dashboard tab is in the right unit', () => {
  /**
   * THE ENUMERATION. Five money figures exist on the dashboard and they are
   * listed here with the unit each is denominated in, so a sixth cannot be
   * added silently and a unit cannot change without this list changing.
   *
   * CENTS, from `tenants/{t}/invoices.amount`:
   *   1. Overview - "Giving & growth" trend, giving series
   *   2. Giving   - "Giving over time" trend (the SAME series object)
   *   3. Overview - "Giving mix" slice totals and their tooltip
   *
   * DOLLARS, from `campaigns` and `tenants/{t}/pledges`:
   *   4. Giving   - "Campaign progress" goal / raised
   *   5. Giving   - "Pledge fulfilment" pledged / paid
   *
   * The Growth, Engagement, Content and Retention tabs carry NO money figure at
   * all, which the last test in this block asserts rather than assumes.
   */
  const MONEY_FIGURES = [
    { tab: 'Overview', widget: 'Giving & growth', unit: 'cents' },
    { tab: 'Giving', widget: 'Giving over time', unit: 'cents' },
    { tab: 'Overview', widget: 'Giving mix', unit: 'cents' },
    { tab: 'Giving', widget: 'Campaign progress', unit: 'dollars' },
    { tab: 'Giving', widget: 'Pledge fulfilment', unit: 'dollars' },
  ] as const;

  it('the enumeration covers five figures, three in cents and two in dollars', () => {
    expect(MONEY_FIGURES).toHaveLength(5);
    expect(MONEY_FIGURES.filter((f) => f.unit === 'cents')).toHaveLength(3);
    expect(MONEY_FIGURES.filter((f) => f.unit === 'dollars')).toHaveLength(2);
  });

  it('every CENTS figure renders $50.00 for a 5000 input', () => {
    expect(tooltipText(renderedTrends(overviewTree()), 5000, 'giving')).toContain('$50.00');
    expect(tooltipText(renderedTrends(givingTree()), 5000, 'giving')).toContain('$50.00');
    expect(text(GivingMix({ rows: OVERVIEW.invoiceRows, reason: null }) as React.ReactElement))
      .toContain('$50.00');
  });

  it('every DOLLARS figure renders $50 for a 50 input - it must NOT divide', () => {
    const campaign = text(
      CampaignProgress({ breakdown: GIVING.campaigns, reason: null }) as React.ReactElement,
    );
    expect(campaign, 'the campaign figure was divided - 50 dollars became fifty cents')
      .not.toContain('$0.50');
    expect(campaign).toContain('$50');

    const pledge = text(
      PledgeFulfilment({ summary: GIVING.pledges, reason: null }) as React.ReactElement,
    );
    expect(pledge, 'the pledge figure was divided - 50 dollars became fifty cents')
      .not.toContain('$0.50');
    expect(pledge).toContain('$50');
  });

  it('the four other tabs carry no money at all', () => {
    for (const file of [
      'src/components/dashboard/GrowthTab.tsx',
      'src/components/dashboard/EngagementTab.tsx',
      'src/components/dashboard/ContentTab.tsx',
      'src/components/dashboard/growth-data.ts',
      'src/components/dashboard/engagement-data.ts',
      'src/components/dashboard/content-data.ts',
      'src/components/dashboard/retention-data.ts',
    ]) {
      const c = code(file);
      expect(c, `${file} formats a currency - it is not in the enumeration above`)
        .not.toMatch(/style:\s*'currency'|formatCents|amountCents/);
    }
  });
});

/* ═══ 3 · no cents value is turned into a string without formatCents ═══════ */

describe('3 - no money value is formatted without formatCents', () => {
  /**
   * THE SWEEP, and it is scoped to what it can honestly claim: every renderer
   * that handles a CENTS figure on the dashboard does its conversion through
   * `formatCents`, and none of them divides by 100 itself.
   *
   * REPORTED RATHER THAN SWEPT: `InsightFeed` converts the same series inline
   * with its own `Intl` options and `cents / 100`. It is CORRECT, it is pinned
   * by THE-328 (`$1,235` for 123456 cents), and rounding it to whole dollars is
   * deliberate copy - "$1,235 came in over the last seven days" is the
   * sentence. Routing it through `formatCents` would change a figure that was
   * already right, which is the one thing this ticket must not do, so it is
   * named here instead of exempted silently.
   */
  const CENTS_RENDERERS = [
    'src/components/dashboard/TrendChart.tsx',
    'src/components/dashboard/GivingMix.tsx',
    'src/components/dashboard/OverviewTab.tsx',
    'src/components/dashboard/GivingTab.tsx',
  ];

  it('every cents renderer imports formatCents, and none divides by 100 itself', () => {
    let usesHelper = 0;
    for (const file of CENTS_RENDERERS) {
      const c = code(file);
      expect(c, `${file} divides by 100 at a call site`).not.toMatch(/\/\s*100\b/);
      expect(c, `${file} calls toFixed on a raw figure`).not.toMatch(/toFixed\s*\(/);
      expect(c, `${file} builds its own currency formatter`)
        .not.toMatch(/style:\s*['"]currency['"]/);
      if (/\bformatCents\b/.test(c)) usesHelper += 1;
    }
    // Non-vacuity: the sweep must actually be finding the helper somewhere.
    expect(usesHelper, 'not one cents renderer references formatCents').toBeGreaterThanOrEqual(3);
  });

  it('`formatCents` is the AdminAccounting guard, and still divides exactly once', () => {
    expect(formatCents(5000)).toBe('$50.00');
    expect(formatCents(105500)).toBe('$1,055.00'); // NOT $10,550,000, and NOT $1,055.00 / 100
    expect(formatCents(0)).toBe('$0.00');
  });

  it('the one inline conversion left on the dashboard is InsightFeed’s, and it is correct', () => {
    // Named, not swept. If this ever stops being the ONLY one, the count moves
    // and this test says so rather than a sweep quietly covering a new hole.
    const files = [
      'src/components/dashboard/InsightFeed.tsx',
      ...CENTS_RENDERERS,
      'src/components/dashboard/CampaignProgress.tsx',
      'src/components/dashboard/PledgeFulfilment.tsx',
    ];
    const dividing = files.filter((f) => /\/\s*100\b/.test(code(f)));
    expect(dividing, 'a second inline cents conversion appeared on the dashboard')
      .toEqual(['src/components/dashboard/InsightFeed.tsx']);
  });
});

/* ═══ 4 · the unit is in the field name ═══════════════════════════════════ */

describe('4 - the unit is in the field name', () => {
  it('the series is `givingSeriesCents`, and `givingSeries` is gone from OverviewData', () => {
    /**
     * `giving-data.ts` names every dollar figure it produces `goalDollars`,
     * `raisedDollars`, `pledgedDollars`, `paidDollars` - "named so a later
     * caller cannot mistake the unit". The giving series was the one
     * money-bearing thing on the tab strip without a unit in its name, and two
     * charts duly mistook it.
     */
    const hook = code('src/components/dashboard/useOverviewData.ts');
    expect(hook).toMatch(/readonly givingSeriesCents: Series \| null;/);
    expect(hook, 'the un-united name came back').not.toMatch(/\bgivingSeries\b(?!Cents)/);

    // And both call sites read the new name.
    for (const tab of ['OverviewTab', 'GivingTab']) {
      expect(code(`src/components/dashboard/${tab}.tsx`), `${tab} reads the old name`)
        .toMatch(/data\.givingSeriesCents/);
    }
  });

  it('every money field on the giving read layer still says its unit', () => {
    const givingData = code('src/components/dashboard/giving-data.ts');
    for (const field of ['goalDollars', 'raisedDollars', 'pledgedDollars', 'paidDollars']) {
      expect(givingData, `${field} lost the unit from its name`).toContain(field);
    }
  });
});

/* ═══ 5 · no-regression: campaigns and pledges were already right ═════════ */

describe('5 - campaigns and pledges still read dollars', () => {
  /**
   * THE FIGURES THIS TICKET MUST NOT TOUCH. THE-290 established that
   * `campaigns.goal`/`raised` and `pledges.pledgeAmount`/`paidAmount` are
   * DOLLARS - the same $250 gift is `25000` on a receipt and `250` on a
   * campaign - and its own guard asserts these three files contain no `/ 100`
   * at all. A cents fix that reached them would be this ticket's bug, inverted.
   */
  it('the two dollar widgets and the read layer still divide by nothing', () => {
    for (const file of [
      'src/components/dashboard/giving-data.ts',
      'src/components/dashboard/CampaignProgress.tsx',
      'src/components/dashboard/PledgeFulfilment.tsx',
    ]) {
      const c = code(file);
      expect(c, `${file} divides by 100 - its figures are already dollars`).not.toMatch(/\/\s*100\b/);
      expect(c, `${file} names a cents field`).not.toMatch(/amountCents|amount_cents/);
      expect(c, `${file} now formats through formatCents - it would divide dollars`)
        .not.toMatch(/\bformatCents\b/);
    }
  });

  it('a $50 campaign still reads $50 and a $50 pledge still reads $50', () => {
    expect(text(CampaignProgress({ breakdown: GIVING.campaigns, reason: null }) as React.ReactElement))
      .toContain('$50');
    expect(text(PledgeFulfilment({ summary: GIVING.pledges, reason: null }) as React.ReactElement))
      .toContain('$50');
  });
});
