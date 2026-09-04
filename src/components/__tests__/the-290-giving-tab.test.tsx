import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-290 — the Giving tab (slice 3 of 6): the ledger read.
 *
 * ─── What these tests defend ─────────────────────────────────────────────────
 *
 * Everything THE-276's and THE-283's do, plus the four properties that are
 * specific to a tab where every widget is money:
 *
 *   🔴 NO COERCION, EVER. #421 caught silent money loss in its own code:
 *   `toInvoiceRow` turned a missing `amount` into `0`, so one unreadable gift
 *   made the giving total quietly short by exactly that gift with no symptom on
 *   screen. Section 3 is the largest here because it is the whole ticket — a
 *   missing, non-numeric or non-finite amount must REFUSE and be COUNTED on
 *   every one of the three collections this tab touches.
 *
 *   🔴 THREE UNITS MEET HERE AND NONE OF THEM MIXES. `invoices.amount` is CENTS;
 *   `campaigns.goal`/`raised` and `pledges.pledgeAmount`/`paidAmount` are
 *   DOLLARS; `contacts.totalDonated` is DOLLARS and is not read at all. The same
 *   $250 gift is `25000` on a receipt and `250` on a campaign, so a stray
 *   `/ 100` or a missing one is a hundredfold error on a church's screen.
 *
 *   🔴 `campaigns.raised` IS READ, NEVER RECOMPUTED. It is webhook-maintained
 *   and authoritative. Section 6 gives the widget a ledger that disagrees with
 *   it and asserts the document's own figure is what renders.
 *
 *   🔴 THE RELOCATION IS AN IDENTITY, NOT A COPY. Section 1 asserts that the
 *   `Series` object the Giving tab plots IS the object the Overview tab plots —
 *   not an equal one — so no arithmetic exists that could make the two tabs
 *   disagree about how much a ministry received.
 *
 * ⚠️ recharts DRAWS NOTHING under happy-dom: `ResponsiveContainer` measures a
 * zero box and emits no svg. So no assertion here reads a plotted value out of
 * the DOM. Series identity is asserted on the React element tree (section 1),
 * series configuration through `<ChartStyle>`'s generated `--color-<key>` custom
 * properties, and every money figure through the text the widget renders. A
 * `toContain('Received')` would have passed on a widget DESCRIPTION — #429 found
 * exactly that in its own first draft.
 *
 * ⚠️ The mock is THE-276's query RECORDER, carried over unchanged in shape, so
 * "the count came from an aggregation" and "no `orderBy` was issued" are
 * assertions rather than hopes.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BuiltQuery = {
  path: string[];
  where: Array<[string, string, unknown]>;
  limit: number | null;
  orderBy: Array<[string, string]>;
};

const { built, counts, docsFor, authState, docReads } = vi.hoisted(() => ({
  built: [] as BuiltQuery[],
  counts: new Map<string, number | Error>(),
  docsFor: new Map<string, Array<Record<string, unknown>>>(),
  docReads: new Map<string, Record<string, unknown> | null>(),
  authState: { currentUser: null as { uid: string; email: string; displayName?: string } | null },
}));

const keyOf = (q: BuiltQuery) => q.path.join('/');

vi.mock('../../firebase', () => ({
  db: {},
  get auth() { return authState; },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments }),
  where: (field: string, op: string, value: unknown) => ({ __where: [field, op, value] as [string, string, unknown] }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: string, dir: string) => ({ __orderBy: [field, dir] as [string, string] }),
  doc: (_db: unknown, ...segments: string[]) => ({ __doc: segments.join('/') }),
  query: (base: { __path: string[] }, ...constraints: Array<Record<string, unknown>>) => {
    const q: BuiltQuery = {
      path: base.__path,
      where: constraints.filter((c) => '__where' in c).map((c) => c.__where as [string, string, unknown]),
      limit: (constraints.find((c) => '__limit' in c)?.__limit as number) ?? null,
      orderBy: constraints.filter((c) => '__orderBy' in c).map((c) => c.__orderBy as [string, string]),
    };
    built.push(q);
    return q;
  },
  getCountFromServer: async (q: BuiltQuery) => {
    const answer = counts.get(keyOf(q));
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error(`no count configured for ${keyOf(q)}`);
    return { data: () => ({ count: answer }) };
  },
  getDocs: async (q: BuiltQuery) => {
    const rows = docsFor.get(keyOf(q)) ?? [];
    return { docs: rows.map((data, i) => ({ id: `${keyOf(q)}-${i}`, data: () => data })) };
  },
  getDoc: async (ref: { __doc: string }) => {
    const data = docReads.get(ref.__doc) ?? null;
    return { exists: () => data !== null, data: () => data ?? undefined };
  },
}));

const AdminDashboardHome = (await import('../AdminDashboardHome')).default;
const { GivingTab } = await import('../dashboard/GivingTab');
const { OverviewTab } = await import('../dashboard/OverviewTab');
const { TrendChart } = await import('../dashboard/TrendChart');
const {
  GIVING_REASON,
  aggregateCampaigns,
  readableCampaigns,
  readablePledges,
  summarisePledges,
  toCampaignRow,
  toPledgeRow,
} = await import('../dashboard/giving-data');
const {
  DASHBOARD_FETCH_LIMIT, bucketWeekly, readableReceipts, toInvoiceRow,
} = await import('../dashboard/dashboard-data');
import type { GivingData } from '../dashboard/useGivingData';
import type { OverviewData } from '../dashboard/useOverviewData';

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve(); });
}

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  await settle();
  return container;
}

async function openTab(scope: ParentNode, label: string): Promise<void> {
  const trigger = [...scope.querySelectorAll('[data-slot="tabs-trigger"]')]
    .find((t) => (t.textContent ?? '').trim() === label) as HTMLElement | undefined;
  if (!trigger) throw new Error(`no tab trigger labelled ${label}`);
  await act(async () => { trigger.click(); });
  await settle();
}

const screen = () =>
  mount(<AdminDashboardHome tenantId="grace" tenantName="Grace Chapel" isSuperAdmin={false} unreadCount={0} onNavigate={() => {}} />);

/** Mount, then select Giving and let its own two reads land. */
async function givingScreen(): Promise<HTMLDivElement> {
  const c = await screen();
  await openTab(c, 'Giving');
  return c;
}

const text = (el: ParentNode | null) => el?.textContent ?? '';
const widget = (c: ParentNode, title: string) => c.querySelector(`[data-widget="${title}"]`);
const reasonOf = (c: ParentNode, title: string) =>
  text(c.querySelector(`[data-widget="${title}"] [data-empty-reason]`));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function grantAnalytics() {
  authState.currentUser = { uid: 'u1', email: 'pastor@grace.org', displayName: 'Ada Grace' };
  docReads.set('users/u1', { role: 'admin', permissions: { analytics: true }, tenantId: 'grace' });
}

/* ── Fixtures, as this app actually writes the documents ──────────────────── */

/**
 * Receipts. 🔴 `amount` is CENTS and `issuedAt` is an ISO STRING on the webhook
 * path — `donation-webhook.ts` writes `issuedAt: nowIso` — so this fixture
 * deliberately mixes strings and Timestamp-likes to exercise the reason
 * `orderBy('issuedAt')` may never be issued.
 */
const RECEIPTS: Array<Record<string, unknown>> = [
  { amount: 25000, type: 'donation_receipt', issuedAt: new Date(NOW - 2 * DAY).toISOString() },
  { amount: 100000, type: 'donation_receipt', issuedAt: new Date(NOW - 9 * DAY).toISOString() },
  // A Timestamp-like, the other writer's shape. Firestore would sort every
  // string above this one; the complete read makes that irrelevant.
  { amount: 5000, type: 'event_ticket', issuedAt: { seconds: Math.floor((NOW - 3 * DAY) / 1000) } },
];

/**
 * Campaigns. 🔴 The field is `title`, not `name`, and `goal`/`raised` are
 * DOLLARS. The set covers every case the widget has to be honest about: a
 * normal active campaign, one past its goal, one with no goal at all, and one
 * with no readable title.
 */
const CAMPAIGNS: Array<Record<string, unknown>> = [
  { title: 'Roof fund', goal: 20000, raised: 5000, isActive: true, tenantId: 'grace', campaignType: 'fundraising' },
  { title: 'Youth camp', goal: 4000, raised: 6000, isActive: false, tenantId: 'grace', campaignType: 'pledge' },
  { title: 'Benevolence', goal: 0, raised: 1250, isActive: false, tenantId: 'grace' },
  { goal: 1000, raised: 100, isActive: false, tenantId: 'grace' },
];

/**
 * Pledges. 🔴 `pledgeAmount` and `paidAmount` are DOLLARS.
 *
 * ⚠️ Every row carries `donorName`, `donorEmail`, `donorPhone` and `notes`
 * ALONGSIDE its money, which is what makes the privacy assertion meaningful:
 * the identifying fields are genuinely present in the documents the widget
 * reads, so a widget that rendered one would be caught rather than un-tested.
 */
const PLEDGES: Array<Record<string, unknown>> = [
  { donorName: 'Ada Lovelace', donorEmail: 'ada@grace.org', donorPhone: '+254700000001', notes: 'gift aid', pledgeAmount: 1200, paidAmount: 1200, status: 'fulfilled', dueDate: new Date(NOW - 30 * DAY).toISOString(), campaignId: 'c1' },
  { donorName: 'Grace Hopper', donorEmail: 'grace@grace.org', notes: '', pledgeAmount: 600, paidAmount: 150, status: 'active', dueDate: new Date(NOW - 2 * DAY).toISOString(), campaignId: 'c1' },
  { donorName: 'Alan Turing', donorEmail: 'alan@grace.org', notes: '', pledgeAmount: 400, paidAmount: 0, status: 'active', dueDate: new Date(NOW + 20 * DAY).toISOString(), campaignId: 'c1' },
  // No due date recorded. 🔴 Counted as undated, NEVER as overdue.
  { donorName: 'Margaret Hamilton', donorEmail: 'margaret@grace.org', notes: '', pledgeAmount: 300, paidAmount: 100, status: 'lapsed', dueDate: null, campaignId: 'c1' },
];

/** Every identifying string in the pledge fixtures, for the privacy sweep. */
const PLEDGE_IDENTIFIERS = PLEDGES.flatMap((p) =>
  [p.donorName, p.donorEmail, p.donorPhone].filter((v): v is string => typeof v === 'string'),
);

function healthyTenant() {
  counts.set('users', 8);
  counts.set('contacts', 42);
  counts.set('courses', 2);
  counts.set('community_posts', 7);
  counts.set('blog_posts', 4);
  counts.set('submissions', 1);
  counts.set('tenants/grace/invoices', RECEIPTS.length);
  counts.set('campaigns', CAMPAIGNS.length);
  counts.set('tenants/grace/pledges', PLEDGES.length);

  docsFor.set('users', [{ createdAt: NOW - 2 * DAY, country: 'Kenya', city: 'Nairobi' }]);
  docsFor.set('submissions', [{ createdAt: NOW - DAY }]);
  docsFor.set('tenants/grace/invoices', RECEIPTS);
  docsFor.set('campaigns', CAMPAIGNS);
  docsFor.set('tenants/grace/pledges', PLEDGES);
  docReads.set('tenants/grace/livestream/current', { active: false, title: 'Live now' });
}

beforeEach(() => {
  built.length = 0;
  counts.clear();
  docsFor.clear();
  docReads.clear();
  authState.currentUser = null;
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container?.remove();
});

/* ═══ 1 · 🔴 Giving over time is RELOCATED, not rebuilt ══════════════════════ */

/**
 * Walk a React element tree and collect the props of every `TrendChart` in it.
 *
 * ⚠️ THE ELEMENT TREE, not the DOM, and that is the point: recharts renders
 * nothing under happy-dom, so the plotted values are not observable there. What
 * IS observable — and is a strictly stronger claim than equal numbers — is that
 * the two tabs hand `TrendChart` the SAME `Series` OBJECT. Object identity
 * cannot drift; two equal arrays computed twice can.
 */
function trendPropsIn(node: React.ReactNode): Array<React.ComponentProps<typeof TrendChart>> {
  const found: Array<React.ComponentProps<typeof TrendChart>> = [];
  const visit = (n: React.ReactNode): void => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!React.isValidElement(n)) return;
    const el = n as React.ReactElement<{ children?: React.ReactNode }>;
    if (el.type === TrendChart) found.push(el.props as React.ComponentProps<typeof TrendChart>);
    visit(el.props.children);
  };
  visit(node);
  return found;
}

/** One `OverviewData`, shared by both tabs, exactly as `AnalyticsDashboard` shares it. */
function overviewDataFixture(): OverviewData {
  const money = readableReceipts(RECEIPTS.map(toInvoiceRow));
  if (money.kind !== 'complete') throw new Error('fixture ledger is unreadable');
  const points = bucketWeekly(money.rows, NOW, (r) => r.issuedAt, (r) => r.amountCents).points;
  return {
    loading: false,
    members: { kind: 'exact', value: 8 },
    contacts: { kind: 'exact', value: 42 },
    courses: { kind: 'exact', value: 2 },
    posts: { kind: 'exact', value: 7 },
    articles: { kind: 'exact', value: 4 },
    submissions: { kind: 'exact', value: 1 },
    seventh: { label: 'Receipts', figure: { kind: 'exact', value: RECEIPTS.length } },
    memberSeries: { kind: 'complete', points: [{ label: 'W1', value: 1 }] },
    givingSeries: { kind: 'complete', points },
    submissionSeries: { kind: 'complete', points: [{ label: 'W1', value: 1 }] },
    invoiceRows: money.rows,
    invoiceReason: null,
    liveNow: { active: false, title: 'Live now' },
  } as OverviewData;
}

const EMPTY_GIVING: GivingData = {
  loading: false,
  campaigns: null, campaignReason: GIVING_REASON.noCampaigns,
  pledges: null, pledgeReason: GIVING_REASON.noPledges,
};

describe('giving over time renders on Giving with figures identical to Overview\'s', () => {
  it('🔴 both tabs plot the SAME Series object — not an equal one, the same one', () => {
    const data = overviewDataFixture();

    const overviewTrends = trendPropsIn(
      OverviewTab({ data, unreadCount: 0, showInbox: false }) as React.ReactNode,
    );
    const givingTrends = trendPropsIn(
      GivingTab({ data, giving: EMPTY_GIVING }) as React.ReactNode,
    );

    const overviewGiving = overviewTrends.flatMap((p) => p.series).find((s) => s.key === 'giving');
    const givingGiving = givingTrends.flatMap((p) => p.series).find((s) => s.key === 'giving');

    expect(overviewGiving, 'the Overview tab stopped plotting giving').toBeTruthy();
    expect(givingGiving, 'the Giving tab does not plot giving').toBeTruthy();

    // 🔴 THE ASSERTION. Reference identity, so there is no arithmetic, no map
    // and no copy anywhere between the two tabs that could make them differ.
    expect(givingGiving!.series).toBe(data.givingSeries);
    expect(givingGiving!.series).toBe(overviewGiving!.series);
    // And the same series slot, so the colour does not change under a reader
    // who moves between the tabs.
    expect(givingGiving!.chartVar).toBe(overviewGiving!.chartVar);
  });

  it('and it is CENTS on both, passed through with no transformation', () => {
    const data = overviewDataFixture();
    const giving = trendPropsIn(GivingTab({ data, giving: EMPTY_GIVING }) as React.ReactNode)
      .flatMap((p) => p.series).find((s) => s.key === 'giving')!;

    const plotted = giving.series?.kind === 'complete' ? giving.series.points : [];
    const total = plotted.reduce((sum, p) => sum + p.value, 0);
    // The three fixture receipts total 130,000 CENTS. 🔴 Not 1,300 — a `/ 100`
    // between the tabs is exactly the mixing this ticket forbids, and it would
    // also have made the two tabs render one series differently.
    expect(total).toBe(25000 + 100000 + 5000);
  });

  it('renders it under its own heading on the Giving tab, in its ready state', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const trend = widget(c, 'Giving over time');
    expect(trend, 'the giving trend did not render on the Giving tab').toBeTruthy();
    expect(trend!.getAttribute('data-state')).toBe('ready');
    expect(text(trend!)).toContain('Every receipt on the ledger over the last eight weeks');

    /*
     * ⚠️ The SERIES is asserted through the chart primitive's generated custom
     * properties, not through rendered prose — see the file header. One series
     * on this tab: the giving line, and no member line beside it.
     */
    const style = text(trend!.querySelector('[data-chart]'));
    expect(style).toContain('--color-giving:');
    expect(style).not.toContain('--color-members:');
  });

  it('🔴 and the Giving tab issues NO ledger read of its own — the relocation is free', async () => {
    grantAnalytics();
    healthyTenant();

    const c = await screen();
    /*
     * `useOverviewData` builds three ledger queries and they are all accounted
     * for: the "Receipts" KPI card's `getCountFromServer`, then `completeRead`'s
     * own count and its bounded `getDocs` for the series and the mix. Measured
     * rather than asserted as a literal, because what matters is the DELTA.
     */
    const beforeGiving = built.filter((q) => keyOf(q) === 'tenants/grace/invoices').length;
    expect(beforeGiving).toBe(3);

    await openTab(c, 'Giving');

    // 🔴 THE ASSERTION. Opening Giving adds not one ledger query: the trend is
    // handed the series the Overview hook already read. A fourth would be the
    // rebuild this ticket forbids — and the second chance to disagree.
    const afterGiving = built.filter((q) => keyOf(q) === 'tenants/grace/invoices').length;
    expect(afterGiving).toBe(beforeGiving);

    // And the tab's own two reads DID fire, so the tab is genuinely mounted:
    // one count plus one bounded fetch for each of campaigns and pledges.
    expect(built.filter((q) => keyOf(q) === 'campaigns')).toHaveLength(2);
    expect(built.filter((q) => keyOf(q) === 'tenants/grace/pledges')).toHaveLength(2);
  });
});

/* ═══ 2 · Overview's remaining widgets and empty states are unchanged ═══════ */

describe("Overview's remaining widgets and empty states are unchanged", () => {
  it('the giving & growth trend still plots BOTH series under its own title', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const trend = widget(c, 'Giving & growth');
    expect(trend, 'the Overview trend lost its title').toBeTruthy();
    expect(trend!.getAttribute('data-state')).toBe('ready');
    expect(text(trend!)).toContain('The last eight weeks, by week.');

    // 🔴 The relocation did NOT strip giving from Overview. #429 did not remove
    // the member line when it put the member trend on Growth, and this slice
    // follows it: one read serves both tabs, so both may plot it.
    const style = text(trend!.querySelector('[data-chart]'));
    expect(style).toContain('--color-members:');
    expect(style).toContain('--color-giving:');
  });

  it('every Overview widget is still in exactly one of its honest states', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    expect([...c.querySelectorAll('[data-kpi]')]).toHaveLength(7);
    for (const title of ['Giving & growth', 'What changed', 'Giving mix', 'Devotion funnel']) {
      const el = widget(c, title);
      expect(el, `${title} did not render`).toBeTruthy();
      const state = el!.getAttribute('data-state');
      expect(state, `${title} is still loading`).not.toBe('loading');
      // 🔴 No Overview widget became `deferred`, and none acquired a Giving
      // widget's state by accident.
      expect(state, `${title} became deferred`).not.toBe('deferred');
      if (state === 'unavailable') {
        expect(text(el!.querySelector('[data-empty-reason]')).length).toBeGreaterThan(20);
      }
    }
    // The Devotion funnel's empty state, verbatim as THE-276 shipped it.
    expect(reasonOf(c, 'Devotion funnel')).toContain('devotional reading, streaks or plan progress');
  });

  it('and no Giving widget leaked onto the Overview tab', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    for (const title of ['Giving over time', 'Campaign progress', 'Pledge fulfilment']) {
      expect(widget(c, title), `${title} rendered on Overview`).toBeNull();
    }
    expect(c.querySelector('[data-giving-tab]'), 'the Giving panel mounted on Overview').toBeNull();
  });

  it('an Overview read that fails still renders a reason and never a zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contacts', new Error('permission-denied'));
    const c = await screen();

    const contacts = [...c.querySelectorAll('[data-kpi]')]
      .find((card) => text(card).includes('Contacts'))!;
    expect(text(contacts)).not.toMatch(/(^|\s)0(\s|$)/);
    expect(text(contacts).length).toBeGreaterThan(20);
  });
});

/* ═══ 3 · 🔴 A missing or non-numeric amount is refused and counted ══════════ */

/**
 * 🔴 THE MOST IMPORTANT SECTION IN THIS FILE. #421's exact bug, on all three
 * collections: a missing `amount` was coerced to `0`, and the giving total was
 * silently short by that gift. Every case below must produce a REFUSAL WITH A
 * COUNT, never a smaller number and never `NaN`.
 */
describe('a missing or non-numeric amount is refused and counted, never coerced to 0', () => {
  /**
   * ⚠️ Every value that is not a readable amount, including the two that are
   * `typeof 'number'`. `NaN` and `Infinity` pass a `typeof` test and poison
   * every total they reach into `NaN`, which renders as the literal string on a
   * money chart — the same defect as a coercion, one value over.
   */
  const NOT_AN_AMOUNT = [undefined, null, '', '250', 'abc', {}, [], true, NaN, Infinity, -Infinity] as const;

  it.each(NOT_AN_AMOUNT.map((v) => [String(v === '' ? '<empty string>' : v), v] as const))(
    'a campaign whose raised is %s is refused, never read as 0',
    (_name, value) => {
      const row = toCampaignRow({ title: 'Roof fund', goal: 20000, raised: value }, 'c1');
      expect(row.raisedDollars, 'a non-amount became a number').toBeNull();

      const gate = readableCampaigns([toCampaignRow({ title: 'Ok', goal: 1, raised: 1 }, 'c0'), row]);
      expect(gate.kind).toBe('unavailable');
      expect(gate.kind === 'unavailable' && gate.reason).toContain('1 of 2 campaigns');
    },
  );

  it.each(NOT_AN_AMOUNT.map((v) => [String(v === '' ? '<empty string>' : v), v] as const))(
    'a pledge whose pledgeAmount is %s is refused, never read as 0',
    (_name, value) => {
      const row = toPledgeRow({ pledgeAmount: value, paidAmount: 0, status: 'active', dueDate: null });
      expect(row.pledgedDollars).toBeNull();

      const gate = readablePledges([
        toPledgeRow({ pledgeAmount: 1, paidAmount: 0, status: 'active', dueDate: null }),
        row,
      ]);
      expect(gate.kind).toBe('unavailable');
      expect(gate.kind === 'unavailable' && gate.reason).toContain('1 of 2 pledges');
    },
  );

  it.each(NOT_AN_AMOUNT.map((v) => [String(v === '' ? '<empty string>' : v), v] as const))(
    'a receipt whose amount is %s is refused, never read as 0 — #421\'s exact bug',
    (_name, value) => {
      const row = toInvoiceRow({ amount: value, type: 'donation_receipt', issuedAt: null });
      expect(row.amountCents).toBeNull();

      const gate = readableReceipts([
        toInvoiceRow({ amount: 1, type: 'donation_receipt', issuedAt: null }),
        row,
      ]);
      expect(gate.kind).toBe('unavailable');
      expect(gate.kind === 'unavailable' && gate.reason).toContain('1 of 2 receipts');
    },
  );

  it('a pledge with no readable STATUS is refused too — it can be filed nowhere', () => {
    // Same reasoning as `type` on a receipt: a pledge that cannot be filed under
    // a status cannot be counted as outstanding OR as fulfilled, and quietly
    // filing it under `active` would overstate what is still owed.
    const gate = readablePledges([
      toPledgeRow({ pledgeAmount: 1, paidAmount: 0, status: 'active', dueDate: null }),
      toPledgeRow({ pledgeAmount: 500, paidAmount: 0, dueDate: null }),
    ]);
    expect(gate.kind).toBe('unavailable');
    expect(gate.kind === 'unavailable' && gate.reason).toContain('1 of 2 pledges');
  });

  it('🔴 and the campaign widget RENDERS that refusal rather than a short total', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('campaigns', [
      { title: 'Roof fund', goal: 20000, raised: 5000, isActive: true },
      // 🔴 No `raised`. A coercion to 0 would render a $5,000 total instead of
      // refusing — quietly short by an unknown amount, with no symptom.
      { title: 'Youth camp', goal: 4000, isActive: false },
    ]);
    counts.set('campaigns', 2);
    const c = await givingScreen();

    const el = widget(c, 'Campaign progress')!;
    expect(el.getAttribute('data-state')).toBe('unavailable');
    expect(reasonOf(c, 'Campaign progress')).toContain('1 of 2 campaigns');
    // The short total a coercion would have produced, and the row it came from.
    expect(text(el)).not.toContain('$5,000');
    expect(text(el)).not.toContain('Youth camp');
    expect(text(el)).not.toMatch(/NaN/);
  });

  it('🔴 and the pledge widget RENDERS that refusal rather than a short total', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('tenants/grace/pledges', [
      { pledgeAmount: 1200, paidAmount: 1200, status: 'fulfilled', dueDate: null },
      // 🔴 No `paidAmount`.
      { pledgeAmount: 600, status: 'active', dueDate: null },
    ]);
    counts.set('tenants/grace/pledges', 2);
    const c = await givingScreen();

    const el = widget(c, 'Pledge fulfilment')!;
    expect(el.getAttribute('data-state')).toBe('unavailable');
    expect(reasonOf(c, 'Pledge fulfilment')).toContain('1 of 2 pledges');
    expect(text(el)).not.toContain('$1,200');
    expect(text(el)).not.toMatch(/NaN/);
  });

  it('🔴 and the relocated trend RENDERS the ledger refusal, on the Giving tab too', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, type: 'donation_receipt', issuedAt: new Date(NOW - DAY).toISOString() },
      { type: 'donation_receipt', issuedAt: new Date(NOW - DAY).toISOString() },
    ]);
    counts.set('tenants/grace/invoices', 2);
    const c = await givingScreen();

    const trend = widget(c, 'Giving over time')!;
    expect(trend.getAttribute('data-state')).toBe('unavailable');
    expect(reasonOf(c, 'Giving over time')).toContain('1 of 2 receipts');
    // The short total a coercion would have produced.
    expect(text(trend)).not.toContain('250');
  });

  it('no coercion survives anywhere in the giving read layer', async () => {
    // The rendered assertions above prove the behaviour; this proves there is no
    // second path that could reintroduce it. Read from source rather than from
    // the module, because a `?? 0` on a branch no fixture reaches is still a bug.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    for (const file of ['giving-data.ts', 'useGivingData.ts', 'CampaignProgress.tsx', 'PledgeFulfilment.tsx']) {
      const code = readFileSync(path.join(process.cwd(), 'src/components/dashboard', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${file} coerces a money field`).not.toMatch(/\?\?\s*0\b/);
      expect(code, `${file} coerces a money field`).not.toMatch(/\|\|\s*0\b/);
      expect(code, `${file} parses a money field`).not.toMatch(/\bNumber\s*\(|parseFloat|parseInt|\+\s*data\./);
    }
  });
});

/* ═══ 4 · 🔴 Cents and dollars are never mixed ═══════════════════════════════ */

describe('cents and dollars are never mixed', () => {
  it('a $250 campaign renders as $250 — the document already holds dollars', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('campaigns', [{ title: 'Roof fund', goal: 1000, raised: 250, isActive: true }]);
    counts.set('campaigns', 1);
    const c = await givingScreen();

    const el = widget(c, 'Campaign progress')!;
    expect(el.getAttribute('data-state')).toBe('ready');
    expect(text(el.querySelector('[data-campaign-raised="campaigns-0"]'))).toBe('$250');
    // 🔴 The two hundredfold errors, both named. `$25,000` is a missing `/100`
    // treating dollars as cents; `$3` is a spurious one.
    expect(text(el)).not.toContain('$25,000');
    expect(text(el)).not.toContain('$2.50');
    // 25% of the goal, from two dollar figures.
    expect(text(el.querySelector('[data-campaign-percent="campaigns-0"]'))).toBe('25%');
  });

  it('a $1,200 pledge renders as $1,200 — pledges are dollars too', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('tenants/grace/pledges', [
      { pledgeAmount: 1200, paidAmount: 600, status: 'active', dueDate: null },
    ]);
    counts.set('tenants/grace/pledges', 1);
    const c = await givingScreen();

    const el = widget(c, 'Pledge fulfilment')!;
    expect(el.getAttribute('data-state')).toBe('ready');
    expect(text(el.querySelector('[data-pledge-figure="pledged"]'))).toContain('$1,200');
    expect(text(el.querySelector('[data-pledge-figure="paid"]'))).toContain('$600');
    expect(text(el.querySelector('[data-pledge-figure="percent"]'))).toContain('50%');
    expect(text(el)).not.toContain('$120,000');
    expect(text(el)).not.toContain('$12.00');
  });

  it('🔴 the two dollar widgets contain no division by 100 at all', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    for (const file of ['giving-data.ts', 'CampaignProgress.tsx', 'PledgeFulfilment.tsx']) {
      const code = readFileSync(path.join(process.cwd(), 'src/components/dashboard', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      // `GivingMix` divides ONCE because receipts are cents. These three read no
      // cents figure at all, so a `/ 100` here could only be a unit error.
      expect(code, `${file} divides by 100 — its figures are already dollars`).not.toMatch(/\/\s*100\b/);
      expect(code, `${file} names a cents field`).not.toMatch(/amountCents|amount_cents/);
    }
  });

  it('🔴 and contacts.totalDonated — the other dollar field — is never read here', async () => {
    grantAnalytics();
    healthyTenant();
    await givingScreen();

    // `contacts` is counted by the Overview hook with an aggregation and no
    // document is ever fetched from it, so `totalDonated` cannot reach a giving
    // figure. A `getDocs` on contacts would be the read that made mixing
    // possible in the first place.
    const contactQueries = built.filter((q) => keyOf(q) === 'contacts');
    expect(contactQueries.length).toBeGreaterThan(0);
    expect(docsFor.has('contacts')).toBe(false);

    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    /*
     * ⚠️ COMMENTS STRIPPED. The module headers explain at length that
     * `contacts.totalDonated` is the OTHER dollar field and is deliberately not
     * read; banning the word from prose would forbid recording that decision,
     * which is the opposite of what this test defends. What is banned is a
     * READ, which lives in the code.
     */
    for (const file of ['giving-data.ts', 'useGivingData.ts', 'GivingTab.tsx', 'CampaignProgress.tsx', 'PledgeFulfilment.tsx']) {
      const code = readFileSync(path.join(process.cwd(), 'src/components/dashboard', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${file} reads totalDonated`).not.toMatch(/totalDonated/);
      expect(code, `${file} reads contacts`).not.toMatch(/'contacts'/);
    }
  });
});

/* ═══ 5 · 🔴 No Firestore orderBy is issued on invoices ═════════════════════ */

describe('no Firestore orderBy is issued on invoices', () => {
  it('🔴 nor on campaigns or pledges — every query is one equality or a subcollection', async () => {
    grantAnalytics();
    healthyTenant();
    await givingScreen();

    /*
     * 🔴 `invoices.issuedAt` holds BOTH ISO strings and Timestamps — the
     * donation webhook writes `issuedAt: nowIso` — and Firestore orders ACROSS
     * TYPES BY TYPE FIRST. So `orderBy('issuedAt','desc')` returns every string
     * row before any Timestamp row: a stable order, not a chronological one, and
     * a `limit()` on top of it is a biased sample presented as "most recent".
     * The fixture ledger deliberately contains both shapes.
     */
    expect(built.length).toBeGreaterThan(0);
    for (const q of built) {
      expect(q.orderBy, `${keyOf(q)} carries an orderBy`).toEqual([]);
    }

    // And the shape of each read this tab adds: `campaigns` is one tenant
    // equality (served by the automatic single-field index every collection
    // has), `pledges` is a subcollection and needs no `where` at all.
    for (const q of built.filter((b) => keyOf(b) === 'campaigns')) {
      expect(q.where).toEqual([['tenantId', '==', 'grace']]);
    }
    for (const q of built.filter((b) => keyOf(b) === 'tenants/grace/pledges')) {
      expect(q.where).toEqual([]);
    }
  });

  it('and the ordering is done in memory, over a complete set', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    // Active first, then most raised. `Youth camp` raised more but is inactive,
    // so `Roof fund` leads — an ordering Firestore was never asked for.
    const rows = [...c.querySelectorAll('[data-campaign-row]')]
      .map((r) => r.getAttribute('data-campaign-row'));
    expect(rows).toHaveLength(CAMPAIGNS.length);
    expect(rows[0]).toBe('campaigns-0');

    // 🔴 And the count gate is what makes it complete: above the ceiling there
    // is no table at all rather than a sorted sample.
    counts.set('campaigns', DASHBOARD_FETCH_LIMIT + 1);
    await act(async () => { root?.unmount(); });
    root = null;
    const c2 = await givingScreen();
    expect(widget(c2, 'Campaign progress')!.getAttribute('data-state')).toBe('unavailable');
    expect(reasonOf(c2, 'Campaign progress')).toContain('records match');
  });
});

/* ═══ 6 · 🔴 campaigns.raised is read, never recomputed from invoices ═══════ */

describe('campaigns.raised is read, never recomputed from invoices', () => {
  it('🔴 renders the document\'s own total even when the ledger disagrees', async () => {
    grantAnalytics();
    healthyTenant();
    // The campaign says $250. The ledger says $9,999 of receipts. 🔴 They
    // legitimately differ — an event ticket, a gift given before the campaign
    // existed, an offline adjustment with no receipt, fee handling — and
    // `raised` is the authoritative one, maintained by the webhook's
    // per-payment increment and by /api/campaigns/adjust-raised.
    docsFor.set('campaigns', [{ title: 'Roof fund', goal: 1000, raised: 250, isActive: true }]);
    counts.set('campaigns', 1);
    docsFor.set('tenants/grace/invoices', [
      { amount: 999900, type: 'donation_receipt', issuedAt: new Date(NOW - DAY).toISOString() },
    ]);
    counts.set('tenants/grace/invoices', 1);
    const c = await givingScreen();

    const el = widget(c, 'Campaign progress')!;
    expect(text(el.querySelector('[data-campaign-raised="campaigns-0"]'))).toBe('$250');
    // The figure a recomputation would have produced, in either unit.
    expect(text(el)).not.toContain('$9,999');
    expect(text(el)).not.toContain('$999,900');
  });

  it('and no receipt is read on the campaign path at all', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    // 🔴 Two sources for one number is how they drift. Neither the campaign
    // widget nor the read behind it may so much as mention the ledger.
    for (const file of ['giving-data.ts', 'useGivingData.ts', 'CampaignProgress.tsx']) {
      const code = readFileSync(path.join(process.cwd(), 'src/components/dashboard', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, `${file} reads invoices`).not.toMatch(/invoicesQuery|'invoices'|toInvoiceRow|readableReceipts/);
    }
  });

  it('a campaign past its goal is capped at 100%, not shown at 150%', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();
    // `Youth camp`: $6,000 raised against a $4,000 goal. The raised figure is
    // reported in full; only the BAR is capped, because a bar cannot be 150%.
    const el = widget(c, 'Campaign progress')!;
    expect(text(el.querySelector('[data-campaign-percent="campaigns-1"]'))).toBe('100%');
    expect(text(el.querySelector('[data-campaign-raised="campaigns-1"]'))).toBe('$6,000');
  });

  it('🔴 a campaign with no goal shows no bar and no 0% — a ratio with no denominator', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const el = widget(c, 'Campaign progress')!;
    // `Benevolence`: $1,250 raised, goal 0. A 0% bar would state it raised
    // nothing, which is false by $1,250.
    expect(el.querySelector('[data-campaign-no-goal="campaigns-2"]')).toBeTruthy();
    expect(el.querySelector('[data-campaign-percent="campaigns-2"]')).toBeNull();
    expect(text(el.querySelector('[data-campaign-raised="campaigns-2"]'))).toBe('$1,250');
    // And the count is surfaced beside the table rather than left implicit.
    expect(text(el.querySelector('[data-campaign-coverage]'))).toContain('1 recorded no goal');
  });

  it('a campaign with no readable title is named as missing, never invented or hidden', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const el = widget(c, 'Campaign progress')!;
    expect([...el.querySelectorAll('[data-campaign-row]')]).toHaveLength(CAMPAIGNS.length);
    expect(el.querySelector('[data-campaign-unnamed]')).toBeTruthy();
    expect(text(el.querySelector('[data-campaign-coverage]'))).toContain('1 carry no name');
  });
});

/* ═══ 7 · 🔴 The pledge widget is labelled pledges ═══════════════════════════ */

describe('the pledge widget is labelled pledges', () => {
  /**
   * 🔴 Nothing at the tenant level marks a gift recurring, verified three ways:
   * Stripe Connect is off so there is no tenant card-giving path at all;
   * `invoices.type` records no cadence; and `users.donationSubscriptionId` is
   * the PLATFORM partnership — someone giving to Harvest — not a church's donor.
   * So "recurring giving" would assert a schedule nobody recorded.
   */
  const FORBIDDEN = [/recurring/i, /subscription/i, /monthly giving/i, /monthly gift/i];

  it('says pledges, and never recurring, subscription or monthly giving', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const el = widget(c, 'Pledge fulfilment')!;
    expect(text(el)).toContain('Pledge fulfilment');
    expect(text(el)).toContain('Commitments made to this ministry');
    for (const banned of FORBIDDEN) {
      expect(text(el), `the pledge widget says ${banned}`).not.toMatch(banned);
    }
  });

  it('and no widget ANYWHERE on the Giving tab uses one of those words', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const tab = c.querySelector('[data-giving-tab]')!;
    for (const banned of FORBIDDEN) {
      expect(text(tab), `the Giving tab says ${banned}`).not.toMatch(banned);
    }
    // Nor is one hiding in a widget title.
    const titles = [...tab.querySelectorAll('[data-widget]')].map((el) => el.getAttribute('data-widget') ?? '');
    expect(titles.sort()).toEqual(['Campaign progress', 'Giving over time', 'Pledge fulfilment']);
  });

  it('nor in the source of any file this slice added', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    /*
     * ⚠️ COMMENTS ARE KEPT for this sweep, with one exception: the headers
     * explain at length WHY the recurring widget cannot be built, and banning
     * the word from prose would forbid stating the decision — the opposite of
     * what this test defends. So the sweep is over the CODE, comments stripped,
     * which is where a label that reaches a screen would live.
     */
    for (const file of ['GivingTab.tsx', 'PledgeFulfilment.tsx', 'CampaignProgress.tsx', 'giving-data.ts', 'useGivingData.ts']) {
      const code = readFileSync(path.join(process.cwd(), 'src/components/dashboard', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const banned of FORBIDDEN) {
        expect(code, `${file} spells ${banned} in code`).not.toMatch(banned);
      }
      // And no Stripe Connect surface is restored on the way past.
      expect(code, `${file} touches Stripe Connect`).not.toMatch(/STRIPE_CONNECT|stripe-connect|donationSubscriptionId/);
    }
  });

  it('🔴 and it names no donor — a fulfilment dashboard is not a debtors\' list', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const tab = text(c.querySelector('[data-giving-tab]'));
    // The identifying fields are genuinely present in the documents the widget
    // read, so this fails if any layer reintroduces one.
    expect(PLEDGE_IDENTIFIERS.length).toBeGreaterThan(4);
    for (const identifier of PLEDGE_IDENTIFIERS) {
      expect(tab, `the Giving tab names ${identifier}`).not.toContain(identifier);
    }
    expect(tab).not.toContain('gift aid'); // the `notes` field
  });

  it('reports fulfilment as totals, with every pledge in exactly one status row', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const el = widget(c, 'Pledge fulfilment')!;
    expect(el.getAttribute('data-state')).toBe('ready');
    // $2,500 pledged, $1,450 paid — both sums of the DOLLAR fields.
    expect(text(el.querySelector('[data-pledge-figure="pledged"]'))).toContain('$2,500');
    expect(text(el.querySelector('[data-pledge-figure="paid"]'))).toContain('$1,450');

    const statuses = [...el.querySelectorAll('[data-pledge-status]')]
      .map((row) => row.getAttribute('data-pledge-status'));
    expect(statuses!.sort()).toEqual(['active', 'fulfilled', 'lapsed']);

    // 🔴 One overdue (Grace Hopper's active pledge, two days past due), and one
    // undated — counted as undated and NEVER as overdue.
    const dates = text(el.querySelector('[data-pledge-dates]'));
    expect(dates).toContain('1 of 4 pledges are unfulfilled past their due date');
    expect(dates).toContain('1 carry no due date');
  });

  it('and the aggregate\'s two partitions each account for every pledge', () => {
    const gate = readablePledges(PLEDGES.map(toPledgeRow));
    expect(gate.kind).toBe('complete');
    const summary = summarisePledges(gate.kind === 'complete' ? gate.rows : [], NOW);

    // 🔴 INVARIANTS, not spot checks. Every pledge lands in exactly one status
    // row and in exactly one date bucket, so a reader can add either partition
    // up and reach the total.
    expect(summary.byStatus.reduce((n, s) => n + s.pledges, 0)).toBe(summary.pledges);
    expect(summary.overdue + summary.notOverdue + summary.undated).toBe(summary.pledges);
    expect(summary.pledgedDollars).toBe(1200 + 600 + 400 + 300);
    expect(summary.paidDollars).toBe(1200 + 150 + 0 + 100);
    // A fulfilled pledge 30 days past its due date is NOT overdue.
    expect(summary.overdue).toBe(1);
  });
});

/* ═══ 8 · Unreadable receipts are surfaced, not silently omitted ════════════ */

describe('unreadable receipts are surfaced, not silently omitted', () => {
  it('the readableReceipts gate came with the widget, and it names the count', async () => {
    grantAnalytics();
    healthyTenant();
    // 🔴 Two of five receipts unreadable: one with no `amount`, one with no
    // `type`. A total omitting them would be short by an unknown sum; the gate
    // refuses the whole figure and says how many, so a founder can go and look
    // at the documents.
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, type: 'donation_receipt', issuedAt: new Date(NOW - DAY).toISOString() },
      { amount: 50000, type: 'donation_receipt', issuedAt: new Date(NOW - 2 * DAY).toISOString() },
      { amount: 75000, type: 'event_ticket', issuedAt: new Date(NOW - 3 * DAY).toISOString() },
      { type: 'donation_receipt', issuedAt: new Date(NOW - 4 * DAY).toISOString() },
      { amount: 1000, issuedAt: new Date(NOW - 5 * DAY).toISOString() },
    ]);
    counts.set('tenants/grace/invoices', 5);
    const c = await givingScreen();

    expect(widget(c, 'Giving over time')!.getAttribute('data-state')).toBe('unavailable');
    expect(reasonOf(c, 'Giving over time')).toContain('2 of 5 receipts');
    expect(reasonOf(c, 'Giving over time')).toContain('no giving total here would be complete');

    // 🔴 And the SAME refusal reaches the Overview tab, from the same read. The
    // two tabs cannot disagree about whether the ledger was readable either.
    await openTab(c, 'Overview');
    expect(reasonOf(c, 'Giving mix')).toContain('2 of 5 receipts');
  });

  it('an above-ceiling ledger refuses the trend on the Giving tab as well', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('tenants/grace/invoices', DASHBOARD_FETCH_LIMIT + 1);
    const c = await givingScreen();

    const trend = widget(c, 'Giving over time')!;
    expect(trend.getAttribute('data-state')).toBe('unavailable');
    expect(reasonOf(c, 'Giving over time')).toContain('complete trend cannot be read');
  });

  it('and a ledger read that is REFUSED outright still renders a reason, never a zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('tenants/grace/invoices', new Error('permission-denied'));
    const c = await givingScreen();

    const trend = widget(c, 'Giving over time')!;
    expect(trend.getAttribute('data-state')).toBe('unavailable');
    expect(reasonOf(c, 'Giving over time').length).toBeGreaterThan(20);
    expect(text(trend)).not.toMatch(/(^|\s)\$0(\s|$)/);
  });
});

/* ═══ 9 · 🔴 No figure is fabricated ════════════════════════════════════════ */

describe('no figure is fabricated', () => {
  it('every number traces to a read, or the widget shows empty', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await givingScreen();

    const tab = c.querySelector('[data-giving-tab]')!;
    for (const el of [...tab.querySelectorAll('[data-widget]')]) {
      const state = el.getAttribute('data-state');
      expect(state, `${el.getAttribute('data-widget')} is still loading`).not.toBe('loading');
      expect(['ready', 'unavailable']).toContain(state);
      if (state === 'unavailable') {
        expect(text(el.querySelector('[data-empty-reason]')).length).toBeGreaterThan(20);
      }
    }
    // 🔴 And nothing anywhere renders as a broken number.
    expect(text(tab)).not.toMatch(/NaN|undefined|Infinity|\$NaN|\bnull\b/);
  });

  it('every read failing leaves three explicit empty states and not one zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('tenants/grace/invoices', new Error('permission-denied'));
    counts.set('campaigns', new Error('permission-denied'));
    counts.set('tenants/grace/pledges', new Error('permission-denied'));
    const c = await givingScreen();

    for (const title of ['Giving over time', 'Campaign progress', 'Pledge fulfilment']) {
      expect(widget(c, title)!.getAttribute('data-state'), title).toBe('unavailable');
      expect(reasonOf(c, title).length, title).toBeGreaterThan(20);
    }
    // 🔴 A `0` and a failed read render identically, which is the whole defect
    // this feature exists to refuse. No money figure at all on this screen.
    const tab = text(c.querySelector('[data-giving-tab]'));
    expect(tab).not.toMatch(/\$0\b/);
    expect(tab).not.toMatch(/\b0%/);
  });

  it('a ministry with no campaigns and no pledges is told so, not shown zeros', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('campaigns', 0);
    counts.set('tenants/grace/pledges', 0);
    docsFor.set('campaigns', []);
    docsFor.set('tenants/grace/pledges', []);
    const c = await givingScreen();

    // 🔴 Zero rows would read as "your campaigns raised nothing". The reason
    // says what is actually true, and names where a campaign is created.
    expect(reasonOf(c, 'Campaign progress')).toBe(GIVING_REASON.noCampaigns);
    expect(reasonOf(c, 'Campaign progress')).toContain('Fundraising screen');
    expect(reasonOf(c, 'Pledge fulfilment')).toBe(GIVING_REASON.noPledges);
    expect(text(c.querySelector('[data-giving-tab]'))).not.toMatch(/\$0\b/);
  });

  it('🔴 on the apex, where there is no ministry, all three say so — no cross-tenant total', async () => {
    // `tenants/{t}/pledges` has no apex counterpart to read, and summing every
    // church's campaigns into one progress figure is a number this product does
    // not define. Same answer the Overview tab's giving widgets already give.
    authState.currentUser = { uid: 'root', email: 'bumbmatei@proton.me', displayName: 'Matei' };
    docReads.set('users/root', { role: 'superadmin', permissions: { analytics: true }, tenantId: null });
    counts.set('users', 3);
    counts.set('contacts', 0);
    counts.set('courses', 1);
    counts.set('community_posts', 0);
    counts.set('blog_posts', 0);
    counts.set('submissions', 0);
    counts.set('tenants', 2);
    docsFor.set('users', []);
    docsFor.set('submissions', []);

    const c = await mount(
      <AdminDashboardHome tenantId={null} isSuperAdmin unreadCount={0} onNavigate={() => {}} />,
    );
    await openTab(c, 'Giving');

    for (const title of ['Giving over time', 'Campaign progress', 'Pledge fulfilment']) {
      expect(widget(c, title)!.getAttribute('data-state'), title).toBe('unavailable');
      expect(reasonOf(c, title), title).toContain('No ministry is in scope');
    }
    // 🔴 And no campaign or pledge query was issued at all — not an unscoped one.
    expect(built.filter((q) => keyOf(q) === 'campaigns')).toHaveLength(0);
    expect(built.filter((q) => q.path.includes('pledges'))).toHaveLength(0);
  });

  it('the aggregates are pure and their invariants hold', () => {
    const gate = readableCampaigns(CAMPAIGNS.map((d, i) => toCampaignRow(d, `c${i}`)));
    expect(gate.kind).toBe('complete');
    const breakdown = aggregateCampaigns(gate.kind === 'complete' ? gate.rows : []);

    // 🔴 NOTHING IS DROPPED: every campaign read is a row, and the two coverage
    // counts are taken from those same rows.
    expect(breakdown.rows).toHaveLength(CAMPAIGNS.length);
    expect(breakdown.total).toBe(CAMPAIGNS.length);
    expect(breakdown.unnamed).toBe(1);
    expect(breakdown.withoutGoal).toBe(1);
    expect(breakdown.raisedDollars).toBe(5000 + 6000 + 1250 + 100);
    expect(breakdown.goalDollars).toBe(20000 + 4000 + 0 + 1000);
    // The sum of the rows equals the aggregate, so the table adds up.
    expect(breakdown.rows.reduce((n, r) => n + r.raisedDollars, 0)).toBe(breakdown.raisedDollars);
  });
});
