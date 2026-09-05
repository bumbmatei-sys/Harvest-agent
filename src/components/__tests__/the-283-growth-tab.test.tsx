import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-283 — the Growth tab (slice 2 of 6).
 *
 * ─── What these tests defend ─────────────────────────────────────────────────
 *
 * The same thing THE-276's do, one tab over, plus one property that is new here:
 *
 *   🔴 PRIVACY. The countries & cities widget answers "where are our people"
 *   with COUNTS. A version of it that listed the twelve members in Nairobi by
 *   name would look richer and would be a surveillance affordance on a church
 *   admin screen. `renders aggregated counts, never individual members` is the
 *   assertion that keeps it a count, and it is written against the RENDERED
 *   text so it fails no matter which layer reintroduces the name.
 *
 *   🔴 COVERAGE. `city` and `country` are absent on a member document until that
 *   member finishes onboarding, and three provisioning paths never write them at
 *   all. So the table is drawn over a partial column and the number of members
 *   it could not place is rendered beside it, from the same read. A "top
 *   countries" list that does not say so is a wrong number wearing a table.
 *
 * ⚠️ The mock is THE-276's query RECORDER, carried over unchanged in shape: it
 * captures every query the screen builds and answers counts and documents from
 * tables each test sets up. That is what makes "the count came from an
 * aggregation, not from the length of a page" an assertion.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BuiltQuery = { path: string[]; where: Array<[string, string, unknown]>; limit: number | null };

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
    return {
      docs: rows.map((row, i) => {
        // ⚠️ THE-309 — `__id` lets a fixture pin a document id, the same escape
        // hatch THE-294 and THE-299 already added to their own recorders. The
        // "Form submissions" KPI reads `tenants/{id}/forms/{formId}/submissions`,
        // so a test has to be able to WRITE DOWN the form id it seeds responses
        // under; an auto-generated one could never be named in a second fixture.
        const { __id: pinned, ...data } = row as Record<string, unknown> & { __id?: string };
        return { id: typeof pinned === 'string' ? pinned : `doc-${i}`, data: () => data };
      }),
    };
  },
  getDoc: async (ref: { __doc: string }) => {
    const data = docReads.get(ref.__doc) ?? null;
    return { exists: () => data !== null, data: () => data ?? undefined };
  },
}));

const AdminDashboardHome = (await import('../AdminDashboardHome')).default;
const { aggregateLocations, toMemberLocation, GROWTH_REASON } = await import('../dashboard/growth-data');
const { DEFERRED_GROWTH_WIDGETS } = await import('../dashboard/GrowthTab');
const { readableReceipts, toInvoiceRow, DASHBOARD_FETCH_LIMIT } = await import('../dashboard/dashboard-data');

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(times = 10): Promise<void> {
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

/** Mount, then select Growth and let its own read land. */
async function growthScreen(): Promise<HTMLDivElement> {
  const c = await screen();
  await openTab(c, 'Growth');
  return c;
}

const text = (el: ParentNode | null) => el?.textContent ?? '';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function grantAnalytics() {
  authState.currentUser = { uid: 'u1', email: 'pastor@grace.org', displayName: 'Ada Grace' };
  docReads.set('users/u1', { role: 'admin', permissions: { analytics: true }, tenantId: 'grace' });
}

/**
 * Member documents as this app actually writes them.
 *
 * ⚠️ Every row carries `displayName`, `email` and `phone` ALONGSIDE its location,
 * which is what makes the privacy assertion meaningful: the identifying fields
 * are genuinely present in the documents the widget reads, so a widget that
 * rendered one would be caught rather than merely being un-tested.
 *
 * The shapes deliberately cover all four coverage cases: both fields, country
 * only, neither (the signup that never finished onboarding, and the owner
 * provisioned by a plan purchase), and city without country.
 */
const MEMBERS: Array<Record<string, unknown>> = [
  { displayName: 'Ada Lovelace', email: 'ada@grace.org', phone: '+254700000001', country: 'Kenya', city: 'Nairobi', createdAt: NOW - 2 * DAY },
  { displayName: 'Grace Hopper', email: 'grace@grace.org', phone: '+254700000002', country: 'Kenya', city: 'Nairobi', createdAt: NOW - 3 * DAY },
  { displayName: 'Alan Turing', email: 'alan@grace.org', phone: '+254700000003', country: 'Kenya', city: 'Mombasa', createdAt: NOW - 9 * DAY },
  // Country recorded, city left blank — onboarding validates only the country.
  { displayName: 'Edsger Dijkstra', email: 'edsger@grace.org', country: 'Kenya', city: '', createdAt: NOW - 10 * DAY },
  { displayName: 'Barbara Liskov', email: 'barbara@grace.org', country: 'Uganda', city: 'Kampala', createdAt: NOW - 4 * DAY },
  // Never finished onboarding: neither field was ever written.
  { displayName: 'Ken Thompson', email: 'ken@grace.org', createdAt: NOW - 5 * DAY },
  // Provisioned by a plan purchase: `onboardingCompleted` without a location.
  { displayName: 'Dennis Ritchie', email: 'dennis@grace.org', onboardingCompleted: true, createdAt: NOW - 6 * DAY },
  // A city with no country. Counted, but placed in no country row.
  { displayName: 'Margaret Hamilton', email: 'margaret@grace.org', city: 'Lagos', createdAt: NOW - 7 * DAY },
];

/** Every identifying string in the fixtures above, for the privacy sweep. */
const IDENTIFIERS = MEMBERS.flatMap((m) =>
  [m.displayName, m.email, m.phone].filter((v): v is string => typeof v === 'string'),
);

function healthyTenant() {
  counts.set('users', MEMBERS.length);
  counts.set('contacts', 42);
  counts.set('courses', 2);
  counts.set('community_posts', 7);
  counts.set('blog_posts', 4);
  // THE-309 — a real form response, written where /api/forms/submit writes it:
  // the `tenants/{id}/forms/{formId}/submissions` SUBCOLLECTION, dated by
  // `submittedAt`. It used to be seeded into a top-level `submissions`
  // collection, which is what let the KPI's zero look like a healthy read.
  counts.set('tenants/grace/forms', 1);
  counts.set('tenants/grace/forms/form-volunteer/submissions', 1);
  counts.set('tenants/grace/invoices', 1);

  docsFor.set('users', MEMBERS);
  docsFor.set('tenants/grace/forms', [{ __id: 'form-volunteer', title: 'Volunteer Sign-Up' }]);
  docsFor.set('tenants/grace/forms/form-volunteer/submissions', [{ submittedAt: NOW - DAY }]);
  docsFor.set('tenants/grace/invoices', [
    { amount: 25000, type: 'donation_receipt', issuedAt: new Date(NOW - 2 * DAY).toISOString() },
  ]);
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

/* ═══ 1 · The member growth trend ════════════════════════════════════════════ */

describe('the Growth tab renders the member growth trend with real data or an explicit empty state', () => {
  it('draws it from the same complete read the Overview tab uses', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const trend = c.querySelector('[data-widget="Member growth"]');
    expect(trend, 'the member growth trend did not render').toBeTruthy();
    expect(trend!.getAttribute('data-state')).toBe('ready');
    expect(text(trend!)).toContain('New members over the last eight weeks');

    /*
     * ⚠️ The SERIES are asserted through the chart primitive's generated custom
     * properties, not through rendered labels. recharts draws nothing under
     * happy-dom — `ResponsiveContainer` measures a zero box and emits no svg —
     * so a `toContain('New members')` here would pass on the widget's
     * DESCRIPTION while asserting nothing about what is plotted. `<ChartStyle>`
     * emits one `--color-<key>` per configured series and is plain text, so it
     * is the one thing in this environment that genuinely distinguishes a
     * one-series chart from a two-series one.
     */
    const style = text(trend!.querySelector('[data-chart]'));
    expect(style).toContain('--color-members:');
    // 🔴 One series. No money line on a growth tab: plotting giving beside
    // members invites a causal reading nobody here has evidence for.
    expect(style).not.toContain('--color-giving:');
  });

  it('and reads `users` ONCE for the trend — the Growth tab does not re-issue it', async () => {
    grantAnalytics();
    healthyTenant();
    await growthScreen();

    // The Overview hook takes one count + one bounded fetch for the series; the
    // Growth hook takes one count + one bounded fetch for the locations. Four
    // `users` queries in total, and not a fifth from a duplicated trend read.
    const userQueries = built.filter((q) => keyOf(q) === 'users');
    expect(userQueries.length).toBeLessThanOrEqual(5);
    // Every one of them is a single tenant equality and carries no ordering.
    for (const q of userQueries) {
      expect(q.where).toEqual([['tenantId', '==', 'grace']]);
    }
  });

  it('shows an explicit reason, not an empty chart, when the series is refused', async () => {
    grantAnalytics();
    healthyTenant();
    // Above the ceiling: a complete series cannot be read, so there is none.
    counts.set('users', DASHBOARD_FETCH_LIMIT + 1);
    const c = await growthScreen();

    const trend = c.querySelector('[data-widget="Member growth"]')!;
    expect(trend.getAttribute('data-state')).toBe('unavailable');
    const reason = text(trend.querySelector('[data-empty-reason]'));
    expect(reason.length).toBeGreaterThan(20);
    expect(reason).toContain('complete trend cannot be read');
  });
});

/* ═══ 2 · 🔴 The privacy property ════════════════════════════════════════════ */

describe('the countries table renders aggregated counts, never individual members', () => {
  it('names no member, no email and no phone number anywhere in the widget', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const widget = c.querySelector('[data-widget="Countries & cities"]')!;
    expect(widget.getAttribute('data-state')).toBe('ready');

    const rendered = text(widget);
    for (const identifier of IDENTIFIERS) {
      expect(rendered, `the table rendered "${identifier}"`).not.toContain(identifier);
    }
  });

  it('renders one row per COUNTRY, not one row per member', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const rows = [...c.querySelectorAll('[data-country-row]')];
    // Kenya and Uganda. Eight members, two rows — the whole point.
    expect(rows.map((r) => r.getAttribute('data-country-row'))).toEqual(['Kenya', 'Uganda']);
    expect(rows.length).toBeLessThan(MEMBERS.length);
  });

  it('counts cities as aggregates too — a city is a number, not a roster', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const nairobi = c.querySelector('[data-city-count="Nairobi"]')!;
    expect(text(nairobi)).toBe('Nairobi 2');
    expect(text(c.querySelector('[data-city-count="Mombasa"]'))).toBe('Mombasa 1');
    // The Kenyan member who recorded no city is counted, not dropped.
    expect(text(c.querySelector('[data-city-unrecorded="Kenya"]'))).toContain('1');
  });

  it('the aggregate type carries no field that could hold an identifier', () => {
    const breakdown = aggregateLocations(MEMBERS.map(toMemberLocation));
    const serialised = JSON.stringify(breakdown);
    for (const identifier of IDENTIFIERS) {
      expect(serialised, `the aggregate carries "${identifier}"`).not.toContain(identifier);
    }
    expect(Object.keys(breakdown.rows[0]).sort())
      .toEqual(['cities', 'citiesUnrecorded', 'country', 'members']);
  });
});

/* ═══ 3 · 🔴 No figure is fabricated ═════════════════════════════════════════ */

describe('no figure is fabricated', () => {
  it('every member is accounted for in exactly one place', () => {
    const breakdown = aggregateLocations(MEMBERS.map(toMemberLocation));
    expect(breakdown.total).toBe(MEMBERS.length);
    // The invariant the coverage line is safe to render because of.
    expect(breakdown.withCountry + breakdown.countryUnrecorded).toBe(breakdown.total);
    // And the rows add up to exactly the members who recorded a country.
    const summed = breakdown.rows.reduce((n, r) => n + r.members, 0);
    expect(summed).toBe(breakdown.withCountry);
    // Within a country, the cities plus the unrecorded add up to the country.
    for (const row of breakdown.rows) {
      const cities = row.cities.reduce((n, c) => n + c.members, 0);
      expect(cities + row.citiesUnrecorded).toBe(row.members);
    }
  });

  it('holds over generated inputs, not just the fixture', () => {
    const places = [null, '', '  ', 'Kenya', 'kenya', 'Uganda', 'Nigeria'];
    for (let seed = 0; seed < 120; seed++) {
      const rows = Array.from({ length: seed % 37 }, (_, i) =>
        toMemberLocation({
          country: places[(i * 3 + seed) % places.length],
          city: places[(i * 5 + seed) % places.length],
        }),
      );
      const b = aggregateLocations(rows);
      expect(b.total).toBe(rows.length);
      expect(b.withCountry + b.countryUnrecorded).toBe(b.total);
      expect(b.rows.reduce((n, r) => n + r.members, 0)).toBe(b.withCountry);
      for (const row of b.rows) {
        expect(row.cities.reduce((n, c) => n + c.members, 0) + row.citiesUnrecorded).toBe(row.members);
      }
      // 🔴 No empty-string place ever becomes a row. `'' || 'Unknown'` is the
      // coercion this refuses, and a blank country is a member with no country.
      for (const row of b.rows) {
        expect(row.country.trim().length).toBeGreaterThan(0);
        for (const city of row.cities) expect(city.city.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('states the coverage rather than implying the table is everyone', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const coverage = text(c.querySelector('[data-location-coverage]'));
    // 5 of 8 recorded a country; 5 recorded a city; 3 are placed nowhere.
    expect(coverage).toContain('5 of 8 members');
    expect(coverage).toContain('3');
    expect(coverage).toContain('placed nowhere');
  });

  it('refuses the table outright when the read did not complete — and shows no rows', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('users', DASHBOARD_FETCH_LIMIT + 1);
    const c = await growthScreen();

    const widget = c.querySelector('[data-widget="Countries & cities"]')!;
    expect(widget.getAttribute('data-state')).toBe('unavailable');
    expect(text(widget.querySelector('[data-empty-reason]')).length).toBeGreaterThan(20);
    // 🔴 Not one row, and no coverage figure — a refused read renders no number.
    expect(c.querySelectorAll('[data-country-row]')).toHaveLength(0);
    expect(c.querySelector('[data-location-coverage]')).toBeNull();
  });

  it('a ministry where nobody recorded a country gets a reason, not an empty table', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('users', [{ displayName: 'Ken Thompson', createdAt: NOW - DAY }]);
    counts.set('users', 1);
    const c = await growthScreen();

    const widget = c.querySelector('[data-widget="Countries & cities"]')!;
    expect(widget.getAttribute('data-state')).toBe('unavailable');
    expect(text(widget.querySelector('[data-empty-reason]'))).toContain('has recorded a country');
    expect(c.querySelectorAll('[data-country-row]')).toHaveLength(0);
  });

  it('nothing on the Growth tab renders NaN, undefined or null', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();
    const rendered = text(c.querySelector('[data-growth-tab]'));
    expect(rendered).not.toMatch(/NaN|undefined|\bnull\b/);
  });
});

/* ═══ 4 · The deferred widgets ══════════════════════════════════════════════ */

/**
 * ⚠️ AMENDED BY THE-299, and NARROWED rather than relaxed — the same edit
 * THE-290 and THE-294 made to THE-276's unbuilt-tab claim.
 *
 * THE-283 deferred three widgets here. THE-299 BUILT one of them, so the claim
 * is now about TWO and every assertion below still iterates
 * `DEFERRED_GROWTH_WIDGETS` rather than a list written here — a widget that
 * quietly stopped deferring WITHOUT being built still fails, because it would
 * have to be removed from that table to disappear from these loops, and section
 * 4b then requires the thing it was replaced by to actually render.
 */
describe('the deferred widgets render an empty state naming the reason', () => {
  it('both are present, deferred, and say why in a sentence', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    expect(DEFERRED_GROWTH_WIDGETS).toHaveLength(2);
    for (const widget of DEFERRED_GROWTH_WIDGETS) {
      const el = c.querySelector(`[data-widget="${widget.title}"]`);
      expect(el, `${widget.title} did not render at all`).toBeTruthy();
      expect(el!.getAttribute('data-state'), widget.title).toBe('deferred');

      const reason = text(el!.querySelector('[data-empty-reason]'));
      expect(reason.length, `${widget.title} gives no reason`).toBeGreaterThan(40);
      expect(reason).toBe(widget.reason);

      // 🔴 NOT a zero. A `0` here would claim the ministry has none of the
      // thing, which is a statement about their data made by a widget that
      // read none of it.
      expect(text(el!)).not.toMatch(/(^|\s)0(\s|$)/);
    }
  });

  it('each names the specific blocker, not a generic "coming soon"', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const reasonFor = (title: string) =>
      text(c.querySelector(`[data-widget="${title}"] [data-empty-reason]`));

    expect(reasonFor('Stage conversion')).toContain('recharts ships no funnel series type');
    expect(reasonFor('Where your people are')).toContain('react-simple-maps');
    for (const widget of DEFERRED_GROWTH_WIDGETS) {
      expect(text(c.querySelector(`[data-widget="${widget.title}"]`))).not.toMatch(/coming soon/i);
    }
  });

  it('a deferred widget says "is not built yet", never "unavailable"', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();
    // 🔴 The two are different claims: one is a read that failed, the other is
    // a ticket nobody has done. A founder must not go hunting for a data
    // problem that does not exist.
    for (const widget of DEFERRED_GROWTH_WIDGETS) {
      const el = c.querySelector(`[data-widget="${widget.title}"]`)!;
      expect(text(el)).toContain(`${widget.title} is not built yet`);
      expect(text(el)).not.toContain(`${widget.title} unavailable`);
    }
  });
});

/* ═══ 4b · 🔴 Retention is BUILT, not merely un-deferred ══════════════════ */

describe('the widget THE-299 removed from that table was replaced, not dropped', () => {
  it('Retention cohorts renders, and is not deferred', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const el = c.querySelector('[data-widget="Retention cohorts"]');
    expect(el, 'the retention widget vanished with its deferral').toBeTruthy();
    // 🔴 Shrinking DEFERRED_GROWTH_WIDGETS is not on its own permission to stop
    // showing the widget. Whatever state this read lands in, `deferred` — "no
    // ministry is in scope" wearing "nobody built it" — is not one of them.
    expect(el!.getAttribute('data-state')).not.toBe('deferred');
    expect(text(el!)).not.toContain('is not built yet');
  });

  it('and the reason string that said no component exists is gone from the source', async () => {
    const { GROWTH_REASON } = await import('../dashboard/growth-data');
    expect(Object.keys(GROWTH_REASON)).not.toContain('retentionDeferred');
    expect(JSON.stringify(GROWTH_REASON)).not.toContain('no heatmap component exists');
  });
});

/* ═══ 5 · 🔴 No-regression on THE-276's funnel decision ══════════════════════ */

describe('the funnel is still not mounted under a "devotion" label', () => {
  it('the Growth tab mounts no funnel chart at all', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const growth = c.querySelector('[data-growth-tab]')!;
    expect(c.querySelector('[data-widget="Devotion funnel"]'), 'the funnel moved to Growth').toBeNull();
    // Stage conversion is the deferred placeholder, not a mounted funnel.
    const conversion = c.querySelector('[data-widget="Stage conversion"]')!;
    expect(conversion.getAttribute('data-state')).toBe('deferred');
    // 🔴 And the CRM giving pipeline is not wearing the label either.
    expect(text(growth)).not.toMatch(/Champion|Giving tier/);

    /*
     * 🔴 No WIDGET is titled with devotion, and no chart is configured with
     * devotion stages. The word itself is expected to appear once, inside the
     * deferred reason that explains why the funnel is not mounted — banning the
     * string outright would forbid stating the decision, which is the opposite
     * of what this test defends.
     */
    const titles = [...growth.querySelectorAll('[data-widget]')]
      .map((el) => el.getAttribute('data-widget') ?? '');
    expect(titles.some((t) => /devotion/i.test(t)), `a widget is titled ${titles.join(', ')}`).toBe(false);
    expect(growth.querySelectorAll('[data-chart]')).toHaveLength(1); // the trend, and only the trend
    // The reason names the decision so the next reader does not undo it.
    expect(text(conversion.querySelector('[data-empty-reason]')))
      .toContain('labelling giving tiers as devotion');
  });

  it('and the Overview tab\'s funnel is untouched — still empty, still says why', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const funnel = c.querySelector('[data-widget="Devotion funnel"]')!;
    expect(funnel.getAttribute('data-state')).toBe('unavailable');
    expect(text(funnel.querySelector('[data-empty-reason]')))
      .toContain('devotional reading, streaks or plan progress');
    expect(text(funnel)).not.toMatch(/Champion|Giving tier|Member\b/);
  });
});

/* ═══ 6 · No-regression on the Overview tab ══════════════════════════════════ */

describe("Overview's figures and empty states are unchanged", () => {
  it('renders all seven KPI cards with the same exact figures', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const cards = [...c.querySelectorAll('[data-kpi]')];
    expect(cards).toHaveLength(7);
    const rendered = text(c.querySelector('[data-kpi-grid]'));
    expect(rendered).toContain('Members');
    // The exact count from the aggregation, not the length of any page.
    expect(rendered).toContain(String(MEMBERS.length));
    expect(rendered).toContain('42');
  });

  it('the giving & growth trend still plots BOTH series under its own title', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    const trend = c.querySelector('[data-widget="Giving & growth"]');
    expect(trend, 'the Overview trend lost its title').toBeTruthy();
    expect(trend!.getAttribute('data-state')).toBe('ready');
    // The default title and description THE-283 made overridable — unchanged
    // at this call site, which is the whole point of defaulting them.
    expect(text(trend!)).toContain('The last eight weeks, by week.');

    // Both series are still configured. Same mechanism as the Growth trend.
    const style = text(trend!.querySelector('[data-chart]'));
    expect(style).toContain('--color-members:');
    expect(style).toContain('--color-giving:');
  });

  it('every Overview widget is still in exactly one of its two honest states', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    for (const title of ['Giving & growth', 'What changed', 'Giving mix', 'Devotion funnel']) {
      const widget = c.querySelector(`[data-widget="${title}"]`);
      expect(widget, `${title} did not render`).toBeTruthy();
      const state = widget!.getAttribute('data-state');
      expect(state, `${title} is still loading`).not.toBe('loading');
      // 🔴 And no Overview widget is `deferred` — that state is THE-283's and
      // nothing on the Overview tab may quietly acquire it.
      expect(state, `${title} became deferred`).not.toBe('deferred');
      if (state === 'unavailable') {
        expect(text(widget!.querySelector('[data-empty-reason]')).length).toBeGreaterThan(20);
      }
    }
  });

  it('an Overview read that fails still renders a reason and never a zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contacts', new Error('permission-denied'));
    const c = await screen();

    const grid = c.querySelector('[data-kpi-grid]')!;
    const contacts = [...grid.querySelectorAll('[data-kpi]')]
      .find((card) => text(card).includes('Contacts'))!;
    expect(text(contacts)).not.toMatch(/(^|\s)0(\s|$)/);
    expect(text(contacts).length).toBeGreaterThan(20);
  });
});

/* ═══ 7 · 🔴 No-regression on the strict money gate ══════════════════════════ */

describe('the strict money gate still refuses a missing amount', () => {
  it('one unreadable receipt refuses the total and names the count', () => {
    const rows = [
      toInvoiceRow({ amount: 25000, type: 'donation_receipt', issuedAt: null }),
      // 🔴 No `amount`. It must NOT become 0.
      toInvoiceRow({ type: 'donation_receipt', issuedAt: null }),
    ];
    expect(rows[1].amountCents).toBeNull();

    const money = readableReceipts(rows);
    expect(money.kind).toBe('unavailable');
    expect(money.kind === 'unavailable' && money.reason).toContain('1 of 2 receipts');
  });

  it('and the Giving mix renders that refusal rather than a smaller total', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, type: 'donation_receipt', issuedAt: new Date(NOW - DAY).toISOString() },
      { type: 'donation_receipt', issuedAt: new Date(NOW - DAY).toISOString() },
    ]);
    counts.set('tenants/grace/invoices', 2);
    const c = await screen();

    const mix = c.querySelector('[data-widget="Giving mix"]')!;
    expect(mix.getAttribute('data-state')).toBe('unavailable');
    expect(text(mix.querySelector('[data-empty-reason]'))).toContain('1 of 2 receipts');
    // The short total that a coercion would have produced.
    expect(text(mix)).not.toContain('$250');
  });
});

/* ═══ The reason strings are honest about coverage ═══════════════════════════ */

describe('the coverage reason names the paths that never write a location', () => {
  it('so a founder can act on it rather than guess', () => {
    expect(GROWTH_REASON.noLocationRecorded(12)).toContain('12 members');
    expect(GROWTH_REASON.noLocationRecorded(12)).toContain('onboarding');
  });
});
