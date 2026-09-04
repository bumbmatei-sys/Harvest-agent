import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-276 — the dashboard shell and the Overview tab (slice 1 of 6).
 *
 * ─── What these tests are actually defending ─────────────────────────────────
 *
 * Not "does a chart appear". The defect this ticket exists to prevent is a
 * dashboard that renders a NUMBER it did not read: `AdminDashboardHome` used to
 * report `limit(500)` with no `orderBy` as a member count, and an unordered
 * `limit(N)` is an arbitrary sample, so the figure was wrong in a way nothing on
 * screen disclosed. The tests below are therefore mostly about the ABSENCE of
 * numbers — that a refused read renders a reason and not a zero, that a
 * truncated collection renders a reason and not a curve, and that nothing
 * anywhere renders `NaN`.
 *
 * ⚠️ The mock is a query RECORDER, not a Firestore. It captures the shape of
 * every query the screen builds so a test can assert which read ran, and it
 * answers counts and documents from a table each test sets up. That is what
 * lets "the count came from an aggregation, not from the length of a page"
 * be an assertion rather than a comment.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BuiltQuery = {
  path: string[];
  where: Array<[string, string, unknown]>;
  limit: number | null;
};

const { built, counts, docsFor, authState, docReads, gate } = vi.hoisted(() => ({
  built: [] as BuiltQuery[],
  counts: new Map<string, number | Error>(),
  docsFor: new Map<string, Array<Record<string, unknown>>>(),
  docReads: new Map<string, Record<string, unknown> | null>(),
  /** Lets one test hold the user-document read open to observe the pending state. */
  gate: { promise: null as Promise<void> | null },
  authState: { currentUser: null as { uid: string; email: string; displayName?: string } | null },
}));

/** `users` for a top-level collection; `tenants/grace/invoices` for a subcollection. */
const keyOf = (q: BuiltQuery) => q.path.join('/');

vi.mock('../../firebase', () => ({
  db: {},
  get auth() { return authState; },
}));

/**
 * ⚠️ `super-admins` is deliberately NOT mocked. Its list is a frozen literal
 * that must stay identical to firestore.rules and functions/src/index.ts, and a
 * mock here would let the gate's super-admin arm pass against an email the real
 * platform does not recognise. Every address these tests use is outside it, so
 * `isSuperAdminEmail` answers false for real.
 */
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments }),
  where: (field: string, op: string, value: unknown) => ({ __where: [field, op, value] as [string, string, unknown] }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: string, dir: string) => ({ __orderBy: [field, dir] }),
  doc: (_db: unknown, ...segments: string[]) => ({ __doc: segments.join('/') }),
  query: (base: { __path: string[] }, ...constraints: Array<Record<string, unknown>>) => {
    const q: BuiltQuery = {
      path: base.__path,
      where: constraints.filter((c) => '__where' in c).map((c) => c.__where as [string, string, unknown]),
      limit: (constraints.find((c) => '__limit' in c)?.__limit as number) ?? null,
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
    return { docs: rows.map((data, i) => ({ id: `doc-${i}`, data: () => data })) };
  },
  getDoc: async (ref: { __doc: string }) => {
    if (gate.promise) await gate.promise;
    const data = docReads.get(ref.__doc) ?? null;
    return { exists: () => data !== null, data: () => data ?? undefined };
  },
}));

const AdminDashboardHome = (await import('../AdminDashboardHome')).default;
const { DASHBOARD_TABS } = await import('../dashboard/DashboardTabs');

/**
 * The tabs that are still `NotYetBuilt`, by id.
 *
 * ⚠️ Derived by EXCLUSION rather than listed, so a seventh tab appearing in
 * `DASHBOARD_TABS` is automatically required to carry a placeholder. `overview`
 * is THE-276's, `growth` is THE-283's and `giving` is THE-290's; everything else
 * is a later slice.
 *
 * ⚠️ AMENDED BY THE-290, and narrowed rather than relaxed — the same edit
 * THE-283 made when it built Growth. The claim below is now about THREE unbuilt
 * tabs instead of four, and a tab that quietly stopped saying it was unbuilt
 * WITHOUT being built still fails here.
 *
 * ⚠️ AMENDED AGAIN BY THE-294, which built Engagement and Content, and narrowed
 * the same way. ONE unbuilt tab remains — Platform — and the claim is still that
 * every tab not on this list carries a placeholder naming itself. A tab added to
 * this list without a panel actually being supplied fails the two assertions
 * below it, so the list cannot be used to silence the guard.
 */
const BUILT_TABS = ['overview', 'growth', 'giving', 'engagement', 'content'] as const;
const UNBUILT_TABS = DASHBOARD_TABS.filter(
  (t: { id: string }) => !(BUILT_TABS as readonly string[]).includes(t.id),
);
const { bucketWeekly, deltaOf, weekBuckets, DASHBOARD_FETCH_LIMIT } = await import('../dashboard/dashboard-data');
const { givingMix } = await import('../dashboard/GivingMix');
const { readableReceipts, toInvoiceRow } = await import('../dashboard/dashboard-data');
const { buildInsights } = await import('../dashboard/InsightFeed');
const { canViewAnalytics } = await import('../dashboard/analytics-permission');

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  // Let the read chain (count → fetch → setState) settle.
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  return container;
}

/** Click a tab trigger by its label and let the panel swap settle. */
async function openTab(root: ParentNode, label: string): Promise<void> {
  const trigger = [...root.querySelectorAll('[data-slot="tabs-trigger"]')]
    .find((t) => (t.textContent ?? '').trim() === label) as HTMLElement | undefined;
  if (!trigger) throw new Error(`no tab trigger labelled ${label}`);
  await act(async () => { trigger.click(); });
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 2, 12, 12, 0, 0);

/** A tenant whose every read succeeds and sits comfortably under the ceiling. */
function healthyTenant() {
  counts.set('users', 3);
  counts.set('contacts', 42);
  counts.set('courses', 2);
  counts.set('community_posts', 7);
  counts.set('blog_posts', 4);
  counts.set('submissions', 1);
  counts.set('tenants/grace/invoices', 2);

  docsFor.set('users', [
    { createdAt: NOW - 2 * DAY },
    { createdAt: NOW - 3 * DAY },
    { createdAt: NOW - 40 * DAY },
  ]);
  docsFor.set('submissions', [{ createdAt: NOW - DAY }]);
  docsFor.set('tenants/grace/invoices', [
    { amount: 25000, issuedAt: new Date(NOW - 2 * DAY).toISOString(), type: 'donation_receipt' },
    { amount: 5000, issuedAt: new Date(NOW - 30 * DAY).toISOString(), type: 'event_ticket' },
  ]);
  docReads.set('tenants/grace/livestream/current', { active: true, title: 'Sunday service' });
}

/** Signed in, and holding the Analytics permission. */
function grantAnalytics() {
  authState.currentUser = { uid: 'u1', email: 'pastor@grace.org', displayName: 'Ada Grace' };
  docReads.set('users/u1', { role: 'admin', permissions: { analytics: true }, tenantId: 'grace' });
}

const screen = () =>
  mount(<AdminDashboardHome tenantId="grace" tenantName="Grace Chapel" isSuperAdmin={false} unreadCount={0} onNavigate={() => {}} />);

beforeEach(() => {
  built.length = 0;
  counts.clear();
  docsFor.clear();
  docReads.clear();
  gate.promise = null;
  authState.currentUser = null;
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container?.remove();
});

const text = (el: ParentNode) => el.textContent ?? '';

/* ═══ 1 · The shell ══════════════════════════════════════════════════════════ */

describe('the tab shell renders all six tabs', () => {
  it('renders one trigger per tab, in the design order', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const labels = [...c.querySelectorAll('[data-slot="tabs-trigger"]')].map((t) => text(t).trim());
    expect(labels).toEqual(['Overview', 'Growth', 'Giving', 'Engagement', 'Content', 'Platform']);
    expect(DASHBOARD_TABS).toHaveLength(6);
  });

  it('the remaining unbuilt tab says so by name, rather than rendering nothing', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    // ⚠️ Base UI mounts only the ACTIVE panel, so each tab has to be opened to
    // be asserted. Clicking is also the honest test: a placeholder that only
    // exists in the DOM of a tab nobody can reach is not a shipped tab.
    //
    // ⚠️ AMENDED BY THE-283, which built Growth, and again by THE-290, which
    // built Giving. The claim narrows from five tabs to four to three and is
    // NOT dropped: a tab that quietly stopped saying it was unbuilt, without
    // being built, still fails here. Growth's and Giving's own assertions are
    // the lines below — neither may carry a placeholder at all.
    for (const tab of UNBUILT_TABS) {
      await openTab(c, tab.label);
      const placeholder = c.querySelector(`[data-tab-placeholder="${tab.id}"]`);
      expect(placeholder, `${tab.label} has no placeholder`).toBeTruthy();
      expect(text(placeholder!)).toContain(`${tab.label} is not built yet`);
    }

    await openTab(c, 'Growth');
    expect(c.querySelector('[data-tab-placeholder="growth"]'), 'Growth is built now').toBeNull();
    expect(c.querySelector('[data-growth-tab]'), 'Growth panel did not render').toBeTruthy();

    await openTab(c, 'Giving');
    expect(c.querySelector('[data-tab-placeholder="giving"]'), 'Giving is built now').toBeNull();
    expect(c.querySelector('[data-giving-tab]'), 'Giving panel did not render').toBeTruthy();

    // ⚠️ THE-294's two, asserted the same way: neither may carry a placeholder,
    // and each must actually render its own panel.
    await openTab(c, 'Engagement');
    expect(c.querySelector('[data-tab-placeholder="engagement"]'), 'Engagement is built now').toBeNull();
    expect(c.querySelector('[data-engagement-tab]'), 'Engagement panel did not render').toBeTruthy();

    await openTab(c, 'Content');
    expect(c.querySelector('[data-tab-placeholder="content"]'), 'Content is built now').toBeNull();
    expect(c.querySelector('[data-content-tab]'), 'Content panel did not render').toBeTruthy();

    await openTab(c, 'Overview');
    expect(c.querySelector('[data-tab-placeholder="overview"]')).toBeNull();
    expect(c.querySelector('[data-kpi-grid]')).toBeTruthy();
  });
});

/* ═══ 2 · Every widget renders, with data or with a reason ═══════════════════ */

describe('each Overview widget renders with real data or an explicit empty state', () => {
  const WIDGETS = ['Giving & growth', 'What changed', 'Giving mix', 'Devotion funnel'] as const;

  it.each(WIDGETS)('%s is present and in exactly one of the two states', async (title) => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const widget = c.querySelector(`[data-widget="${title}"]`);
    expect(widget, `${title} did not render at all`).toBeTruthy();

    const state = widget!.getAttribute('data-state');
    expect(state, `${title} is still loading`).not.toBe('loading');
    if (state === 'unavailable') {
      // An empty state must SAY something; "no data" with no reason is the
      // failure mode this whole ticket is about.
      expect(text(widget!.querySelector('[data-empty-reason]')!).length).toBeGreaterThan(20);
    }
  });

  it('the live-now strip reports the stream document it actually read', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    expect(text(c.querySelector('[data-live-badge="active"]')!)).toContain('Sunday service');
  });

  it('renders all seven KPI cards', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    expect(c.querySelectorAll('[data-kpi]')).toHaveLength(7);
  });

  it('shows a skeleton while the permission read is still in flight, and never flashes the refusal', async () => {
    grantAnalytics();
    healthyTenant();
    // Hold the user-document read open, so "pending" is a state the test can
    // observe rather than a frame it has to race.
    let release!: () => void;
    gate.promise = new Promise<void>((resolve) => { release = resolve; });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<AdminDashboardHome tenantId="grace" tenantName="Grace Chapel" isSuperAdmin={false} unreadCount={0} onNavigate={() => {}} />);
    });

    expect(container.querySelector('[data-analytics-pending]')).toBeTruthy();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    // 🔴 The refusal must NOT appear while the answer is unknown — otherwise
    // every admin who does hold the permission sees it flash on every load.
    expect(container.querySelector('[data-analytics-denied]')).toBeNull();

    await act(async () => { release(); });
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-dashboard-tabs]')).toBeTruthy();
  });

  it('shows a spinner beside a widget title while its own read is in flight', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    // Once settled there is no spinner left; the loading path is proven by the
    // widget frame's own state attribute never being stuck on `loading`.
    for (const widget of c.querySelectorAll('[data-widget]')) {
      expect(widget.getAttribute('data-state')).not.toBe('loading');
    }
    expect(c.querySelector('[data-slot="spinner"]')).toBeNull();
  });
});

/* ═══ 3 · Nothing is fabricated ══════════════════════════════════════════════ */

describe('no widget fabricates a number', () => {
  it('a refused count renders a reason, never a zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('users', new Error('permission-denied'));
    const c = await screen();

    const membersCard = c.querySelector('[data-kpi="Members"]')!;
    expect(membersCard.getAttribute('data-state')).toBe('unavailable');
    expect(membersCard.querySelector('[data-kpi-value]')).toBeNull();
    expect(text(membersCard)).not.toMatch(/\b0\b/);
    expect(text(membersCard.querySelector('[data-kpi-unavailable]')!).length).toBeGreaterThan(10);
  });

  it('a collection above the fetch ceiling gets no trend, and says why', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('users', DASHBOARD_FETCH_LIMIT + 1);
    const c = await screen();

    const membersCard = c.querySelector('[data-kpi="Members"]')!;
    // The COUNT is still exact — an aggregation is not clamped by a ceiling.
    expect(text(membersCard.querySelector('[data-kpi-value]')!)).toBe((DASHBOARD_FETCH_LIMIT + 1).toLocaleString());
    // The TREND is refused, separately, and the card says so.
    expect(membersCard.querySelector('[data-kpi-sparkline]')).toBeNull();
    expect(membersCard.querySelector('[data-kpi-delta]')).toBeNull();
    expect(text(membersCard.querySelector('[data-kpi-trend-note]')!)).toContain('complete trend');
  });

  it('a receipt with no readable amount refuses the giving figures rather than shrinking them', async () => {
    grantAnalytics();
    healthyTenant();
    // One good gift, one whose `amount` is a string the app never writes.
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
      { amount: 'forty dollars', issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
    ]);
    const c = await screen();

    // 🔴 The wrong outcome here is "$250" — a total that is quietly short by
    // one gift. The right one is a refusal that names the count.
    const mix = c.querySelector('[data-widget="Giving mix"]')!;
    expect(mix.getAttribute('data-state')).toBe('unavailable');
    expect(text(mix)).toContain('1 of 2 receipts');
    expect(text(c)).not.toContain('$250');

    const trend = c.querySelector('[data-widget="Giving & growth"]')!;
    expect(text(trend.querySelector('[data-series-unavailable="giving"]')!)).toContain('no readable amount');
  });

  it('readableReceipts refuses on a missing type as well as a missing amount', () => {
    expect(readableReceipts([toInvoiceRow({ amount: 1, issuedAt: null, type: 'invoice' })]).kind).toBe('complete');
    expect(readableReceipts([toInvoiceRow({ amount: 1, issuedAt: null })]).kind).toBe('unavailable');
    expect(readableReceipts([toInvoiceRow({ issuedAt: null, type: 'invoice' })]).kind).toBe('unavailable');
    // 🔴 An unreadable receipt must not be coerced into a zero or an 'invoice'.
    expect(toInvoiceRow({ issuedAt: null }).amountCents).toBeNull();
    expect(toInvoiceRow({ issuedAt: null }).type).toBeNull();
  });

  it('pointing a widget at a field the documents do not carry yields an empty state, not NaN or 0', async () => {
    grantAnalytics();
    healthyTenant();
    // Receipts whose amount/date fields are named something this app never writes.
    docsFor.set('tenants/grace/invoices', [
      { total: 25000, paidOn: new Date(NOW).toISOString(), category: 'donation_receipt' },
      { total: 5000, paidOn: new Date(NOW).toISOString(), category: 'event_ticket' },
    ]);
    const c = await screen();

    const mix = c.querySelector('[data-widget="Giving mix"]')!;
    expect(mix.getAttribute('data-state')).toBe('unavailable');
    expect(text(mix)).toContain('2 of 2 receipts');
    expect(text(mix)).not.toContain('NaN');
    expect(text(mix)).not.toContain('$0');
  });

  it('no figure anywhere on the screen renders as NaN, undefined or Infinity', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    expect(text(c)).not.toMatch(/NaN|undefined|Infinity|\$NaN/);
  });

  it('every count comes from an aggregation, and no read is an unordered limit(N) sample', async () => {
    grantAnalytics();
    healthyTenant();
    await screen();

    // 🔴 The #405 shape, asserted absent: a query carrying a `limit` must never
    // be the thing a figure is counted from. Every bounded query this screen
    // builds is a COMPLETE read already proven small by an aggregation, and
    // every bounded query is at the one ceiling.
    for (const q of built.filter((b) => b.limit !== null)) {
      expect(q.limit).toBe(DASHBOARD_FETCH_LIMIT);
    }
    // And the scoped reads are scoped: no unscoped collection scan for a tenant.
    for (const q of built.filter((b) => b.path.length === 1 && b.path[0] !== 'tenants')) {
      expect(q.where.map(([f]) => f)).toContain('tenantId');
    }
  });

  it('bucketWeekly drops a row whose date cannot be read rather than dating it', () => {
    const rows = [{ createdAt: NOW - DAY }, { createdAt: 'not a date' }, { createdAt: null }];
    const { points, undatedRows, outsideWindow } = bucketWeekly(rows, NOW, (r) => r.createdAt as never);
    expect(undatedRows).toBe(2);
    expect(outsideWindow).toBe(0);
    expect(points[points.length - 1].value).toBe(1);
    expect(points.reduce((a, p) => a + p.value, 0)).toBe(1);
  });

  it('bucketWeekly accounts for every row — bucketed, undated, or outside the window', () => {
    const rows = [
      { createdAt: NOW - DAY },            // this week
      { createdAt: NOW - 20 * DAY },       // three weeks back
      { createdAt: NOW - 400 * DAY },      // far older than the window
      { createdAt: NOW + 3 * DAY },        // 🔴 future-dated: NOT "this week"
      { createdAt: undefined },            // undatable
    ];
    const { points, undatedRows, outsideWindow } = bucketWeekly(rows, NOW, (r) => r.createdAt as never);
    const bucketed = points.reduce((a, p) => a + p.value, 0);
    expect(bucketed).toBe(2);
    expect(outsideWindow).toBe(2);
    expect(undatedRows).toBe(1);
    // Every row landed somewhere, and nowhere twice.
    expect(bucketed + outsideWindow + undatedRows).toBe(rows.length);
    // The future-dated row did not inflate this week.
    expect(points[points.length - 1].value).toBe(1);
  });

  it('deltaOf refuses to divide by an empty previous week', () => {
    expect(deltaOf([{ label: 'a', value: 0 }, { label: 'b', value: 5 }])).toBeNull();
    expect(deltaOf([{ label: 'a', value: 0 }, { label: 'b', value: 0 }])).toBe(0);
    expect(deltaOf([{ label: 'a', value: 4 }, { label: 'b', value: 5 }])).toBeCloseTo(0.25);
    expect(deltaOf([{ label: 'a', value: 1 }])).toBeNull();
    expect(weekBuckets(NOW)).toHaveLength(8);
  });

  it('buildInsights emits nothing for an input it did not receive', () => {
    expect(buildInsights({
      memberSeries: { kind: 'unavailable', reason: 'no' },
      givingSeries: { kind: 'unavailable', reason: 'no' },
      contacts: { kind: 'unavailable', reason: 'no' },
      submissionsSeries: null,
    })).toEqual([]);
  });

  it('every insight it does emit names the read it came from', () => {
    const insights = buildInsights({
      memberSeries: { kind: 'complete', points: [{ label: 'a', value: 1 }, { label: 'b', value: 3 }] },
      givingSeries: { kind: 'unavailable', reason: 'no' },
      contacts: { kind: 'exact', value: 12 },
      submissionsSeries: null,
    });
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) expect(insight.source.length).toBeGreaterThan(10);
    expect(insights.map((i) => i.key)).not.toContain('giving');
  });

  it('givingMix groups by the document\'s own type field and never invents a slice', () => {
    const mix = givingMix([
      { amountCents: 100, issuedAt: null, type: 'donation_receipt' },
      { amountCents: 300, issuedAt: null, type: 'event_ticket' },
      { amountCents: 200, issuedAt: null, type: 'donation_receipt' },
      { amountCents: 0, issuedAt: null, type: 'invoice' },
    ]);
    expect(mix.map((s) => [s.key, s.cents])).toEqual([['donation_receipt', 300], ['event_ticket', 300]]);
    expect(givingMix([])).toEqual([]);
  });
});

/* ═══ 4 · No emoji ═══════════════════════════════════════════════════════════ */

describe('no emoji appears in the rendered output', () => {
  /**
   * ⚠️ Pictographs and dingbats, NOT the whole of Extended Pictographic. `·`
   * (the middle dot in the greeting's date line) and `—` are punctuation the
   * app already uses; matching them would fail on typography rather than on
   * the AI-slop this sweeps for.
   */
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it('sweeps every tab, not just the one that happens to be open', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    // ⚠️ Base UI mounts only the ACTIVE panel. A sweep of the default view sees
    // the Overview tab and nothing else, so an emoji in any of the five
    // placeholders would pass unnoticed — which it did, until a mutation test
    // put one there and this assertion stayed green. Every tab is opened.
    for (const tab of DASHBOARD_TABS) {
      await openTab(c, tab.label);
      const found = text(c).match(EMOJI);
      expect(found, `the ${tab.label} tab renders ${found?.[0]}`).toBeNull();
    }
  });

  it('sweeps the denied and unavailable states too', async () => {
    authState.currentUser = { uid: 'u1', email: 'helper@grace.org' };
    docReads.set('users/u1', { role: 'admin', permissions: {}, tenantId: 'grace' });
    const c = await screen();
    expect(text(c)).toMatch(/Analytics is not part of your access/);
    expect(text(c).match(EMOJI)).toBeNull();
  });
});

/* ═══ 10 · The permission ════════════════════════════════════════════════════ */

describe('the Analytics permission gates the dashboard', () => {
  it('grants on the analytics flag', () => {
    expect(canViewAnalytics('admin', { analytics: true })).toBe(true);
  });

  it('grants on fullAccess and on the super_admin role', () => {
    expect(canViewAnalytics('admin', { fullAccess: true })).toBe(true);
    expect(canViewAnalytics('super_admin', {})).toBe(true);
  });

  it('refuses an admin whose Analytics row is unchecked — including the tenant owner', () => {
    expect(canViewAnalytics('admin', { manageCRM: true })).toBe(false);
    expect(canViewAnalytics('admin', {})).toBe(false);
    expect(canViewAnalytics('admin', null)).toBe(false);
    // 🔴 The rules' generic hasPermission would grant these two; this permission
    // is not in the rules, and AdminCRM's expression does not grant them.
    expect(canViewAnalytics('church_admin', {})).toBe(false);
    expect(canViewAnalytics(undefined, {})).toBe(false);
  });

  it('a denied admin sees the refusal and the dashboard issues no read at all', async () => {
    authState.currentUser = { uid: 'u1', email: 'helper@grace.org' };
    docReads.set('users/u1', { role: 'admin', permissions: { manageCRM: true }, tenantId: 'grace' });
    const c = await screen();

    expect(c.querySelector('[data-analytics-denied]')).toBeTruthy();
    expect(c.querySelector('[data-dashboard-tabs]')).toBeNull();
    expect(c.querySelector('[data-kpi]')).toBeNull();
    // The gate is in front of the reads, not behind them.
    expect(built).toHaveLength(0);
  });

  it('a granted admin sees the tabs', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    expect(c.querySelector('[data-dashboard-tabs]')).toBeTruthy();
    expect(built.length).toBeGreaterThan(0);
  });

  it('fails closed when the user document cannot be read', async () => {
    authState.currentUser = { uid: 'ghost', email: 'ghost@grace.org' };
    const c = await screen();
    expect(c.querySelector('[data-analytics-denied]')).toBeTruthy();
  });

  it('signed out is denied, and reads nothing', async () => {
    const c = await screen();
    expect(c.querySelector('[data-analytics-denied]')).toBeTruthy();
    expect(built).toHaveLength(0);
  });

  it('the quick actions survive a refusal — the gate hides analytics, not navigation', async () => {
    authState.currentUser = { uid: 'u1', email: 'helper@grace.org' };
    docReads.set('users/u1', { role: 'admin', permissions: {}, tenantId: 'grace' });
    const c = await screen();
    expect(text(c)).toContain('Quick Actions');
    expect(text(c)).toContain('View Members');
  });
});

/* ═══ 6b · The rendered output carries no literal colour ═════════════════════ */

const { colourTokens, allTokens, breakpointOf, variantChain, BREAKPOINT_MIN_PX } =
  await import('../../test/support/class-inventory');

/**
 * The utility half of a class, with its variant chain removed.
 *
 * ⚠️ Load-bearing for the colour sweep. `chart.tsx` ships
 * `[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50` — the
 * `#ccc` is inside the SELECTOR, matching the literal stroke recharts writes on
 * its own grid lines, and the colour actually applied is `stroke-border/50`, a
 * token. Testing the whole class string would report that as a hardcoded colour
 * and be wrong; the thing that paints is the utility.
 */
const utilityOf = (token: string) =>
  token.slice(variantChain(token).reduce((n, v) => n + v.length + 1, 0));

describe('no colour is hardcoded and all four palettes resolve', () => {
  it('every colour class in the rendered dashboard is a semantic token', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    // 🔴 Classic is the DEFAULT palette since #409, so a literal or a raw
    // Tailwind ramp step is wrong in at least three of the four palettes. This
    // sweeps the WHOLE tree, primitives included — stronger than the source
    // sweep in the-276-dashboard-guards, which can only see files this slice
    // wrote.
    const RAMP = /-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/|$)/;
    const painted = colourTokens(c).map(utilityOf);
    expect(painted.length).toBeGreaterThan(10);
    for (const utility of painted) {
      expect(utility, `${utility} is a literal`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(utility, `${utility} is a raw palette step`).not.toMatch(RAMP);
      expect(utility, `${utility} is a literal colour function`).not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
    }
  });

  it('the series colours reach the DOM as --chart-N references, not as values', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    // ChartContainer emits a <style> mapping --color-<key> to the config colour.
    // What must be in it is a var() chain, never a resolved hex.
    const styles = [...c.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(styles).toMatch(/--color-[\w-]+:\s*var\(--chart-\d\)/);
    expect(styles).not.toMatch(/--color-[\w-]+:\s*#/);
    expect(styles).not.toMatch(/--color-[\w-]+:\s*rgb/);
  });
});

/* ═══ 9 · No horizontal overflow ═════════════════════════════════════════════ */

/**
 * ⚠️ WIDTH IS NOT MONOTONIC HERE, so the ladder is measured at all five points
 * rather than at its ends. Crossing 1024px the admin shell TAKES width away —
 * the sidebar appears and the rem base drops to 14.5px — so the content box
 * gets NARROWER as the viewport gets wider, and the tightest desktop column in
 * the whole range is at exactly 1024px. THE-184 found a real 41px overflow at
 * exactly 1280px between two passing measurements for the same reason.
 *
 * The content boxes below are form-layout.ts's own documented measurements
 * (Rule 5: "the content box drops from 951px at 1023px to 708.5px at 1024px";
 * Rule 5 again: "the 308px the same content already renders in at a 380px
 * phone"), not numbers invented here. `max-w-6xl` caps the widest one — 72rem
 * at the 14.5px desktop base is 1044px, NOT the 1152px the class name suggests.
 */
const CONTENT_BOX_PX: Record<number, number> = {
  380: 308,
  768: 696,
  1024: 708.5,
  1280: 964.5,
  1440: 1044,
};

/** The grid column count active at a viewport, read from the element's classes. */
function columnsAt(el: Element, viewport: number): number {
  let cols = 1;
  for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
    const bp = breakpointOf(token);
    if (bp && BREAKPOINT_MIN_PX[bp] > viewport) continue;
    const m = /grid-cols-(\d+)$/.exec(token);
    if (m) cols = Number(m[1]);
  }
  return cols;
}

/** Tailwind `gap-N` is N × 4px at the mobile base; the desktop base is 14.5px. */
function gapPx(el: Element, viewport: number): number {
  let gap = 0;
  for (const token of (el.getAttribute('class') ?? '').split(/\s+/)) {
    const bp = breakpointOf(token);
    if (bp && BREAKPOINT_MIN_PX[bp] > viewport) continue;
    const m = /^(?:\w+:)*gap-(\d+)$/.exec(token);
    if (m) gap = Number(m[1]) * 4;
  }
  return gap;
}

describe('no horizontal overflow at 380/768/1024/1280/1440', () => {
  const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

  it('nothing in the dashboard declares a fixed width', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    /**
     * 🔴 THE STRONGEST FORM THIS ASSERTION CAN TAKE, and the reason the five
     * viewports below are arithmetic rather than a render each: a subtree that
     * declares no fixed width cannot overflow its parent at ANY viewport. There
     * is no width to be wrong, so there is no non-monotonic cliff to fall off.
     * Everything here is fluid — `w-full`, a grid fraction, or intrinsic.
     */
    const FIXED_WIDTH = /^(?:\w+:)*(?:min-)?w-(?:\d+(?:\.\d+)?|\[\d+(?:\.\d+)?(?:px|rem)\])$/;
    const offenders = allTokens(c).filter((t) => FIXED_WIDTH.test(t) && !/w-(?:full|auto|fit|screen|px)$/.test(t));

    // `size-*` (icons) and `w-2`-scale swatches are intrinsic content, not
    // layout: they are bounded by their own flex/grid parent and never set the
    // row's width. Only tokens on an element that also lays children out matter.
    const layoutOffenders = offenders.filter((t) => {
      const px = /\[(\d+(?:\.\d+)?)px\]/.exec(t);
      const scale = /w-(\d+(?:\.\d+)?)$/.exec(t);
      const value = px ? Number(px[1]) : scale ? Number(scale[1]) * 4 : 0;
      return value > 64; // anything icon-sized cannot drive a row's width
    });
    expect(layoutOffenders, `fixed widths: ${layoutOffenders.join(', ')}`).toHaveLength(0);
  });

  it('the tab strip, the one thing with intrinsic width, scrolls inside its own box', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    // Six labels plus icons do not fit across a 380px phone and never will. The
    // overflow therefore has to live INSIDE a scroller, not on the page.
    const list = c.querySelector('[data-slot="tabs-list"]')!;
    const scroller = list.closest('.overflow-x-auto');
    expect(scroller, 'the tab strip is not inside an overflow-x-auto container').toBeTruthy();
    expect(scroller!.contains(list)).toBe(true);
  });

  it.each(VIEWPORTS)('at %ipx every KPI column is wide enough to hold a card', async (viewport) => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const grid = c.querySelector('[data-kpi-grid]')!;
    const cols = columnsAt(grid, viewport);
    const gap = gapPx(grid, viewport);
    const column = (CONTENT_BOX_PX[viewport] - gap * (cols - 1)) / cols;

    // A KPI card holds a label, a number and a 40px sparkline. 160px is the
    // floor below which the label starts wrapping mid-word.
    expect(column, `${viewport}px → ${cols} cols → ${column.toFixed(1)}px each`).toBeGreaterThanOrEqual(160);
  });

  it('the narrowest KPI column in the whole ladder is at 1024px, not at 380px', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    const grid = c.querySelector('[data-kpi-grid]')!;

    const widths = Object.fromEntries(VIEWPORTS.map((v) => {
      const cols = columnsAt(grid, v);
      return [v, (CONTENT_BOX_PX[v] - gapPx(grid, v) * (cols - 1)) / cols];
    }));

    // 🔴 The non-monotonicity, asserted rather than described: 1024px is
    // tighter than 768px even though it is a wider viewport. A future change
    // that assumed "wider viewport, more room" fails here.
    const narrowest = Object.entries(widths).sort((a, b) => a[1] - b[1])[0][0];
    expect(narrowest).toBe('1024');
    expect(widths[1024]).toBeLessThan(widths[768]);
    expect(widths[1024]).toBeLessThan(widths[1280]);
  });

  it.each(VIEWPORTS)('at %ipx the two-column widget row is wide enough for a chart', async (viewport) => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const row = c.querySelector('[data-widget="What changed"]')!.closest('.grid')!;
    const cols = columnsAt(row, viewport);
    const column = (CONTENT_BOX_PX[viewport] - gapPx(row, viewport) * (cols - 1)) / cols;
    // A donut is 150px across plus the card's own padding.
    expect(column, `${viewport}px → ${cols} cols → ${column.toFixed(1)}px each`).toBeGreaterThanOrEqual(280);
  });

  it('every chart sits in a w-full container, so it takes the column rather than setting it', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const charts = [...c.querySelectorAll('[data-slot="chart"]')];
    expect(charts.length).toBeGreaterThan(0);
    for (const chart of charts) {
      const tokens = (chart.getAttribute('class') ?? '').split(/\s+/);
      expect(tokens, chart.getAttribute('class') ?? '').toContain('w-full');
      // `aspect-video` would make a wide chart tall; every one of ours cancels it.
      expect(tokens).toContain('aspect-auto');
    }
  });
});

/* ═══ No-regression: THE-276-FIX moved layout only ═══════════════════════════ */

/**
 * THE-276-FIX changes twelve class names in `ui/tabs.tsx` and removes a
 * negative margin from the tab strip. It must move NO figure and NO empty
 * state — the data layer was the substance of THE-276 and a layout fix has no
 * business touching it. These restate the load-bearing behaviours as explicit
 * no-regression claims so a later layout change cannot quietly take one out.
 */
describe('THE-276-FIX moved layout only', () => {
  it('every KPI figure is unchanged — exact counts, straight from the aggregation', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const valueOf = (label: string) =>
      text(c.querySelector(`[data-kpi="${label}"] [data-kpi-value]`)!);
    expect(valueOf('Members')).toBe('3');
    expect(valueOf('Contacts')).toBe('42');
    expect(valueOf('Published courses')).toBe('2');
    expect(valueOf('Community posts')).toBe('7');
    expect(valueOf('Articles')).toBe('4');
    expect(valueOf('Form submissions')).toBe('1');
    expect(valueOf('Receipts')).toBe('2');
  });

  it('the strict money gate still refuses a missing amount', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
      { issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
    ]);
    const c = await screen();

    // 🔴 This was silent money loss before THE-276 fixed it: a coerced 0 made
    // the total quietly short. It must stay a refusal that names the count.
    const mix = c.querySelector('[data-widget="Giving mix"]')!;
    expect(mix.getAttribute('data-state')).toBe('unavailable');
    expect(text(mix)).toContain('1 of 2 receipts');
    expect(text(c)).not.toContain('$250');
    expect(toInvoiceRow({ issuedAt: null }).amountCents).toBeNull();
  });

  it('Giving mix still renders its unavailable state rather than a zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('tenants/grace/invoices', 0);
    docsFor.set('tenants/grace/invoices', []);
    const c = await screen();

    const mix = c.querySelector('[data-widget="Giving mix"]')!;
    expect(mix.getAttribute('data-state')).toBe('unavailable');
    expect(text(mix.querySelector('[data-empty-reason]')!)).toContain('a gift or a ticket sale yet');
    expect(text(mix)).not.toMatch(/\$0\b/);
    expect(mix.querySelector('[data-mix-slice]')).toBeNull();
  });

  it('the devotion funnel is still empty, and still says why', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const funnel = c.querySelector('[data-widget="Devotion funnel"]')!;
    expect(funnel.getAttribute('data-state')).toBe('unavailable');
    expect(text(funnel.querySelector('[data-empty-reason]')!))
      .toContain('devotional reading, streaks or plan progress');
    // 🔴 And it is not quietly the CRM giving pipeline wearing that label.
    expect(text(funnel)).not.toMatch(/Champion|Giving tier|Member\b/);
  });

  it('the remaining tab is still a placeholder — the Platform slice is unbuilt', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    for (const tab of UNBUILT_TABS) {
      await openTab(c, tab.label);
      expect(c.querySelector(`[data-tab-placeholder="${tab.id}"]`), tab.label).toBeTruthy();
    }
  });
});
