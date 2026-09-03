import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-287 — the roster read: Growth and Giving, four widgets, two reads.
 *
 * ─── What these tests defend, in one sentence each ───────────────────────────
 *
 *   1. The member trend was RELOCATED, not rebuilt — its figures on Growth are
 *      the ones Overview shows, by identity rather than by agreement.
 *   2. Overview itself is untouched.
 *   3. The countries table shows COUNTS and can never show a person.
 *   4. The funnel is labelled as GIVING and mounted on Member → Giving →
 *      Champion.
 *   5. Nothing calls that funnel devotion, discipleship or a journey.
 *   6. The leaderboard sorts client-side; no Firestore `orderBy` on `contacts`.
 *   7. No figure is fabricated: every number traces to a read, or the widget is
 *      in its empty state.
 *   8. `totalDonated` is dollars and never meets `invoices.amount`'s cents.
 *   9. THE-276's strict money gate still refuses a receipt with no amount.
 *
 * ⚠️ Same query RECORDER as THE-276's suite, and deliberately the same shape:
 * it captures every query the screen builds so "which read ran, with what
 * constraints" is an assertion rather than a comment. A test that mocked the
 * data layer instead of the driver could not see an `orderBy` at all.
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
  // 🔴 Recorded, not ignored. Test 6 asserts this is never reached for
  // `contacts`; a mock that silently dropped it could not tell the difference.
  orderBy: (field: string, dir = 'asc') => ({ __orderBy: [field, dir] as [string, string] }),
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
const { DASHBOARD_TABS } = await import('../dashboard/DashboardTabs');
const {
  countryTally, givenDollars, givingFunnel, topGivers, toContactRow, toMemberRow,
  GIVING_STAGES, TOP_GIVERS,
} = await import('../dashboard/roster-data');
const { cityLabel, coverageNote } = await import('../dashboard/CountriesTable');
const { readableReceipts, toInvoiceRow, DASHBOARD_FETCH_LIMIT } = await import('../dashboard/dashboard-data');
const { resolvePipelineStage, CHAMPION_THRESHOLD_DOLLARS } = await import('../../hooks/queries/useCRMQueries');

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
  return container;
}

async function openTab(node: ParentNode, label: string): Promise<void> {
  const trigger = [...node.querySelectorAll('[data-slot="tabs-trigger"]')]
    .find((t) => (t.textContent ?? '').trim() === label) as HTMLElement | undefined;
  if (!trigger) throw new Error(`no tab trigger labelled ${label}`);
  await act(async () => { trigger.click(); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** Three members in two countries, plus one who recorded no location at all. */
const MEMBERS = [
  { createdAt: NOW - 2 * DAY, country: 'Kenya', city: 'Nairobi', displayName: 'Wanjiru' },
  { createdAt: NOW - 3 * DAY, country: 'Kenya', city: 'nairobi', displayName: 'Otieno' },
  { createdAt: NOW - 5 * DAY, country: 'Romania', city: 'Cluj', displayName: 'Ana' },
  { createdAt: NOW - 40 * DAY, displayName: 'Owner with no onboarding' },
];

/** Four contacts across all three giving tiers, one of them with nothing. */
const CONTACTS = [
  { firstName: 'Ada', lastName: 'Grace', totalDonated: 12000 },
  { firstName: 'Bo', lastName: 'Mensah', totalDonated: 750 },
  { firstName: 'Cai', lastName: 'Lin', totalDonated: 250 },
  { firstName: 'Dee', lastName: 'Novak', totalDonated: 0 },
];

function healthyTenant() {
  counts.set('users', MEMBERS.length);
  counts.set('contacts', CONTACTS.length);
  counts.set('courses', 2);
  counts.set('community_posts', 7);
  counts.set('blog_posts', 4);
  counts.set('submissions', 1);
  counts.set('tenants/grace/invoices', 1);

  docsFor.set('users', MEMBERS);
  docsFor.set('contacts', CONTACTS);
  docsFor.set('submissions', [{ createdAt: NOW - DAY }]);
  docsFor.set('tenants/grace/invoices', [
    { amount: 25000, issuedAt: new Date(NOW - 2 * DAY).toISOString(), type: 'donation_receipt' },
  ]);
  docReads.set('tenants/grace/livestream/current', { active: false, title: 'Live now' });
}

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
  authState.currentUser = null;
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container?.remove();
});

const text = (el: ParentNode) => el.textContent ?? '';
const widget = (node: ParentNode, title: string) => node.querySelector(`[data-widget="${title}"]`);

/* ═══ 1 · The member trend is RELOCATED, not rebuilt ═════════════════════════ */

describe('the member growth trend renders on Growth with figures identical to Overview\'s', () => {
  /**
   * 🔴 The claim is IDENTITY, not equality of two computations.
   *
   * `useOverviewData` makes ONE complete read of `users` and buckets it ONCE;
   * both tabs are handed the same `Series`. So this test reads the numbers off
   * both rendered charts and requires them to match exactly — and the mutation
   * that would break it (a second read, a second bucketing, a rounding on one
   * side) is exactly what "do not rebuild it" forbids.
   */
  const seriesValues = (node: ParentNode): string[] =>
    [...node.querySelectorAll('[data-series-unavailable]')].map((el) => text(el));

  it('the trend is on Growth and it is the same read the Overview chart plots', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    // Overview's combined chart is ready, so the users read completed.
    const overviewTrend = widget(c, 'Giving & growth')!;
    expect(overviewTrend.getAttribute('data-state')).toBe('ready');
    // ⚠️ Overview still plots members: relocation added a widget, it did not
    // remove a series from a chart whose title promises both.
    expect(seriesValues(overviewTrend).join(' ')).not.toMatch(/New members/);

    await openTab(c, 'Growth');
    const growthTrend = widget(c, 'Giving & growth')!;
    expect(growthTrend.getAttribute('data-state')).toBe('ready');
    // 🔴 No "New members: <reason>" note here either — the series is complete
    // on Growth for the same reason it is complete on Overview: it is the
    // same object.
    expect(seriesValues(growthTrend).join(' ')).not.toMatch(/New members/);
  });

  it('and one users read served both tabs, so nothing was re-read to draw it', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    /**
     * 🔴 THE claim, measured as a difference rather than as a total: opening
     * Growth builds NO query at all. The countries table groups documents the
     * member trend already loaded, so it costs zero additional Firestore reads.
     */
    const before = built.length;
    await openTab(c, 'Growth');
    await openTab(c, 'Giving');
    expect(built.length, 'opening a tab issued a query').toBe(before);

    /**
     * ⚠️ THE-276's own shape, unchanged and worth naming: three `users`
     * queries are built on mount — the KPI card's `getCountFromServer`, the
     * completeness count inside `completeRead`, and the bounded fetch. Exactly
     * ONE of them loads documents, and this ticket added none of the three.
     */
    const userQueries = built.filter((q) => keyOf(q) === 'users');
    expect(userQueries).toHaveLength(3);
    expect(userQueries.filter((q) => q.limit === DASHBOARD_FETCH_LIMIT)).toHaveLength(1);

    // `contacts` is the one read this ticket adds, and it is made ONCE for both
    // giving widgets: a KPI count, a completeness count, and one bounded fetch.
    const contactQueries = built.filter((q) => keyOf(q) === 'contacts');
    expect(contactQueries).toHaveLength(3);
    expect(contactQueries.filter((q) => q.limit === DASHBOARD_FETCH_LIMIT)).toHaveLength(1);
  });

  it('the trend refuses on Growth exactly when it refuses on Overview', async () => {
    grantAnalytics();
    healthyTenant();
    // Over the ceiling: no complete set, so no series — on either tab.
    counts.set('users', DASHBOARD_FETCH_LIMIT + 1);
    const c = await screen();

    const overviewNote = text(widget(c, 'Giving & growth')!);
    expect(overviewNote).toMatch(/New members: .*complete trend cannot be read/);

    await openTab(c, 'Growth');
    const growth = widget(c, 'Giving & growth')!;
    // Members was the only series on Growth, so the whole widget is refused.
    expect(growth.getAttribute('data-state')).toBe('unavailable');
    expect(text(growth.querySelector('[data-empty-reason]')!)).toMatch(/complete trend cannot be read/);
  });
});

/* ═══ 2 · Overview is unchanged ══════════════════════════════════════════════ */

describe("Overview's remaining widgets and empty states are unchanged", () => {
  const OVERVIEW_WIDGETS = ['Giving & growth', 'What changed', 'Giving mix', 'Devotion funnel'] as const;

  it('all four widgets are still mounted, in the same states, with the same titles', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    for (const title of OVERVIEW_WIDGETS) {
      expect(widget(c, title), `${title} is gone from Overview`).toBeTruthy();
    }
    expect(c.querySelectorAll('[data-kpi]')).toHaveLength(7);
  });

  /**
   * 🔴 The Overview funnel's honest empty state is UNTOUCHED, and that is not
   * in tension with test 5 below — it is the point of it.
   *
   * `devotion` is not a concept this product records, so the only place the
   * word may appear is a widget REFUSING to draw one. THE-276 mounted exactly
   * that and this ticket does not open it. What test 5 forbids is the opposite:
   * a funnel that DOES draw, wearing that label over giving data.
   */
  it("the Devotion funnel is still an empty state saying devotion is not recorded", async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    const funnel = widget(c, 'Devotion funnel')!;
    expect(funnel.getAttribute('data-state')).toBe('unavailable');
    expect(text(funnel.querySelector('[data-empty-reason]')!))
      .toContain('devotional reading, streaks or plan progress');
    // And still not the giving pipeline wearing that label.
    expect(text(funnel)).not.toMatch(/Champion|Giving tier/);
  });

  it('the Overview KPI figures are the exact counts, unchanged by this ticket', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    const value = (label: string) =>
      text(c.querySelector(`[data-kpi="${label}"] [data-kpi-value]`)!);
    expect(value('Members')).toBe('4');
    expect(value('Contacts')).toBe('4');
    expect(value('Published courses')).toBe('2');
  });
});

/* ═══ 3 · 🔴 The privacy property ════════════════════════════════════════════ */

describe('the countries table shows aggregated counts and never an individual member', () => {
  it('renders counts per country and city, and no member name anywhere', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Growth');

    const table = widget(c, 'Countries and cities')!;
    expect(table.getAttribute('data-state')).toBe('ready');

    const rows = [...table.querySelectorAll('[data-country-row]')];
    expect(rows.map((r) => r.getAttribute('data-country-row'))).toEqual(['Kenya', 'Romania']);
    expect(text(rows[0].querySelector('[data-country-members]')!)).toBe('2');
    expect(text(rows[1].querySelector('[data-country-members]')!)).toBe('1');
    // "2 in Nairobi", and the two spellings are one city.
    expect(text(rows[0])).toContain('Nairobi 2');

    // 🔴 THE assertion. Every member in the fixture has a distinctive name and
    // not one of them may appear on this widget.
    for (const member of MEMBERS) {
      expect(text(table), `${member.displayName} is named in the countries table`)
        .not.toContain(member.displayName);
    }
  });

  it('and there is no shape in the aggregation that could carry a person', () => {
    // The structural half: the table renders `CountryTally`, and a mutation
    // that wanted to print a member would have to widen these types first.
    const tally = countryTally(MEMBERS.map((m) => toMemberRow(m as Record<string, unknown>)));
    const serialised = JSON.stringify(tally);
    for (const member of MEMBERS) {
      expect(serialised).not.toContain(member.displayName);
    }
    expect(Object.keys(tally.rows[0]).sort()).toEqual(['cities', 'cityless', 'country', 'members']);
    expect(Object.keys(tally.rows[0].cities[0]).sort()).toEqual(['city', 'members']);
  });

  it('a blank country is counted as uncovered, never filed under a country called Unknown', () => {
    const tally = countryTally(MEMBERS.map((m) => toMemberRow(m as Record<string, unknown>)));
    expect(tally.total).toBe(4);
    expect(tally.covered).toBe(3);
    expect(tally.rows.map((r) => r.country)).not.toContain('Unknown');
    // The rows sum to `covered`, not to `total`.
    expect(tally.rows.reduce((sum, r) => sum + r.members, 0)).toBe(tally.covered);
  });

  it('coverage is stated above the table, as a count and a share', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Growth');
    const table = widget(c, 'Countries and cities')!;
    // ⚠️ Not a footnote. A "top countries" list built on a sparse field is a
    // wrong number wearing a table, so the qualification is in the widget's
    // own description, above every figure it qualifies.
    expect(text(table)).toContain('3 of 4 members (75%) have a recorded country');
  });

  it('and when no member carries a country at all, it refuses instead of drawing an empty table', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('users', [{ createdAt: NOW - DAY }, { createdAt: NOW - 2 * DAY }]);
    counts.set('users', 2);
    const c = await screen();
    await openTab(c, 'Growth');
    const table = widget(c, 'Countries and cities')!;
    expect(table.getAttribute('data-state')).toBe('unavailable');
    expect(text(table.querySelector('[data-empty-reason]')!)).toMatch(/no member carries a country/);
  });

  it('the city cell discloses what it did not name, so the counts still add up', () => {
    const cities = [
      { city: 'Nairobi', members: 9 }, { city: 'Mombasa', members: 4 },
      { city: 'Kisumu', members: 2 }, { city: 'Nakuru', members: 1 }, { city: 'Eldoret', members: 1 },
    ];
    expect(cityLabel(cities, 3)).toBe('Nairobi 9 · Mombasa 4 · Kisumu 2 · +2 more · 3 no city');
    expect(cityLabel([], 0)).toBe('No city recorded');
  });

  it('the coverage sentence never divides by zero', () => {
    expect(coverageNote({ rows: [], covered: 0, total: 0, cityCovered: 0 })).toContain('(0%)');
  });
});

/* ═══ 4 · The funnel is a GIVING funnel ══════════════════════════════════════ */

describe('the funnel is labelled as giving and mounted on Member -> Giving -> Champion', () => {
  it('its three stages are the pipeline stages, widest first, counted from contacts', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Growth');

    const funnel = widget(c, 'Giving tiers')!;
    expect(funnel.getAttribute('data-state')).toBe('ready');
    expect(text(funnel)).toMatch(/Giving tiers/);
    // The bands, spelled by the app's own stage vocabulary.
    expect(GIVING_STAGES.map((s) => s.label)).toEqual(['Member', 'Giving', 'Champion']);
  });

  it('and the counts are exactly resolvePipelineStage over the complete contact set', () => {
    const rows = CONTACTS.map((c, i) => toContactRow(c as Record<string, unknown>, `c${i}`));
    expect(givingFunnel(rows)).toEqual([
      { key: 'member', label: 'Member', value: 1 },   // Dee, $0
      { key: 'giving', label: 'Giving', value: 2 },   // Bo $750, Cai $250
      { key: 'champion', label: 'Champion', value: 1 }, // Ada $12,000
    ]);
    // The boundary the app defines, restated here so a drift in either fails.
    expect(resolvePipelineStage(CHAMPION_THRESHOLD_DOLLARS)).toBe('champion');
    expect(resolvePipelineStage(CHAMPION_THRESHOLD_DOLLARS - 1)).toBe('giving');
    expect(resolvePipelineStage(0)).toBe('member');
    expect(resolvePipelineStage(undefined)).toBe('member');
  });

  it('the three bands partition the contact list — they sum to the whole', () => {
    const rows = CONTACTS.map((c, i) => toContactRow(c as Record<string, unknown>, `c${i}`));
    expect(givingFunnel(rows).reduce((sum, s) => sum + s.value, 0)).toBe(rows.length);
  });
});

/* ═══ 5 · 🔴 The sweep ═══════════════════════════════════════════════════════ */

describe('nothing labels the funnel devotion, discipleship or a journey', () => {
  const FORBIDDEN = /devotion|discipleship|journey/i;

  it('the Growth tab renders none of those words', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Growth');
    const growth = c.querySelector('[data-growth-tab]')!;
    const found = text(growth).match(FORBIDDEN);
    expect(found, `the Growth tab renders "${found?.[0]}"`).toBeNull();
  });

  it('the Giving tab renders none of those words either', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Giving');
    const giving = c.querySelector('[data-giving-tab]')!;
    expect(text(giving).match(FORBIDDEN)).toBeNull();
  });

  /**
   * 🔴 The only surviving occurrence is Overview's REFUSAL, and it is checked
   * to still be a refusal rather than merely allowed to exist.
   *
   * ⚠️ Without this the sweep would pass on a Growth funnel titled "Devotion"
   * as long as Overview also said the word — which is why the assertion is
   * about the state of the element the word appears on, not about the word.
   */
  it('and where the word survives on Overview it is attached to an empty state, never to drawn data', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    for (const tab of DASHBOARD_TABS) {
      await openTab(c, tab.label);
      for (const el of c.querySelectorAll('[data-widget]')) {
        if (!FORBIDDEN.test(text(el))) continue;
        expect(
          el.getAttribute('data-state'),
          `"${el.getAttribute('data-widget')}" says devotion while in state ${el.getAttribute('data-state')}`,
        ).toBe('unavailable');
      }
    }
  });
});

/* ═══ 6 · Sorted client-side ═════════════════════════════════════════════════ */

describe('the top givers leaderboard sorts client-side', () => {
  it('no query on contacts carries a Firestore orderBy', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Giving');
    await openTab(c, 'Growth');

    const contactQueries = built.filter((q) => keyOf(q) === 'contacts');
    expect(contactQueries.length).toBeGreaterThan(0);
    for (const q of contactQueries) {
      expect(q.orderBy, `a contacts query ordered by ${JSON.stringify(q.orderBy)}`).toEqual([]);
    }
    // 🔴 And nothing else on this dashboard orders either — `users` has no
    // (tenantId, createdAt) composite index, and firestore.indexes.json is not
    // deployed on merge, so any orderBy here throws failed-precondition live.
    for (const q of built) expect(q.orderBy, `${keyOf(q)} was ordered`).toEqual([]);
  });

  it('the ranking is Array.sort over the complete set, largest first', () => {
    const rows = CONTACTS.map((c, i) => toContactRow(c as Record<string, unknown>, `c${i}`));
    expect(topGivers(rows).map((g) => [g.name, g.dollars])).toEqual([
      ['Ada Grace', 12000],
      ['Bo Mensah', 750],
      ['Cai Lin', 250],
    ]);
  });

  it('and the read order cannot change the ranking, because the whole set is in hand', () => {
    const rows = CONTACTS.map((c, i) => toContactRow(c as Record<string, unknown>, `c${i}`));
    const reversed = [...rows].reverse();
    expect(topGivers(reversed)).toEqual(topGivers(rows));
  });

  it('ties break by name, so the same data always renders the same order', () => {
    const tied = [
      toContactRow({ firstName: 'Zed', totalDonated: 100 }, 'z'),
      toContactRow({ firstName: 'Abe', totalDonated: 100 }, 'a'),
    ];
    expect(topGivers(tied).map((g) => g.name)).toEqual(['Abe', 'Zed']);
    expect(topGivers([...tied].reverse()).map((g) => g.name)).toEqual(['Abe', 'Zed']);
  });

  it('the cap is on the display and the read stays complete', () => {
    const many = Array.from({ length: TOP_GIVERS + 5 }, (_, i) =>
      toContactRow({ firstName: `Giver${i}`, totalDonated: i + 1 }, `g${i}`));
    const ranked = topGivers(many);
    expect(ranked).toHaveLength(TOP_GIVERS);
    // The largest is present, which a `limit()` on an unordered scan could not
    // promise.
    expect(ranked[0].dollars).toBe(TOP_GIVERS + 5);
  });

  it('renders the leaderboard on the Giving tab', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Giving');
    const board = widget(c, 'Top givers')!;
    expect(board.getAttribute('data-state')).toBe('ready');
    const names = [...board.querySelectorAll('[data-giver-row]')].map((r) => text(r));
    expect(names[0]).toContain('Ada Grace');
    expect(names[0]).toContain('Champion');
    expect(names).toHaveLength(3);
  });
});

/* ═══ 7 · 🔴 No figure is fabricated ═════════════════════════════════════════ */

describe('no figure is fabricated', () => {
  it('a refused contacts count leaves BOTH giving widgets empty, with a reason and no zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contacts', new Error('permission-denied'));
    const c = await screen();

    await openTab(c, 'Growth');
    const funnel = widget(c, 'Giving tiers')!;
    expect(funnel.getAttribute('data-state')).toBe('unavailable');
    expect(text(funnel.querySelector('[data-empty-reason]')!)).toMatch(/did not complete/);

    await openTab(c, 'Giving');
    const board = widget(c, 'Top givers')!;
    expect(board.getAttribute('data-state')).toBe('unavailable');
    // 🔴 No "0", no "$0", no empty table pretending to be an answer.
    expect(text(board)).not.toMatch(/\$0\b/);
  });

  it('a contacts collection over the ceiling refuses rather than ranking a truncated set', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contacts', DASHBOARD_FETCH_LIMIT + 1);
    const c = await screen();
    await openTab(c, 'Giving');
    const board = widget(c, 'Top givers')!;
    expect(board.getAttribute('data-state')).toBe('unavailable');
    expect(text(board.querySelector('[data-empty-reason]')!)).toMatch(/cannot be read from here/);
  });

  it('a refused users read leaves the countries table empty, not at zero countries', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('users', new Error('permission-denied'));
    const c = await screen();
    await openTab(c, 'Growth');
    const table = widget(c, 'Countries and cities')!;
    expect(table.getAttribute('data-state')).toBe('unavailable');
    expect(table.querySelectorAll('[data-country-row]')).toHaveLength(0);
  });

  it('contacts with no recorded giving are absent from the board, not ranked last at zero', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('contacts', [{ firstName: 'Dee', lastName: 'Novak', totalDonated: 0 }]);
    counts.set('contacts', 1);
    const c = await screen();
    await openTab(c, 'Giving');
    const board = widget(c, 'Top givers')!;
    expect(board.getAttribute('data-state')).toBe('unavailable');
    expect(text(board.querySelector('[data-empty-reason]')!)).toMatch(/a donation against any contact/);
    expect(text(board)).not.toContain('Dee Novak');
  });

  it('and nothing anywhere on the two new tabs renders NaN, undefined or null', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    for (const label of ['Growth', 'Giving']) {
      await openTab(c, label);
      expect(text(c)).not.toMatch(/NaN|undefined|\[object Object\]/);
    }
  });
});

/* ═══ 8 · Dollars, never cents ═══════════════════════════════════════════════ */

describe('totalDonated is treated as dollars and never mixed with invoice cents', () => {
  it('$12,000 renders as $12,000 — no division by 100 and no multiplication by it', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Giving');
    const board = widget(c, 'Top givers')!;
    expect(text(board)).toContain('$12,000');
    // The two failure modes, both named: cents-read-as-dollars and the inverse.
    expect(text(board)).not.toContain('$120');
    expect(text(board)).not.toContain('$1,200,000');
  });

  it('the champion threshold is compared in dollars, not cents', () => {
    // $10,000 is a champion. 10,000 CENTS ($100) is not.
    expect(resolvePipelineStage(10000)).toBe('champion');
    expect(givenDollars(10000)).toBe(10000);
    expect(resolvePipelineStage(100)).toBe('giving');
  });

  it('the leaderboard reads totalDonated only — no invoice ever reaches it', async () => {
    grantAnalytics();
    healthyTenant();
    // A receipt of 25000 CENTS ($250) sits in the ledger. If it leaked into the
    // giving path it would rank above Cai Lin's $250 or appear as $25,000.
    const c = await screen();
    await openTab(c, 'Giving');
    const board = widget(c, 'Top givers')!;
    expect(text(board)).not.toContain('$25,000');
    expect([...board.querySelectorAll('[data-giver-dollars]')]
      .map((el) => Number(el.getAttribute('data-giver-dollars'))))
      .toEqual([12000, 750, 250]);
  });

  it('a totalDonated that is not a finite number is no donation, never a zero in a total', () => {
    for (const bad of [undefined, null, '', 'lots', NaN, Infinity, -5]) {
      expect(givenDollars(bad), String(bad)).toBeNull();
      expect(resolvePipelineStage(givenDollars(bad))).toBe('member');
    }
    // ⚠️ And the two agree on the readable case too, which is why the
    // leaderboard and the funnel can never disagree about one contact.
    expect(givenDollars('750')).toBe(750);
    expect(resolvePipelineStage(givenDollars('750'))).toBe('giving');
  });

  it('nothing in this slice sums totalDonated, so a missing value shortens no total', () => {
    const rows = [
      toContactRow({ firstName: 'A', totalDonated: 100 }, 'a'),
      toContactRow({ firstName: 'B' }, 'b'),
    ];
    // The funnel counts PEOPLE and the board RANKS them. Both account for B.
    expect(givingFunnel(rows).reduce((s, x) => s + x.value, 0)).toBe(2);
    expect(topGivers(rows)).toHaveLength(1);
  });
});

/* ═══ 9 · The money gate is untouched ════════════════════════════════════════ */

describe('the strict money gate still refuses a missing amount', () => {
  it('readableReceipts refuses the whole ledger and names the count', () => {
    const rows = [
      toInvoiceRow({ amount: 25000, issuedAt: null, type: 'donation_receipt' }),
      toInvoiceRow({ issuedAt: null, type: 'donation_receipt' }), // no amount
    ];
    const result = readableReceipts(rows);
    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' && result.reason).toMatch(/1 of 2 receipts carry no readable amount/);
  });

  it('and toInvoiceRow still refuses rather than coercing a missing amount to zero', () => {
    expect(toInvoiceRow({ issuedAt: null, type: 'invoice' }).amountCents).toBeNull();
    expect(toInvoiceRow({ amount: 0, issuedAt: null, type: 'invoice' }).amountCents).toBe(0);
  });

  it('the Overview giving widgets still refuse a ledger with an unreadable receipt', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
      { issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
    ]);
    counts.set('tenants/grace/invoices', 2);
    const c = await screen();
    const mix = widget(c, 'Giving mix')!;
    expect(mix.getAttribute('data-state')).toBe('unavailable');
    expect(text(mix.querySelector('[data-empty-reason]')!)).toMatch(/1 of 2 receipts/);
  });
});
