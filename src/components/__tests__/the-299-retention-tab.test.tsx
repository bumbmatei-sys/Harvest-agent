import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-299 — the retention cohort heatmap, and the Platform tab's removal.
 *
 * ─── What these tests defend ─────────────────────────────────────────────────
 *
 *   🔴 COMPLETENESS. A retention percentage over a partial read is a WRONG
 *   number in a pretty grid, which is worse than no grid at all. Three
 *   collections are read and each is count-gated; if any is over the ceiling the
 *   whole widget refuses and says which one. The fixtures here go to 1,000 and
 *   1,001 activity rows deliberately — this repo has been bitten by undersized
 *   fixtures repeatedly, and a five-row fixture proves nothing about a ceiling.
 *
 *   🔴 PRIVACY. A cohort is a COUNT. The member documents and the contact
 *   documents these fixtures feed the widget carry real names, emails and phone
 *   numbers, so a widget that rendered one would be caught rather than merely
 *   untested — and the assertion is written against the RENDERED TEXT, so it
 *   fails no matter which layer reintroduces it.
 *
 *   🔴 NOTHING LOST. Two closed accountings, asserted over generated inputs as
 *   well as over the fixtures: every member is in a cohort or in one of three
 *   named tallies, and every activity is attributed or in one of three others.
 *
 * ⚠️ The mock is THE-276's query RECORDER with ONE addition: a row may carry an
 * `__id`, which becomes its document id. THE-276's recorder numbered every
 * collection's documents `doc-0`, `doc-1`, … which would make a `contacts` id
 * collide with a `users` id — and the join under test is precisely the question
 * of which collection an id belongs to. A fixture that cannot tell them apart
 * could not fail.
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
  // 🔴 Recorded rather than ignored. A query that DID carry an orderBy has to
  // be visible to the assertion that says none does.
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
    return {
      docs: rows.map((data, i) => ({
        id: (data.__id as string | undefined) ?? `${keyOf(q)}-${i}`,
        data: () => data,
      })),
    };
  },
  getDoc: async (ref: { __doc: string }) => {
    const data = docReads.get(ref.__doc) ?? null;
    return { exists: () => data !== null, data: () => data ?? undefined };
  },
}));

const AdminDashboardHome = (await import('../AdminDashboardHome')).default;
const { DASHBOARD_TABS } = await import('../dashboard/DashboardTabs');
const { DASHBOARD_FETCH_LIMIT, REASON } = await import('../dashboard/dashboard-data');
const {
  RETENTION_MONTHS, RETENTION_REASON, buildRetention, linkContacts,
  toActivityStamp, toContactRow, toMemberRow,
} = await import('../dashboard/retention-data');
const { bandOf, BAND_FILL, BAND_LABEL } = await import('../dashboard/RetentionHeatmap');

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

const screen = (props: Partial<{ tenantId: string | null; isSuperAdmin: boolean }> = {}) =>
  mount(
    <AdminDashboardHome
      tenantId={props.tenantId === undefined ? 'grace' : props.tenantId}
      tenantName="Grace Chapel"
      isSuperAdmin={props.isSuperAdmin ?? false}
      unreadCount={0}
      onNavigate={() => {}}
    />,
  );

async function growthScreen(props?: Partial<{ tenantId: string | null; isSuperAdmin: boolean }>): Promise<HTMLDivElement> {
  const c = await screen(props);
  await openTab(c, 'Growth');
  return c;
}

const text = (el: ParentNode | null) => el?.textContent ?? '';
const widget = (c: ParentNode) => c.querySelector('[data-widget="Retention cohorts"]');
const stateOf = (c: ParentNode) => widget(c)?.getAttribute('data-state');
const reasonOf = (c: ParentNode) => text(widget(c)?.querySelector('[data-empty-reason]') ?? null);

/* ── Month arithmetic, matching the module under test ─────────────────────── */

const NOW = Date.now();
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const THIS_MONTH = monthIndex(new Date(NOW));

/** A date safely inside the month `k` months before this one. */
function monthsAgo(k: number): Date {
  const target = THIS_MONTH - k;
  return new Date(Math.floor(target / 12), target % 12, 15, 12, 0, 0);
}

function grantAnalytics() {
  authState.currentUser = { uid: 'u1', email: 'pastor@grace.org', displayName: 'Ada Grace' };
  docReads.set('users/u1', { role: 'admin', permissions: { analytics: true }, tenantId: 'grace' });
}

/* ── The fixtures ─────────────────────────────────────────────────────────── */

/**
 * Members as this app actually writes them.
 *
 * ⚠️ Every row carries `displayName`, `email` and `phone`, which is what makes
 * the privacy assertion meaningful: the identifying fields are genuinely in the
 * documents the widget reads.
 *
 * The join months cover every case the window has to account for: inside it,
 * before it, during the month still in progress, and undatable.
 */
const MEMBERS: Array<Record<string, unknown>> = [
  { __id: 'uid-ada', displayName: 'Ada Lovelace', email: 'Ada@grace.org', phone: '+254700000001', country: 'Kenya', city: 'Nairobi', createdAt: monthsAgo(6) },
  { __id: 'uid-grace', displayName: 'Grace Hopper', email: 'grace@grace.org', phone: '+254700000002', country: 'Kenya', city: 'Nairobi', createdAt: monthsAgo(6) },
  { __id: 'uid-alan', displayName: 'Alan Turing', email: 'alan@grace.org', phone: '+254700000003', country: 'Kenya', city: 'Mombasa', createdAt: monthsAgo(6) },
  { __id: 'uid-edsger', displayName: 'Edsger Dijkstra', email: 'edsger@grace.org', country: 'Kenya', city: '', createdAt: monthsAgo(3) },
  { __id: 'uid-barbara', displayName: 'Barbara Liskov', email: 'barbara@grace.org', country: 'Uganda', city: 'Kampala', createdAt: monthsAgo(3) },
  { __id: 'uid-ken', displayName: 'Ken Thompson', email: 'ken@grace.org', country: 'Uganda', createdAt: monthsAgo(1) },
  // Joined before the window opened. Counted, placed in no row.
  { __id: 'uid-dennis', displayName: 'Dennis Ritchie', email: 'dennis@grace.org', country: 'Kenya', createdAt: monthsAgo(RETENTION_MONTHS + 4) },
  // Joined during the month still in progress. Counted, placed in no row.
  { __id: 'uid-margaret', displayName: 'Margaret Hamilton', email: 'margaret@grace.org', country: 'Kenya', createdAt: monthsAgo(0) },
  // `createdAt` was never written. Counted, placed in no row, never guessed at.
  { __id: 'uid-katherine', displayName: 'Katherine Johnson', email: 'katherine@grace.org', country: 'Kenya' },
];

/**
 * CRM contacts. 🔴 This is the collection the ticket's premise did not carry:
 * a check-in writes its activity against one of THESE, matched by email, so an
 * attribution that only looked at uids would miss it.
 */
const CONTACTS: Array<Record<string, unknown>> = [
  // Linked by the explicit member link — the donation webhook's shape.
  { __id: 'contact-ada', firstName: 'Ada', lastName: 'Lovelace', email: 'other@elsewhere.org', phone: '+254700000001', userId: 'uid-ada', tenantId: 'grace' },
  // Linked by ADDRESS only, and with different casing — the check-in shape.
  { __id: 'contact-grace', firstName: 'Grace', lastName: 'Hopper', email: 'GRACE@grace.org', tenantId: 'grace' },
  { __id: 'contact-edsger', firstName: 'Edsger', lastName: 'Dijkstra', email: 'edsger@grace.org', tenantId: 'grace' },
  { __id: 'contact-barbara', firstName: 'Barbara', lastName: 'Liskov', email: 'barbara@grace.org', tenantId: 'grace' },
  { __id: 'contact-ken', firstName: 'Ken', lastName: 'Thompson', email: 'ken@grace.org', tenantId: 'grace' },
  // A visitor who is not a member. Their activity is counted, and attributed
  // to no cohort, because they belong to none.
  { __id: 'contact-visitor', firstName: 'Hedy', lastName: 'Lamarr', email: 'hedy@visitor.org', tenantId: 'grace' },
];

/**
 * Every identifying string in the fixtures above, for the privacy sweep.
 *
 * ⚠️ FULL names, addresses and numbers — never a bare given name. "Ken" is a
 * substring of "Kenya", which the countries table renders legitimately and
 * must keep rendering; a sweep for three-letter fragments would fail on a
 * widget that is behaving correctly and would have to be weakened to pass,
 * which is how a privacy guard stops guarding.
 */
const IDENTIFIERS = [
  ...MEMBERS.flatMap((row) => [row.displayName, row.email, row.phone]),
  ...CONTACTS.flatMap((row) => [row.email, row.phone, `${row.firstName} ${row.lastName}`]),
].filter((v): v is string => typeof v === 'string' && v.trim().length > 5);

/**
 * One activity row.
 *
 * ⚠️ `createdAt` alternates between a Date (standing in for a Firestore
 * Timestamp, which `toSafeDate` reaches through `toDate()`) and an ISO STRING,
 * because both are genuinely in this collection: five writers use
 * `serverTimestamp()` and two write `new Date().toISOString()`. A fixture of one
 * type would not exercise the reason there is no `orderBy`.
 */
const activity = (contactId: string, when: Date, asIso: boolean): Record<string, unknown> => ({
  contactId,
  tenantId: 'grace',
  type: 'meeting',
  description: 'Attended: Sunday service',
  createdAt: asIso ? when.toISOString() : when,
});

/**
 * A realistic activity trail, padded to EXACTLY `total` rows.
 *
 * 🔴 `total` defaults to the ceiling itself. A fixture below it would leave the
 * "complete at the ceiling" branch untested, and that branch is the one that
 * decides whether a real church sees a grid at all.
 */
function activityTrail(total: number = DASHBOARD_FETCH_LIMIT): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let flip = false;
  const add = (id: string, k: number) => { rows.push(activity(id, monthsAgo(k), (flip = !flip))); };

  // The month-6 cohort is three members. Ada and Grace are active in their join
  // month; Alan never is. Ada alone survives to month 3 of her cohort's life.
  add('uid-ada', 6);            // by uid — an admin logged it in the CRM
  add('contact-grace', 6);      // by contact, matched on address
  add('uid-ada', 3);
  // The month-3 cohort is two members; both active in their join month.
  add('contact-edsger', 3);
  add('contact-barbara', 3);
  // The month-1 cohort is one member, active in its join month.
  add('contact-ken', 1);
  // A visitor who is not a member, and an id this tenant holds no row for.
  add('contact-visitor', 2);
  add('contact-deleted', 2);
  // Undatable, and an activity with no contactId at all.
  rows.push({ contactId: 'uid-ada', tenantId: 'grace', createdAt: null });
  rows.push({ tenantId: 'grace', createdAt: monthsAgo(2).toISOString() });

  // Padding, so the fixture reaches the ceiling. Every padded row belongs to
  // the visitor, so it changes no cohort's arithmetic while still being read.
  while (rows.length < total) add('contact-visitor', 2);
  return rows.slice(0, total);
}

function healthyTenant(activityRows: Array<Record<string, unknown>> = activityTrail()) {
  counts.set('users', MEMBERS.length);
  counts.set('contacts', CONTACTS.length);
  counts.set('contactActivities', activityRows.length);
  counts.set('courses', 2);
  counts.set('community_posts', 7);
  counts.set('blog_posts', 4);
  // THE-309 — a real form response, written where /api/forms/submit writes it:
  // the `tenants/{id}/forms/{formId}/submissions` SUBCOLLECTION, dated by
  // `submittedAt`. It used to be seeded into a top-level `submissions`
  // collection, which is what let the KPI's zero look like a healthy read.
  counts.set('tenants/grace/forms', 1);
  counts.set('tenants/grace/forms/form-volunteer/submissions', 1);
  counts.set('prayer_requests', 0);
  counts.set('tenants/grace/invoices', 1);

  docsFor.set('users', MEMBERS);
  docsFor.set('contacts', CONTACTS);
  docsFor.set('contactActivities', activityRows);
  docsFor.set('tenants/grace/forms', [{ __id: 'form-volunteer', title: 'Volunteer Sign-Up' }]);
  docsFor.set('tenants/grace/forms/form-volunteer/submissions', [{ submittedAt: monthsAgo(0).toISOString() }]);
  docsFor.set('tenants/grace/invoices', [
    { amount: 25000, type: 'donation_receipt', issuedAt: monthsAgo(1).toISOString() },
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
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container?.remove();
});

/* ═══ 1 · The grid renders, from a complete read at the ceiling ═════════════ */

describe('the heatmap draws cohorts from a complete read', () => {
  it('renders a grid, a legend and the accessible table', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    expect(stateOf(c)).toBe('ready');
    expect(c.querySelector('[data-retention-grid]'), 'no grid drew').toBeTruthy();
    expect(c.querySelector('[data-retention-legend]')).toBeTruthy();
    expect(c.querySelector('[data-retention-table]')).toBeTruthy();
    expect(c.querySelector('[data-retention-coverage]')).toBeTruthy();
  });

  it('🔴 it draws exactly twelve cohort rows, one per month of the window', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();
    expect(c.querySelectorAll('[data-retention-row]')).toHaveLength(RETENTION_MONTHS);
  });

  it('the cohort with three members reports three, and its period-0 share is 2 of 3', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const key = `${Math.floor((THIS_MONTH - 6) / 12)}-${String(((THIS_MONTH - 6) % 12) + 1).padStart(2, '0')}`;
    const row = c.querySelector(`[data-retention-row="${key}"]`);
    expect(row, `no row for ${key}`).toBeTruthy();
    // Ada and Grace were active in their join month; Alan never was. 2/3 = 67%.
    const cell = row!.querySelector(`[data-retention-cell="${key}:0"]`);
    expect(text(cell)).toContain('67%');
    // And three months later only Ada remains: 1/3 = 33%.
    expect(text(row!.querySelector(`[data-retention-cell="${key}:3"]`))).toContain('33%');
  });

  it('🔴 a period that has not finished draws NOTHING — blank is not zero', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    // The newest cohort is one month old, so it has exactly one observed period.
    const newest = `${Math.floor((THIS_MONTH - 1) / 12)}-${String(((THIS_MONTH - 1) % 12) + 1).padStart(2, '0')}`;
    expect(c.querySelector(`[data-retention-cell="${newest}:0"]`), 'period 0 is observed').toBeTruthy();
    expect(c.querySelector(`[data-retention-cell="${newest}:1"]`), 'period 1 has not happened').toBeNull();

    // And the accessible table says so in words rather than leaving a gap.
    expect(text(c.querySelector('[data-retention-table]'))).toContain('not yet observed');
  });

  it('the legend states each band in words, so colour is never the only carrier', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const legend = c.querySelector('[data-retention-legend]')!;
    for (const label of BAND_LABEL) {
      expect(legend.querySelector(`[data-retention-band="${label}"]`), label).toBeTruthy();
    }
    expect(text(legend)).toContain('has not finished');

    // 🔴 Every drawn cell carries its number, not just its colour.
    const cells = [...c.querySelectorAll('[data-retention-cell]')];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(text(cell), 'a cell has a colour and no number').toMatch(/\d+%/);
    }
  });

  it('every cell fill is one of the six declared bands — none is invented', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();
    for (const rect of c.querySelectorAll('[data-retention-cell] rect')) {
      expect(BAND_FILL as readonly string[]).toContain(rect.getAttribute('class'));
    }
  });
});

/* ═══ 2 · 🔴 Privacy — a cohort is a count, never a person ══════════════════ */

describe('the heatmap renders cohorts as counts, never individuals', () => {
  it('🔴 no member name, email or phone reaches the Growth tab', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    expect(IDENTIFIERS.length).toBeGreaterThan(15);
    const rendered = text(c.querySelector('[data-growth-tab]'));
    for (const identifier of IDENTIFIERS) {
      expect(rendered, `the Growth tab renders "${identifier}"`).not.toContain(identifier);
    }
  });

  it('🔴 every row heading is a month, and the type could not hold anything else', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();

    const headings = [...c.querySelectorAll('[data-retention-table] tbody th')].map((th) => text(th));
    expect(headings).toHaveLength(RETENTION_MONTHS);
    for (const heading of headings) {
      expect(heading, `"${heading}" is not a month`).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
    }
  });

  it('🔴 and the aggregate type carries no field that could hold an identifier', () => {
    const grid = buildRetention(
      MEMBERS.map((m) => toMemberRow(m, m.__id as string)),
      CONTACTS.map((c) => toContactRow(c, c.__id as string)),
      activityTrail(50).map(toActivityStamp),
      NOW,
    );
    const serialised = JSON.stringify(grid);
    for (const identifier of IDENTIFIERS) {
      expect(serialised, `the grid carries "${identifier}"`).not.toContain(identifier);
    }
    for (const row of grid.rows) {
      expect(Object.keys(row).sort()).toEqual(['active', 'key', 'label', 'members', 'retained']);
    }
  });
});

/* ═══ 3 · 🔴 The ceiling: stated, never silently truncated ══════════════════ */

describe('retention is computed over a complete read, and the ceiling is stated', () => {
  it('🔴 at exactly the ceiling the read is complete and the grid is drawn', async () => {
    grantAnalytics();
    const rows = activityTrail(DASHBOARD_FETCH_LIMIT);
    expect(rows).toHaveLength(1000);
    healthyTenant(rows);
    const c = await growthScreen();

    expect(stateOf(c)).toBe('ready');
    expect(c.querySelector('[data-retention-grid]')).toBeTruthy();
    expect(text(c.querySelector('[data-retention-coverage]'))).toContain('1,000 activities read');
  });

  it('🔴 one row past it the whole widget refuses, names the collection, and draws NO grid', async () => {
    grantAnalytics();
    // The COUNT is what decides, and it decides before a document is loaded.
    // The rows are still supplied, so a widget that ignored the count and drew
    // whatever `getDocs` returned would render a grid here and fail.
    const rows = activityTrail(DASHBOARD_FETCH_LIMIT);
    counts.set('users', MEMBERS.length);
    counts.set('contacts', CONTACTS.length);
    counts.set('courses', 2); counts.set('community_posts', 7); counts.set('blog_posts', 4);
    counts.set('submissions', 1); counts.set('prayer_requests', 0);
    counts.set('tenants/grace/invoices', 1);
    counts.set('contactActivities', DASHBOARD_FETCH_LIMIT + 1);
    docsFor.set('users', MEMBERS);
    docsFor.set('contacts', CONTACTS);
    docsFor.set('contactActivities', rows);
    docsFor.set('submissions', []);
    docsFor.set('tenants/grace/invoices', []);
    docReads.set('tenants/grace/livestream/current', { active: false, title: 'Live now' });

    const c = await growthScreen();

    expect(stateOf(c)).toBe('unavailable');
    expect(c.querySelector('[data-retention-grid]'), 'a truncated grid was drawn').toBeNull();
    expect(c.querySelector('[data-retention-cell]')).toBeNull();

    const reason = reasonOf(c);
    expect(reason).toBe(RETENTION_REASON.activityCeiling(DASHBOARD_FETCH_LIMIT));
    expect(reason).toContain('1,000');
    expect(reason).toContain('CRM activities');
    // 🔴 Not the generic wording, which would leave a reader to guess which of
    // three collections bound.
    expect(reason).not.toBe(REASON.tooManyToChart);
    // And not a percentage anywhere on the widget.
    expect(text(widget(c))).not.toMatch(/\d+%/);
  });

  it('🔴 the contacts ceiling refuses too, and says it is the contact list', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contacts', DASHBOARD_FETCH_LIMIT + 1);
    const c = await growthScreen();

    expect(stateOf(c)).toBe('unavailable');
    expect(reasonOf(c)).toBe(RETENTION_REASON.contactCeiling(DASHBOARD_FETCH_LIMIT));
    expect(c.querySelector('[data-retention-grid]')).toBeNull();
  });

  it('🔴 and the member ceiling refuses, without disturbing the countries table', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('users', DASHBOARD_FETCH_LIMIT + 1);
    const c = await growthScreen();

    expect(stateOf(c)).toBe('unavailable');
    expect(reasonOf(c)).toBe(RETENTION_REASON.memberCeiling(DASHBOARD_FETCH_LIMIT));
    // ⚠️ The location widget refuses on the same read and keeps ITS OWN wording,
    // unchanged by this slice — the three gates are separate claims.
    expect(text(c.querySelector('[data-widget="Countries & cities"] [data-empty-reason]')))
      .toBe(REASON.tooManyToChart);
  });

  it('an empty activity collection is a reason, not a grid of zeroes', async () => {
    grantAnalytics();
    healthyTenant([]);
    const c = await growthScreen();
    expect(stateOf(c)).toBe('unavailable');
    expect(reasonOf(c)).toBe(RETENTION_REASON.noActivity);
    expect(text(widget(c))).not.toMatch(/0%/);
  });

  it('a ministry nobody joined this year is a reason, not twelve rows of zeroes', async () => {
    grantAnalytics();
    healthyTenant();
    // Everyone joined before the window opened.
    docsFor.set('users', MEMBERS.map((m) => ({ ...m, createdAt: monthsAgo(RETENTION_MONTHS + 3) })));
    const c = await growthScreen();
    expect(stateOf(c)).toBe('unavailable');
    expect(reasonOf(c)).toBe(RETENTION_REASON.noCohorts(RETENTION_MONTHS));
    expect(text(widget(c))).not.toMatch(/0%/);
  });
});

/* ═══ 4 · 🔴 No orderBy, on any collection ══════════════════════════════════ */

describe('no Firestore orderBy is issued on contactActivities or users', () => {
  it('🔴 not one query the Growth tab builds carries an orderBy', async () => {
    grantAnalytics();
    healthyTenant();
    await growthScreen();

    const ordered = built.filter((q) => q.orderBy.length > 0);
    expect(
      ordered.map((q) => `${keyOf(q)} ordered by ${q.orderBy.map(([f]) => f).join(', ')}`),
      'an orderBy would return every ISO-string row before any Timestamp row',
    ).toEqual([]);
  });

  it('and each of the three collections was read, with exactly one tenant equality', async () => {
    grantAnalytics();
    healthyTenant();
    await growthScreen();

    for (const collection of ['users', 'contacts', 'contactActivities']) {
      const queries = built.filter((q) => keyOf(q) === collection);
      expect(queries.length, `${collection} was never read`).toBeGreaterThan(0);
      for (const q of queries) {
        // 🔴 ONE equality. A second `where` needs a composite index, and
        // `firestore.indexes.json` does not deploy on merge — so it would throw
        // `failed-precondition` in production while every test stayed green.
        expect(q.where, `${collection} carries ${q.where.length} where clauses`).toHaveLength(1);
        expect(q.where[0]).toEqual(['tenantId', '==', 'grace']);
      }
      // The counted query is unbounded; the loaded one carries the ceiling.
      expect(queries.some((q) => q.limit === null)).toBe(true);
      expect(queries.some((q) => q.limit === DASHBOARD_FETCH_LIMIT)).toBe(true);
    }
  });

  it('🔴 and both date shapes are bucketed correctly in memory, which is why', () => {
    const at = monthsAgo(2);
    const asTimestamp = toActivityStamp({ contactId: 'x', createdAt: { toDate: () => at } });
    const asIso = toActivityStamp({ contactId: 'x', createdAt: at.toISOString() });
    const asDate = toActivityStamp({ contactId: 'x', createdAt: at });
    expect(asTimestamp.at?.getTime()).toBe(at.getTime());
    expect(asIso.at?.getTime()).toBe(at.getTime());
    expect(asDate.at?.getTime()).toBe(at.getTime());
    // And an unreadable one is null, never coerced to "now".
    expect(toActivityStamp({ contactId: 'x', createdAt: undefined }).at).toBeNull();
  });
});

/* ═══ 5 · 🔴 Nothing lost — the two closed accountings ══════════════════════ */

describe('every member and every activity is accounted for exactly once', () => {
  const members = MEMBERS.map((m) => toMemberRow(m, m.__id as string));
  const contacts = CONTACTS.map((c) => toContactRow(c, c.__id as string));

  it('🔴 the member accounting closes on the fixtures', () => {
    const grid = buildRetention(members, contacts, activityTrail(200).map(toActivityStamp), NOW);
    expect(grid.membersInWindow + grid.membersBeforeWindow + grid.membersAfterWindow + grid.membersUndated)
      .toBe(grid.membersTotal);
    expect(grid.membersTotal).toBe(MEMBERS.length);
    expect(grid.membersBeforeWindow).toBe(1);
    expect(grid.membersAfterWindow).toBe(1);
    expect(grid.membersUndated).toBe(1);
    expect(grid.rows.reduce((sum, r) => sum + r.members, 0)).toBe(grid.membersInWindow);
  });

  it('🔴 the activity accounting closes on the fixtures', () => {
    const rows = activityTrail(200);
    const grid = buildRetention(members, contacts, rows.map(toActivityStamp), NOW);
    expect(grid.activitiesAttributed + grid.activitiesNotAMember + grid.activitiesUnresolved + grid.activitiesUndated)
      .toBe(grid.activitiesRead);
    expect(grid.activitiesRead).toBe(200);
    expect(grid.activitiesUndated).toBe(1);
    // One row with no contactId, and one naming a contact this tenant has no
    // document for — different facts, counted under the same honest heading.
    expect(grid.activitiesUnresolved).toBe(2);
  });

  it('🔴 both accountings close over generated inputs, not only the fixtures', () => {
    let seed = 20260904;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

    for (let run = 0; run < 40; run++) {
      const generatedMembers = Array.from({ length: 1 + Math.floor(rand() * 60) }, (_, i) =>
        toMemberRow(
          rand() < 0.15
            ? { email: `m${i}@x.org` }
            : { email: `m${i}@x.org`, createdAt: monthsAgo(Math.floor(rand() * (RETENTION_MONTHS + 6))) },
          `uid-${i}`,
        ),
      );
      const generatedContacts = generatedMembers.map((m, i) =>
        toContactRow(rand() < 0.5 ? { userId: m.uid } : { email: m.email }, `c-${i}`),
      );
      const generatedActivities = Array.from({ length: Math.floor(rand() * 300) }, () => {
        const roll = rand();
        return toActivityStamp({
          contactId: roll < 0.1 ? undefined : roll < 0.2 ? 'nobody' : `c-${Math.floor(rand() * generatedMembers.length)}`,
          createdAt: rand() < 0.1 ? undefined : monthsAgo(Math.floor(rand() * (RETENTION_MONTHS + 2))),
        });
      });

      const grid = buildRetention(generatedMembers, generatedContacts, generatedActivities, NOW);

      expect(grid.membersInWindow + grid.membersBeforeWindow + grid.membersAfterWindow + grid.membersUndated)
        .toBe(grid.membersTotal);
      expect(grid.activitiesAttributed + grid.activitiesNotAMember + grid.activitiesUnresolved + grid.activitiesUndated)
        .toBe(grid.activitiesRead);
      expect(grid.rows.reduce((sum, r) => sum + r.members, 0)).toBe(grid.membersInWindow);
      expect(grid.rows).toHaveLength(RETENTION_MONTHS);

      for (const row of grid.rows) {
        row.retained.forEach((share, period) => {
          if (share === null) return;
          expect(share).toBeGreaterThanOrEqual(0);
          expect(share).toBeLessThanOrEqual(100);
          expect(Number.isNaN(share)).toBe(false);
          // 🔴 The count and the share are the same fact twice and may not drift.
          expect(row.active[period]).toBeLessThanOrEqual(row.members);
          expect(share).toBeCloseTo(((row.active[period] ?? 0) / row.members) * 100, 8);
        });
      }
    }
  });

  it('🔴 a cohort nobody joined has no share — 0/0 is null, never 0%', () => {
    const grid = buildRetention([], [], [], NOW);
    expect(grid.rows).toHaveLength(RETENTION_MONTHS);
    for (const row of grid.rows) {
      expect(row.members).toBe(0);
      expect(row.retained.every((v) => v === null)).toBe(true);
    }
    expect(grid.overall.every((v) => v === null)).toBe(true);
  });
});

/* ═══ 6 · 🔴 The join is the app's own, and an ambiguity resolves to nobody ═ */

describe('an activity is attributed to a member by the rules member-erasure uses', () => {
  it('by userId, and by address with casing normalised', () => {
    const members = MEMBERS.map((m) => toMemberRow(m, m.__id as string));
    const linked = linkContacts(members, CONTACTS.map((c) => toContactRow(c, c.__id as string)));
    // Ada's contact carries a DIFFERENT address and links by userId anyway.
    expect(linked.get('contact-ada')).toBe('uid-ada');
    // Grace's links on `GRACE@grace.org` against `Ada@grace.org`-style casing.
    expect(linked.get('contact-grace')).toBe('uid-grace');
    // The visitor links to nobody, because they are nobody's member record.
    expect(linked.has('contact-visitor')).toBe(false);
  });

  it('🔴 an address two members share links to NEITHER — a guess is worse than a gap', () => {
    const twins = [
      toMemberRow({ email: 'shared@grace.org', createdAt: monthsAgo(2) }, 'uid-a'),
      toMemberRow({ email: 'shared@grace.org', createdAt: monthsAgo(2) }, 'uid-b'),
    ];
    const linked = linkContacts(twins, [toContactRow({ email: 'shared@grace.org' }, 'c-1')]);
    expect(linked.has('c-1')).toBe(false);

    // And the activity is counted rather than dropped.
    const grid = buildRetention(twins, [toContactRow({ email: 'shared@grace.org' }, 'c-1')],
      [toActivityStamp({ contactId: 'c-1', createdAt: monthsAgo(2) })], NOW);
    expect(grid.activitiesAttributed).toBe(0);
    expect(grid.activitiesNotAMember).toBe(1);
    expect(grid.activitiesRead).toBe(1);
  });

  it('a userId naming somebody outside this read is not evidence about anyone in it', () => {
    const members = [toMemberRow({ email: 'a@grace.org', createdAt: monthsAgo(2) }, 'uid-a')];
    const linked = linkContacts(members, [toContactRow({ userId: 'uid-elsewhere' }, 'c-1')]);
    expect(linked.has('c-1')).toBe(false);
  });

  it('the coverage line names every part of the answer that is missing', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await growthScreen();
    const coverage = text(c.querySelector('[data-retention-coverage]'));
    expect(coverage).toContain('joined earlier');
    expect(coverage).toContain('month still in progress');
    expect(coverage).toContain('no readable join date');
    expect(coverage).toContain('belong to a member');
    expect(coverage).toContain('not one');
  });
});

/* ═══ 7 · 🔴 The apex, and the other five tabs ══════════════════════════════ */

describe('the super-admin apex behaviour is unchanged', () => {
  it('🔴 a super admin on the apex is told no ministry is in scope', async () => {
    grantAnalytics();
    counts.set('users', 3);
    counts.set('tenants', 2);
    counts.set('contacts', 0); counts.set('courses', 0);
    counts.set('community_posts', 0); counts.set('blog_posts', 0); counts.set('submissions', 0);
    docsFor.set('users', MEMBERS.slice(0, 3));
    const c = await growthScreen({ tenantId: null, isSuperAdmin: true });

    expect(stateOf(c)).toBe('unavailable');
    expect(reasonOf(c)).toBe(REASON.noTenant);
    /*
     * 🔴 And no cross-tenant read was attempted for it. `contactActivities` is
     * the collection only this widget reads, so its absence is the proof: the
     * hook did not fall through to an unscoped scan that a super admin's token
     * would in fact have passed. Summing every church's check-ins, gifts and
     * logged notes into one retention figure is a number this product does not
     * define, which is the same decision THE-290 and THE-294 recorded.
     *
     * ⚠️ `contacts` is deliberately NOT asserted here: `useOverviewData` reads
     * it unscoped on the apex for its own contact COUNT, and has since THE-276.
     * A blanket assertion would be failing that widget, not this one.
     */
    expect(built.some((q) => keyOf(q) === 'contactActivities')).toBe(false);
  });

  it('the tab strip is five tabs and the Platform tab is not among them', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    const labels = [...c.querySelectorAll('[data-slot="tabs-trigger"]')].map((t) => text(t).trim());
    expect(labels).toEqual(['Overview', 'Growth', 'Giving', 'Engagement', 'Content']);
    expect(DASHBOARD_TABS).toHaveLength(5);
    expect(text(c)).not.toContain('Platform is not built yet');
  });

  it('🔴 the other tabs still render, and their empty states are untouched', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();

    for (const tab of DASHBOARD_TABS) {
      await openTab(c, tab.label);
      expect(c.querySelector('[data-tab-placeholder]'), `${tab.label} is a placeholder`).toBeNull();
    }

    // The Growth tab's own figures, which share the ONE `users` read with the
    // heatmap and must not have moved because of it.
    await openTab(c, 'Growth');
    expect(c.querySelector('[data-widget="Countries & cities"]')?.getAttribute('data-state')).toBe('ready');
    const coverage = text(c.querySelector('[data-location-coverage]'));
    // Eight of nine members recorded a country; Katherine has one too, so nine.
    expect(coverage).toContain('9 members');
  });

  it('🔴 the impossible widgets #438 deleted are still absent from every tab', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    let all = '';
    for (const tab of DASHBOARD_TABS) {
      await openTab(c, tab.label);
      all += `\n${text(c)}`;
    }
    for (const pattern of [/reach/i, /impression/i, /blog views/i, /completions over time/i]) {
      expect(all.match(pattern), `the dashboard renders "${all.match(pattern)?.[0]}"`).toBeNull();
    }
  });
});

/* ═══ 8 · 🔴 No-regression: the strict money gate ═══════════════════════════ */

describe('the strict money gate still refuses a missing amount', () => {
  /**
   * 🔴 #421 caught `toInvoiceRow` coercing a missing `amount` to `0` — silent
   * money loss, in its own code. It refuses and NAMES THE COUNT now, and this
   * slice must not have loosened it while reading three collections next door.
   *
   * ⚠️ Asserted through the real functions rather than by grepping the source:
   * a comment can survive a behaviour change, and the guard file's source
   * checks are the second line, not the first.
   */
  it('🔴 a receipt with no readable amount refuses the whole total, and says how many', async () => {
    const { readableReceipts, toInvoiceRow } = await import('../dashboard/dashboard-data');

    const good = toInvoiceRow({ amount: 25000, type: 'donation_receipt', issuedAt: null });
    const missing = toInvoiceRow({ type: 'donation_receipt', issuedAt: null });
    expect(good.amountCents).toBe(25000);
    // 🔴 NOT `0`. There is no branch in which a missing amount becomes a number.
    expect(missing.amountCents).toBeNull();

    const refused = readableReceipts([good, missing]);
    expect(refused.kind).toBe('unavailable');
    expect(refused.kind === 'unavailable' && refused.reason).toContain('1 of 2');

    expect(readableReceipts([good]).kind).toBe('complete');
  });

  it('and the Giving figures on the other tabs are untouched by this slice', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Giving');
    // The tab renders; nothing here reports a zero it did not read.
    expect(c.querySelector('[data-giving-tab]')).toBeTruthy();
    expect(text(c.querySelector('[data-giving-tab]'))).not.toMatch(/NaN|undefined/);
  });
});

/* ═══ 9 · The band function, at its boundaries ══════════════════════════════ */

describe('the colour band is a function of the share, and zero has its own', () => {
  it('none, and the four twenty-point steps', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(20)).toBe(1);
    expect(bandOf(20.01)).toBe(2);
    expect(bandOf(40)).toBe(2);
    expect(bandOf(60)).toBe(3);
    expect(bandOf(80)).toBe(4);
    expect(bandOf(100)).toBe(5);
    expect(BAND_FILL).toHaveLength(6);
  });
});
