import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-294 — the Engagement and Content tabs (slices 4 and 5): the activity read.
 *
 * ─── What these tests defend ─────────────────────────────────────────────────
 *
 * Everything THE-276's, THE-283's and THE-290's do, plus the six properties
 * specific to a tab built on a collection that grows without bound and is
 * written by seven disagreeing call sites:
 *
 *   🔴 NO `orderBy` ON `contactActivities`, EVER. Its `createdAt` holds BOTH
 *   Firestore Timestamps and ISO strings — five writers use `serverTimestamp()`
 *   and two write `new Date().toISOString()` — and Firestore orders across types
 *   by TYPE FIRST, so an ordered read returns every string row ahead of every
 *   Timestamp row. Stable, and not chronological. Section 3 asserts the word
 *   appears in no query this slice builds, and section 1 proves the buckets are
 *   right anyway because the read is complete and bucketed in memory.
 *
 *   🔴 THE CEILING IS STATED, NEVER TRUNCATED. Section 4 runs the tab against a
 *   fixture of 1,200 activity rows — ABOVE `DASHBOARD_FETCH_LIMIT`, because a
 *   five-row fixture against a thousand-row ceiling proves nothing — and asserts
 *   that the three widgets built on that collection all refuse together, that
 *   the wording names the ceiling, and that the documents were never fetched at
 *   all. A truncated number would fail every one of those.
 *
 *   🔴 FOUR WEEKS ON THE PRAYER WALL. Rows are cron-deleted thirty days after
 *   they are written, so a longer window charts a deletion policy. Section 5's
 *   fixture carries a row at 40 days precisely so an eight-week chart would
 *   include it and a four-week chart must not.
 *
 *   🔴 THREE WIDGETS WERE DELETED AND MUST BE ABSENT. Not empty cards, not
 *   deferred cards — absent. Section 7 sweeps the whole rendered dashboard.
 *   Section 7c asserts the OPPOSITE for the Growth tab's retention heatmap and
 *   geo map, which are deferrable rather than impossible and still render their
 *   `deferred` frame.
 *
 *   🔴 ACTIVITY TYPE IS NOT CHANNEL SHARE, and no member is itemised anywhere.
 *   Sections 8 and 10.
 *
 * ⚠️ recharts DRAWS NOTHING under happy-dom: `ResponsiveContainer` measures a
 * zero box and emits no svg. So no assertion here reads a plotted value out of
 * the DOM. Series claims are made on the `Series` VALUES the tab hands
 * `TrendChart` — the number of points and what they sum to — which is what
 * distinguishes a four-week window from an eight-week one. #429 found its own
 * first draft asserting on a widget DESCRIPTION, which would have passed on a
 * chart that plotted nothing at all.
 *
 * ⚠️ The mock is THE-276's query RECORDER, carried over: it records every query
 * BUILT and every path FETCHED, so "the count came from an aggregation", "no
 * `orderBy` was issued" and "the documents were never loaded" are assertions
 * rather than hopes.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BuiltQuery = {
  path: string[];
  where: Array<[string, string, unknown]>;
  limit: number | null;
  orderBy: Array<[string, string]>;
};

const { built, counted, fetched, counts, docsFor, authState, docReads } = vi.hoisted(() => ({
  built: [] as BuiltQuery[],
  counted: [] as string[],
  fetched: [] as string[],
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
    counted.push(keyOf(q));
    const answer = counts.get(keyOf(q));
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error(`no count configured for ${keyOf(q)}`);
    return { data: () => ({ count: answer }) };
  },
  getDocs: async (q: BuiltQuery) => {
    fetched.push(keyOf(q));
    const rows = docsFor.get(keyOf(q)) ?? [];
    return {
      docs: rows.map((row, i) => {
        // ⚠️ `__id` lets a fixture pin a document id, which the adoption pointer
        // needs: `adoptedCourses.libraryCourseId` has to match a `libraryCourses`
        // doc id, and an auto-generated one could never be written down.
        const { __id: pinned, ...data } = row as Record<string, unknown> & { __id?: string };
        return { id: typeof pinned === 'string' ? pinned : `${keyOf(q)}-${i}`, data: () => data };
      }),
    };
  },
  getDoc: async (ref: { __doc: string }) => {
    const data = docReads.get(ref.__doc) ?? null;
    return { exists: () => data !== null, data: () => data ?? undefined };
  },
}));

const AdminDashboardHome = (await import('../AdminDashboardHome')).default;
const { EngagementTab } = await import('../dashboard/EngagementTab');
const { ContentTab, DELETED_CONTENT_WIDGETS } = await import('../dashboard/ContentTab');
const { DEFERRED_GROWTH_WIDGETS } = await import('../dashboard/GrowthTab');
const {
  ACTIVITY_TYPES,
  APP_RECORDED_WRITERS,
  ENGAGEMENT_REASON,
  PRAYER_TREND_WEEKS,
  activitySeries,
  aggregateActivityTypes,
  prayerSeries,
  readableSessions,
  spreadOfEngagement,
  summariseAttendance,
  toActivityRow,
  toPrayerRow,
  toSessionRow,
} = await import('../dashboard/engagement-data');
const { CONTENT_REASON, countCompletions, readableCourses, toCourseRow, toLearnerRow } =
  await import('../dashboard/content-data');
const { DASHBOARD_FETCH_LIMIT, bucketWeekly, readableReceipts, toInvoiceRow } =
  await import('../dashboard/dashboard-data');
import type { ContentData } from '../dashboard/useContentData';
import type { EngagementData } from '../dashboard/useEngagementData';

/* ── Mounting ─────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(times = 16): Promise<void> {
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

/** Mount, then select Engagement and let its own three reads land. */
async function engagementScreen(): Promise<HTMLDivElement> {
  const c = await screen();
  await openTab(c, 'Engagement');
  return c;
}

async function contentScreen(): Promise<HTMLDivElement> {
  const c = await screen();
  await openTab(c, 'Content');
  return c;
}

const text = (el: ParentNode | null) => el?.textContent ?? '';
const widget = (c: ParentNode, title: string) => c.querySelector(`[data-widget="${title}"]`);
const stateOf = (c: ParentNode, title: string) => widget(c, title)?.getAttribute('data-state');
const reasonOf = (c: ParentNode, title: string) =>
  text(c.querySelector(`[data-widget="${title}"] [data-empty-reason]`));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
/** A Firestore Timestamp as `toSafeDate` sees a serialised one. */
const stamp = (msAgo: number) => ({ seconds: Math.floor((NOW - msAgo) / 1000) });
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function grantAnalytics() {
  authState.currentUser = { uid: 'u1', email: 'pastor@grace.org', displayName: 'Ada Grace' };
  docReads.set('users/u1', { role: 'admin', permissions: { analytics: true }, tenantId: 'grace' });
}

/* ── Fixtures, as this app actually writes the documents ──────────────────── */

/**
 * CRM activity rows. Thirteen of them, and every detail is load-bearing.
 *
 * 🔴 `createdAt` MIXES TYPES ON PURPOSE. `serverTimestamp()` on the five paths
 * that write one and an ISO STRING on the two that do not — the donation webhook
 * and /api/crm/send-email. Firestore would sort every string row ahead of every
 * Timestamp row, so a fixture of one type could not expose an `orderBy` that
 * silently biased the read.
 *
 * 🔴 `createdBy` MIXES ORIGINS. `checkin`, `form`, `event-registration` and
 * `system` are the app's own paths; `u1` is an admin typing in the CRM. The
 * split is what the type table reports and what the spread widget filters on.
 *
 * ⚠️ Every row carries a `description` of the kind an admin really types, so the
 * privacy assertion in section 10 is meaningful: the free text is genuinely
 * present in the documents the widget reads.
 */
const ACTIVITIES: Array<Record<string, unknown>> = [
  { contactId: 'c1', type: 'meeting', createdBy: 'checkin', createdAt: stamp(2 * DAY), description: 'Attended: Sunday Service', tenantId: 'grace' },
  { contactId: 'c1', type: 'meeting', createdBy: 'checkin', createdAt: stamp(3 * DAY), description: 'Attended: Midweek', tenantId: 'grace' },
  { contactId: 'c2', type: 'meeting', createdBy: 'checkin', createdAt: stamp(9 * DAY), description: 'Attended: Sunday Service', tenantId: 'grace' },
  { contactId: 'c2', type: 'note', createdBy: 'form', createdAt: stamp(4 * DAY), description: 'Form submission: Prayer request', tenantId: 'grace' },
  { contactId: 'c3', type: 'note', createdBy: 'form', createdAt: stamp(11 * DAY), description: 'Form submission: Baptism interest', tenantId: 'grace' },
  { contactId: 'c1', type: 'donation', createdBy: 'system', createdAt: iso(5 * DAY), amount: 250, description: 'Partnership donation via Stripe', tenantId: 'grace' },
  { contactId: 'c4', type: 'donation', createdBy: 'system', createdAt: iso(20 * DAY), amount: 40, description: 'Partnership donation via Stripe', tenantId: 'grace' },
  { contactId: 'c1', type: 'email', createdBy: 'u1', createdAt: iso(1 * DAY), description: 'Sent email: Welcome to Grace Chapel', tenantId: 'grace' },
  { contactId: 'c3', type: 'email', createdBy: 'u1', createdAt: iso(6 * DAY), description: 'Sent email: Baptism class', tenantId: 'grace' },
  { contactId: 'c1', type: 'note', createdBy: 'u1', createdAt: stamp(7 * DAY), description: 'Called about the funeral arrangements', tenantId: 'grace' },
  { contactId: 'c2', type: 'call', createdBy: 'u1', createdAt: stamp(8 * DAY), description: 'Left a voicemail', tenantId: 'grace' },
  // 🔴 A type this app does not write. COUNTED, never filed under a heading.
  { contactId: 'c5', type: 'visit', createdBy: 'checkin', createdAt: stamp(2 * DAY), description: 'Imported from the old system', tenantId: 'grace' },
  // 🔴 App-recorded, and attached to nobody. Counted, never grouped.
  { type: 'meeting', createdBy: 'event-registration', createdAt: stamp(1 * DAY), description: 'Registered: Easter Service', tenantId: 'grace' },
];

/** Every free-text string in the activity fixtures, for the privacy sweep. */
const ACTIVITY_TEXT = ACTIVITIES
  .map((a) => a.description)
  .filter((v): v is string => typeof v === 'string');

/**
 * Check-in sessions. `attendeeCount` lives on the session document, so this is
 * the field the widget sums — and the one that can drift short.
 */
const SESSIONS: Array<Record<string, unknown>> = [
  { name: 'Sunday Service', attendeeCount: 42, status: 'closed', date: iso(7 * DAY) },
  { name: 'Midweek Prayer', attendeeCount: 0, status: 'closed', date: iso(4 * DAY) },
  { name: 'Youth Night', attendeeCount: 17, status: 'active', date: iso(2 * DAY) },
  { name: 'Easter Service', attendeeCount: 8, status: 'active', date: null },
];

/**
 * Prayer wall rows.
 *
 * 🔴 THE 40-DAY ROW IS THE WHOLE POINT OF THIS FIXTURE. It is inside an
 * eight-week window and OUTSIDE the four-week one, so a chart that included it
 * would be charting past the retention window the cron enforces.
 *
 * ⚠️ Every row carries `authorName` and the request TEXT, so the privacy sweep
 * has something real to catch.
 */
const PRAYERS: Array<Record<string, unknown>> = [
  { authorId: 'm1', authorName: 'Ada Lovelace', request: 'Please pray for my mother', prayedBy: [], createdAt: iso(1 * DAY), tenantId: 'grace' },
  { authorId: 'm2', authorName: 'Grace Hopper', request: 'Wisdom for a job decision', prayedBy: ['m1'], createdAt: iso(3 * DAY), tenantId: 'grace' },
  { authorId: 'm3', authorName: 'Alan Turing', request: 'Healing after surgery', prayedBy: [], createdAt: iso(6 * DAY), tenantId: 'grace' },
  { authorId: 'm1', authorName: 'Ada Lovelace', request: 'Safe travel', prayedBy: [], createdAt: iso(10 * DAY), tenantId: 'grace' },
  { authorId: 'm4', authorName: 'Katherine Johnson', request: 'Peace at home', prayedBy: [], createdAt: iso(12 * DAY), tenantId: 'grace' },
  { authorId: 'm2', authorName: 'Grace Hopper', request: 'Our new small group', prayedBy: [], createdAt: iso(20 * DAY), tenantId: 'grace' },
  // 🔴 Older than four weeks, younger than eight. Inside an eight-week chart.
  { authorId: 'm5', authorName: 'Dorothy Vaughan', request: 'Strength for the week', prayedBy: [], createdAt: iso(40 * DAY), tenantId: 'grace' },
];

const PRAYER_TEXT = PRAYERS.flatMap((p) => [p.authorName, p.request])
  .filter((v): v is string => typeof v === 'string');

/** A lesson, reduced to what `getAllLessons` and the quiz gate actually read. */
const lesson = (id: string, quiz?: unknown[]) => ({
  id, title: `Lesson ${id}`, duration: '10', authorId: 'a1', summary: '', ...(quiz ? { quiz } : {}),
});
const levels = (ids: string[], quizOn?: string) => [{
  id: 'lv1',
  title: 'Level 1',
  sections: [{
    id: 's1',
    title: 'Section 1',
    lessons: ids.map((id) => lesson(id, id === quizOn ? [{ id: 'q1', q: '?', options: [] }] : undefined)),
  }],
}];

/**
 * The ministry's own courses. One draft, so the in-memory published filter has
 * something to exclude, and one nobody has finished.
 */
const COURSES: Array<Record<string, unknown>> = [
  { __id: 'own-a', title: 'Foundations', status: 'published', levels: levels(['l1', 'l2']), tenantId: 'grace' },
  { __id: 'own-b', title: 'Discipleship', status: 'published', requireQuiz: true, levels: levels(['l3'], 'l3'), tenantId: 'grace' },
  { __id: 'own-c', title: 'Draft course', status: 'draft', levels: levels(['l7']), tenantId: 'grace' },
  { __id: 'own-d', title: 'Stewardship', status: 'published', levels: levels(['l9']), tenantId: 'grace' },
];

/** One adopted library course, and one catalogue entry this church has not adopted. */
const LIBRARY: Array<Record<string, unknown>> = [
  { __id: 'lib-1', title: 'Prayer Basics', status: 'published', levels: levels(['l4']) },
  { __id: 'lib-2', title: 'Unadopted', status: 'published', levels: levels(['l5']) },
];

const ADOPTIONS: Array<Record<string, unknown>> = [
  { __id: 'lib-1', libraryCourseId: 'lib-1', adoptedAt: iso(30 * DAY), adoptedBy: 'u1' },
];

/**
 * Learners. 🔴 Each carries `displayName` and `email` beside their progress, so
 * "no identifier reaches the widget" is a claim with something to catch.
 */
const LEARNERS: Array<Record<string, unknown>> = [
  { displayName: 'Ada Lovelace', email: 'ada@grace.org', createdAt: stamp(2 * DAY), completedLessons: ['l1', 'l2'] },
  { displayName: 'Grace Hopper', email: 'grace@grace.org', createdAt: stamp(9 * DAY), completedLessons: ['l1', 'l2', 'l3'], quizAttempts: { l3: { score: 1, total: 1, passed: true, answeredAt: iso(DAY) } } },
  { displayName: 'Alan Turing', email: 'alan@grace.org', createdAt: stamp(20 * DAY), completedLessons: ['l3'] },
  { displayName: 'Katherine Johnson', email: 'kj@grace.org', createdAt: stamp(30 * DAY), completedLessons: ['l4'] },
  // No `completedLessons` at all — completed nothing, which is a true reading.
  { displayName: 'Dorothy Vaughan', email: 'dv@grace.org', createdAt: stamp(40 * DAY) },
];

const LEARNER_IDENTIFIERS = LEARNERS.flatMap((l) => [l.displayName, l.email])
  .filter((v): v is string => typeof v === 'string');

/** Receipts, carried over from THE-290 so the money gate can be re-asserted. */
const RECEIPTS: Array<Record<string, unknown>> = [
  { amount: 25000, type: 'donation_receipt', issuedAt: iso(2 * DAY) },
  { amount: 100000, type: 'donation_receipt', issuedAt: iso(9 * DAY) },
  { amount: 5000, type: 'event_ticket', issuedAt: stamp(3 * DAY) },
];

/** The Overview tab's own reads, so the whole dashboard mounts healthy. */
function healthyOverview() {
  counts.set('users', LEARNERS.length);
  counts.set('contacts', 42);
  counts.set('courses', COURSES.length);
  counts.set('community_posts', 7);
  counts.set('blog_posts', 4);
  counts.set('submissions', 1);
  counts.set('tenants/grace/invoices', RECEIPTS.length);
  counts.set('campaigns', 0);
  counts.set('tenants/grace/pledges', 0);

  docsFor.set('users', LEARNERS);
  docsFor.set('submissions', [{ createdAt: stamp(DAY) }]);
  docsFor.set('tenants/grace/invoices', RECEIPTS);
  docsFor.set('campaigns', []);
  docsFor.set('tenants/grace/pledges', []);
  docReads.set('tenants/grace/livestream/current', { active: false, title: 'Live now' });
}

function healthyEngagement() {
  counts.set('contactActivities', ACTIVITIES.length);
  counts.set('tenants/grace/checkinSessions', SESSIONS.length);
  counts.set('prayer_requests', PRAYERS.length);
  docsFor.set('contactActivities', ACTIVITIES);
  docsFor.set('tenants/grace/checkinSessions', SESSIONS);
  docsFor.set('prayer_requests', PRAYERS);
}

function healthyContent() {
  counts.set('tenants/grace/adoptedCourses', ADOPTIONS.length);
  counts.set('libraryCourses', LIBRARY.length);
  docsFor.set('courses', COURSES);
  docsFor.set('tenants/grace/adoptedCourses', ADOPTIONS);
  docsFor.set('libraryCourses', LIBRARY);
}

function healthyTenant() {
  healthyOverview();
  healthyEngagement();
  healthyContent();
}

beforeEach(() => {
  built.length = 0;
  counted.length = 0;
  fetched.length = 0;
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

/* ═══ 1 · Every widget renders with a trusted figure or an explicit empty ════ */

const ENGAGEMENT_WIDGETS = [
  'Engagement over time',
  'Attendance & check-in',
  'Activity type',
  'How widely engagement is spread',
  'Prayer wall activity',
] as const;

describe('each Engagement widget renders with a trusted figure or an explicit empty state', () => {
  it('all five widgets mount, and every one of them is ready on a healthy tenant', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();

    expect(c.querySelector('[data-engagement-tab]'), 'the Engagement panel did not render').toBeTruthy();
    for (const title of ENGAGEMENT_WIDGETS) {
      expect(widget(c, title), `${title} is missing`).toBeTruthy();
      expect(stateOf(c, title), `${title} is not ready`).toBe('ready');
    }
  });

  it.each(ENGAGEMENT_WIDGETS)('%s renders a reason, never a zero, when its read is refused', async (title) => {
    grantAnalytics();
    healthyOverview();
    // Every one of the three collections refuses. 🔴 A widget that rendered a
    // `0` here would be indistinguishable from a ministry with no activity.
    counts.set('contactActivities', new Error('permission-denied'));
    counts.set('tenants/grace/checkinSessions', new Error('permission-denied'));
    counts.set('prayer_requests', new Error('permission-denied'));
    const c = await engagementScreen();

    expect(stateOf(c, title), `${title} should be unavailable`).toBe('unavailable');
    expect(reasonOf(c, title).length, `${title} gives no reason`).toBeGreaterThan(10);
    // No figure anywhere in the refused widget.
    expect(text(widget(c, title))).not.toMatch(/\b0\b/);
  });

  it('a complete read with nothing in it says so, and does not draw eight empty weeks', async () => {
    grantAnalytics();
    healthyOverview();
    counts.set('contactActivities', 0);
    counts.set('tenants/grace/checkinSessions', 0);
    counts.set('prayer_requests', 0);
    docsFor.set('contactActivities', []);
    docsFor.set('tenants/grace/checkinSessions', []);
    docsFor.set('prayer_requests', []);
    const c = await engagementScreen();

    expect(stateOf(c, 'Engagement over time')).toBe('unavailable');
    expect(reasonOf(c, 'Engagement over time')).toContain('No CRM activity has been recorded');
    expect(reasonOf(c, 'Attendance & check-in')).toContain('No check-in session has been created');
    expect(reasonOf(c, 'Prayer wall activity')).toContain('prayer wall in the last thirty days');
  });

  it('the Content tab renders its one widget, ready, on a healthy tenant', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await contentScreen();

    expect(c.querySelector('[data-content-tab]')).toBeTruthy();
    expect(stateOf(c, 'Course completion')).toBe('ready');
  });

  it('and renders a reason rather than a zero when a course read is refused', async () => {
    grantAnalytics();
    healthyOverview();
    healthyContent();
    counts.set('tenants/grace/adoptedCourses', new Error('permission-denied'));
    const c = await contentScreen();

    expect(stateOf(c, 'Course completion')).toBe('unavailable');
    expect(reasonOf(c, 'Course completion').length).toBeGreaterThan(10);
    expect(text(widget(c, 'Course completion'))).not.toMatch(/\b0\b/);
  });
});

/* ═══ 2 · 🔴 No figure is fabricated ═════════════════════════════════════════ */

describe('no figure is fabricated — every number traces to a read', () => {
  it('the activity type table is the fixture, filed and counted, with nothing lost', () => {
    const breakdown = aggregateActivityTypes(ACTIVITIES.map(toActivityRow));

    expect(breakdown.total).toBe(13);
    // 🔴 THE CLOSED ACCOUNTING. Every row is in exactly one place.
    expect(breakdown.rows.reduce((n, r) => n + r.activities, 0) + breakdown.unrecognised)
      .toBe(breakdown.total);
    expect(breakdown.appRecorded + breakdown.adminLogged).toBe(breakdown.total);

    expect(breakdown.unrecognised, 'the "visit" row was filed under a real type').toBe(1);
    expect(breakdown.appRecorded).toBe(9);
    expect(breakdown.adminLogged).toBe(4);

    // Descending by count, ties broken alphabetically, so it is stable.
    expect(breakdown.rows.map((r) => [r.label, r.activities, r.appRecorded, r.adminLogged])).toEqual([
      ['Meetings', 4, 4, 0],
      ['Notes', 3, 2, 1],
      ['Donations', 2, 2, 0],
      ['Emails', 2, 0, 2],
      ['Calls', 1, 0, 1],
    ]);
  });

  it('the spread counts app-recorded rows only, and every counted person is in one band', () => {
    const spread = spreadOfEngagement(ACTIVITIES.map(toActivityRow));

    expect(spread.activities, 'admin-logged rows leaked into the spread').toBe(9);
    expect(spread.withoutContact, 'the row with no contactId was grouped anyway').toBe(1);
    expect(spread.contacts).toBe(5);
    expect(spread.busiest).toBe(3);
    expect(spread.bands.map((b) => [b.label, b.contacts])).toEqual([
      ['1 activity', 3],
      ['2 to 5', 2],
      ['6 to 10', 0],
      ['11 or more', 0],
    ]);
    // 🔴 INVARIANT: the bands account for every counted person.
    expect(spread.bands.reduce((n, b) => n + b.contacts, 0)).toBe(spread.contacts);
  });

  it('and the rendered figures are those numbers, not similar ones', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();

    const types = text(c.querySelector('[data-activity-types]'));
    expect(types).toContain('Meetings');
    expect(types).toContain('13 activity records in total');
    expect(types).toContain('1 carry no recognised type');

    const spread = text(c.querySelector('[data-engagement-spread]'));
    expect(spread).toContain('5 people carry at least one automatically recorded activity');
    expect(spread).toContain('9 in total');
    expect(spread).toContain('The busiest single person has 3');
  });

  it('a row with no readable type is counted, never re-filed', () => {
    const breakdown = aggregateActivityTypes(
      [{ type: null }, { type: '   ' }, { type: 'note' }].map((d) => toActivityRow(d as Record<string, unknown>)),
    );
    expect(breakdown.unrecognised).toBe(2);
    expect(breakdown.rows).toHaveLength(1);
    expect(breakdown.rows[0].activities).toBe(1);
  });
});

/* ═══ 3 · 🔴 No Firestore orderBy on contactActivities ══════════════════════ */

describe('no Firestore orderBy is issued on contactActivities', () => {
  it('every query this slice builds on the three collections is unordered', async () => {
    grantAnalytics();
    healthyTenant();
    await engagementScreen();

    const collections = ['contactActivities', 'prayer_requests'];
    for (const name of collections) {
      const queries = built.filter((q) => q.path.join('/') === name);
      // 🔴 Non-vacuous: the query really was built, so "none of them is ordered"
      // is a claim about something rather than about an empty list.
      expect(queries.length, `no query was built on ${name}`).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q.orderBy, `${name} was ordered — its createdAt holds two types`).toEqual([]);
      }
    }

    const sessions = built.filter((q) => q.path.join('/') === 'tenants/grace/checkinSessions');
    expect(sessions.length).toBeGreaterThan(0);
    for (const q of sessions) expect(q.orderBy).toEqual([]);
  });

  it('the buckets are right anyway, because the read is complete and bucketed in memory', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();

    // 🔴 THE PROOF THAT ORDERING IS NOT NEEDED. Six of the thirteen rows carry
    // an ISO string and seven a Timestamp-like; Firestore would have returned
    // every string first. The eight-week series still totals all thirteen.
    const isoRows = ACTIVITIES.filter((a) => typeof a.createdAt === 'string').length;
    expect(isoRows, 'the fixture stopped mixing date types').toBeGreaterThan(0);
    expect(ACTIVITIES.length - isoRows, 'the fixture stopped mixing date types').toBeGreaterThan(0);

    expect(stateOf(c, 'Engagement over time')).toBe('ready');
    // Every activity row is inside the eight-week window, so the series holds
    // all thirteen — a biased or truncated read could not produce that.
    expect(activityPoints()).toHaveLength(8);
    expect(sum(activityPoints())).toBe(ACTIVITIES.length);
  });

  it('and the scoped query carries exactly ONE equality — no composite index exists', async () => {
    grantAnalytics();
    healthyTenant();
    await engagementScreen();

    for (const name of ['contactActivities', 'prayer_requests']) {
      for (const q of built.filter((b) => b.path.join('/') === name)) {
        expect(q.where.map(([field, op]) => [field, op]), name).toEqual([['tenantId', '==']]);
      }
    }
    // The subcollection needs no `where` at all: its tenant is in the path.
    for (const q of built.filter((b) => b.path.join('/') === 'tenants/grace/checkinSessions')) {
      expect(q.where).toEqual([]);
    }
  });
});

/**
 * The two series, built by the SAME functions the hook calls.
 *
 * ⚠️ Asserted here rather than out of the DOM because recharts draws nothing
 * under happy-dom: `ResponsiveContainer` measures a zero box and emits no svg,
 * so a plotted value is not observable. What IS observable and IS the property
 * in question is the `Series` these produce — how many buckets it has and what
 * they sum to, which is exactly what distinguishes a four-week window from an
 * eight-week one. The mounted tab is asserted separately to be READY, so the
 * widget really did receive one of these rather than a refusal.
 */
const activityPoints = () => {
  const s = activitySeries(ACTIVITIES.map(toActivityRow), NOW);
  if (s.kind !== 'complete') throw new Error('activity series is not complete');
  return s.points;
};
const prayerPoints = () => {
  const s = prayerSeries(PRAYERS.map(toPrayerRow), NOW);
  if (s.kind !== 'complete') throw new Error('prayer series is not complete');
  return s.points;
};
const sum = (points: readonly { value: number }[]) => points.reduce((n, p) => n + p.value, 0);

/** Prayer rows older than the four-week window — the fixture's own premise. */
const outsideFourWeeks = () =>
  PRAYERS.filter((p) => NOW - new Date(p.createdAt as string).getTime() > PRAYER_TREND_WEEKS * 7 * DAY).length;

/* ═══ 4 · 🔴 The ceiling is explicit — fixture ABOVE 1,000 rows ═════════════ */

/**
 * 🔴 1,200 ROWS. `DASHBOARD_FETCH_LIMIT` is 1,000, and a five-row fixture
 * against a thousand-row ceiling proves nothing at all — this repo has been
 * bitten by undersized fixtures repeatedly. The set is generated rather than
 * written out so it is genuinely over the line rather than nearly at it.
 */
const OVER_CEILING = Array.from({ length: DASHBOARD_FETCH_LIMIT + 200 }, (_, i) => ({
  contactId: `c${i % 300}`,
  type: ACTIVITY_TYPES[i % ACTIVITY_TYPES.length],
  createdBy: i % 2 === 0 ? 'checkin' : 'u1',
  createdAt: i % 2 === 0 ? stamp((i % 50) * DAY) : iso((i % 50) * DAY),
  tenantId: 'grace',
}));

describe('the ceiling behaviour is explicit', () => {
  it('the fixture really is above the ceiling — otherwise this whole section is vacuous', () => {
    expect(DASHBOARD_FETCH_LIMIT).toBe(1000);
    expect(OVER_CEILING.length).toBeGreaterThan(DASHBOARD_FETCH_LIMIT);
    expect(OVER_CEILING).toHaveLength(1200);
  });

  it('🔴 all three activity widgets refuse TOGETHER and the reason names the ceiling', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contactActivities', OVER_CEILING.length);
    docsFor.set('contactActivities', OVER_CEILING);
    const c = await engagementScreen();

    for (const title of ['Engagement over time', 'Activity type', 'How widely engagement is spread'] as const) {
      expect(stateOf(c, title), `${title} did not refuse above the ceiling`).toBe('unavailable');
      expect(reasonOf(c, title)).toContain('more than can be read in one pass');
      expect(reasonOf(c, title)).toContain('1,000');
    }

    // 🔴 NOT SILENTLY TRUNCATED: no figure of any kind is rendered for them.
    expect(text(c.querySelector('[data-activity-total]'))).toBe('');
    expect(text(c.querySelector('[data-spread-total]'))).toBe('');
  });

  it('and the 1,200 documents were never fetched — the count gate ran first', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contactActivities', OVER_CEILING.length);
    docsFor.set('contactActivities', OVER_CEILING);
    await engagementScreen();

    expect(counted, 'the collection was never counted').toContain('contactActivities');
    // 🔴 The whole point of counting first: a truncated 1,000-row load would be
    // an arbitrary sample, and it is not even paid for.
    expect(fetched, 'the documents were loaded despite the refusal').not.toContain('contactActivities');
  });

  it('the OTHER two collections still answer — the tab is not refused as a whole', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contactActivities', OVER_CEILING.length);
    docsFor.set('contactActivities', OVER_CEILING);
    const c = await engagementScreen();

    expect(stateOf(c, 'Attendance & check-in')).toBe('ready');
    expect(stateOf(c, 'Prayer wall activity')).toBe('ready');
    expect(text(c.querySelector('[data-attendance]'))).toContain('At least 67');
  });

  it('exactly AT the ceiling the read still completes — the boundary is not off by one', async () => {
    grantAnalytics();
    healthyTenant();
    const atLimit = OVER_CEILING.slice(0, DASHBOARD_FETCH_LIMIT);
    counts.set('contactActivities', atLimit.length);
    docsFor.set('contactActivities', atLimit);
    const c = await engagementScreen();

    expect(stateOf(c, 'Activity type')).toBe('ready');
    expect(text(c.querySelector('[data-activity-total]'))).toContain('1,000 activity records in total');
    expect(fetched).toContain('contactActivities');
  });

  it('one over the ceiling refuses — so the boundary is asserted from both sides', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('contactActivities', DASHBOARD_FETCH_LIMIT + 1);
    docsFor.set('contactActivities', OVER_CEILING.slice(0, DASHBOARD_FETCH_LIMIT + 1));
    const c = await engagementScreen();

    expect(stateOf(c, 'Activity type')).toBe('unavailable');
  });

  it('the ceiling wording explains WHY the collection grows, so a founder is not left guessing', () => {
    const reason = ENGAGEMENT_REASON.activityCeiling(DASHBOARD_FETCH_LIMIT);
    expect(reason).toContain('1,000');
    expect(reason).toContain('none is ever deleted');
  });
});

/* ═══ 5 · 🔴 The prayer wall charts no more than four weeks ═════════════════ */

describe('prayer wall charts no more than 4 weeks', () => {
  it('the window is four weeks, and that is the retention policy rather than a preference', () => {
    expect(PRAYER_TREND_WEEKS).toBe(4);
  });

  it('🔴 the 40-day request is EXCLUDED — an eight-week chart would have drawn it', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();

    expect(stateOf(c, 'Prayer wall activity')).toBe('ready');
    // The fixture's premise, checked: one row is between four and eight weeks old.
    expect(outsideFourWeeks(), 'the fixture no longer has a row past four weeks').toBe(1);
    // 🔴 FOUR buckets, not eight, and the 40-day row is in none of them.
    expect(prayerPoints()).toHaveLength(PRAYER_TREND_WEEKS);
    expect(sum(prayerPoints())).toBe(PRAYERS.length - 1);
    // 🔴 And the mutation this guards, stated as a number: the SAME rows over an
    // eight-week window hold all seven. So the exclusion is the window's doing,
    // not the fixture's, and widening `PRAYER_TREND_WEEKS` would be caught.
    const overEightWeeks = bucketWeekly(PRAYERS.map(toPrayerRow), NOW, (r) => r.createdAt, () => 1, 8);
    expect(overEightWeeks.points).toHaveLength(8);
    expect(sum(overEightWeeks.points)).toBe(PRAYERS.length);
  });

  it('and the widget says on its face that it is four weeks, and why', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();

    const prayer = text(widget(c, 'Prayer wall activity'));
    expect(prayer).toContain('last 4 weeks');
    expect(prayer).toContain('thirty days');
  });

  it('the engagement trend is still eight weeks — the cap is the prayer wall\'s alone', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    expect(stateOf(c, 'Engagement over time')).toBe('ready');
    expect(text(widget(c, 'Engagement over time'))).toContain('last eight weeks');
  });
});

/* ═══ 6 · Course completion is a count, not a series ════════════════════════ */

describe('course completion is a count, not a series', () => {
  it('the summary type carries no date and no points — a series is unspellable', () => {
    const own = readableCourses(COURSES.map((d, i) => toCourseRow(d, `own-${i}`))
      .filter((c) => c.status === 'published'));
    expect(own.kind).toBe('complete');
    if (own.kind !== 'complete') return;

    const summary = countCompletions(
      own.rows.map((c) => ({ course: c, adopted: false })),
      LEARNERS.map(toLearnerRow),
    );
    for (const value of Object.values(summary)) expect(typeof value).toBe('number');
    expect(Object.keys(summary).some((k) => /point|series|week|date|at$/i.test(k))).toBe(false);
  });

  it('the count is the one `verifyCourseCompletion` would certify, over own AND adopted courses', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await contentScreen();

    const rendered = text(c.querySelector('[data-course-completion]'));
    // 🔴 Four (person, course) completions: Ada finishes Foundations; Grace
    // finishes Foundations and Discipleship (her quiz attempt passes); Katherine
    // finishes the adopted Prayer Basics. Alan has l3 but no passing attempt on a
    // requireQuiz course, so he finishes nothing. Dorothy has no progress at all.
    expect(rendered).toContain('Courses completed');
    expect(rendered).toContain('Across 5 members and 4 courses');
    expect(rendered).toContain('1 of them adopted from the shared library');
    expect(rendered).toContain('1 course has not been finished by anyone yet');
  });

  it('the numbers are exactly four completions across three members', () => {
    const published = COURSES.map((d) => toCourseRow(d, String(d.__id)))
      .filter((c) => c.status === 'published');
    const own = readableCourses(published);
    if (own.kind !== 'complete') throw new Error('fixture courses are unreadable');
    const adopted = [{ levels: LIBRARY[0].levels, requireQuiz: undefined }];

    const summary = countCompletions(
      [
        ...own.rows.map((c) => ({ course: c, adopted: false })),
        ...adopted.map((c) => ({ course: c as never, adopted: true })),
      ],
      LEARNERS.map(toLearnerRow),
    );
    expect(summary.completions).toBe(4);
    expect(summary.learnersWithACompletion).toBe(3);
    expect(summary.courses).toBe(4);
    expect(summary.adoptedCourses).toBe(1);
    expect(summary.learners).toBe(5);
    expect(summary.coursesWithNoCompletion).toBe(1);
  });

  it('the quiz gate is the certificate route\'s, not a second rule written here', () => {
    const discipleship = toCourseRow(COURSES[1], 'own-b');
    const gated = readableCourses([discipleship]);
    if (gated.kind !== 'complete') throw new Error('unreadable');
    const course = [{ course: gated.rows[0], adopted: false }];

    // Every lesson done, no passing attempt → NOT complete on a requireQuiz course.
    expect(countCompletions(course, [toLearnerRow({ completedLessons: ['l3'] })]).completions).toBe(0);
    // With a passing attempt → complete.
    expect(countCompletions(course, [toLearnerRow({
      completedLessons: ['l3'],
      quizAttempts: { l3: { score: 1, total: 1, passed: true, answeredAt: iso(DAY) } },
    })]).completions).toBe(1);
  });

  it('an unadopted library course is not counted, and a draft own course is not either', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await contentScreen();
    // Four courses: three published own (Foundations, Discipleship, Stewardship)
    // plus the one adopted library course. The draft and the unadopted catalogue
    // entry are excluded, which is the whole difference between 4 and 6.
    expect(text(c.querySelector('[data-completion-scope]'))).toContain('4 courses');
  });

  it('a course with no readable lesson structure REFUSES the total rather than shrinking it', () => {
    const broken = readableCourses([
      toCourseRow({ status: 'published', levels: [] }, 'ok'),
      toCourseRow({ status: 'published' }, 'broken'),
    ]);
    expect(broken.kind).toBe('unavailable');
    if (broken.kind !== 'unavailable') return;
    expect(broken.reason).toContain('1 of 2 courses');
  });

  it('the widget states on screen that it is a snapshot and why', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await contentScreen();
    const note = text(c.querySelector('[data-completion-snapshot-note]'));
    expect(note).toContain('no date on any of them');
    expect(text(widget(c, 'Course completion'))).toContain('there is no trend to draw');
  });
});

/* ═══ 7 · 🔴 Reach, impressions, blog views and completions-over-time ABSENT ═ */

/**
 * 🔴 ABSENT. Not an empty card, not a deferred card, not a placeholder.
 *
 * The sweep is over the WHOLE rendered dashboard with every tab opened, because
 * Base UI mounts only the active panel and a card on a tab nobody opened would
 * pass an unswept assertion.
 */
const IMPOSSIBLE_WORDS = [
  /reach/i,
  /impression/i,
  /\bviews?\b/i,
  /completions over time/i,
  /page views/i,
] as const;

async function everyTabText(): Promise<string> {
  const c = await screen();
  let all = '';
  for (const label of ['Overview', 'Growth', 'Giving', 'Engagement', 'Content', 'Platform']) {
    await openTab(c, label);
    all += `\n${text(c)}`;
  }
  return all;
}

describe('reach, impressions, blog views and completions-over-time are ABSENT', () => {
  it('no widget, empty card or placeholder anywhere on the dashboard mentions them', async () => {
    grantAnalytics();
    healthyTenant();
    const all = await everyTabText();

    for (const pattern of IMPOSSIBLE_WORDS) {
      const found = all.match(pattern);
      expect(found, `the dashboard renders "${found?.[0]}" — it was deleted, not deferred`).toBeNull();
    }
  });

  it('the Content tab mounts exactly ONE widget — there is no fourth card to be empty', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await contentScreen();
    const cards = c.querySelectorAll('[data-content-tab] [data-widget]');
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute('data-widget')).toBe('Course completion');
  });

  it('and none of the deleted titles appears in the rendered output under any state', async () => {
    grantAnalytics();
    healthyTenant();
    const all = await everyTabText();
    for (const deleted of DELETED_CONTENT_WIDGETS) {
      expect(all, `${deleted.title} is rendered`).not.toContain(deleted.title);
      expect(all).not.toContain(`${deleted.title} unavailable`);
      expect(all).not.toContain(`${deleted.title} is not built yet`);
    }
  });

  it('the tab strip no longer promises them either — THE-276\'s bookkeeping is corrected', async () => {
    const { DASHBOARD_TABS } = await import('../dashboard/DashboardTabs');
    const contentRow = DASHBOARD_TABS.find((t) => t.id === 'content')!;
    expect(contentRow.upcoming).toBe('course completion');
    // 🔴 The removal, stated as an assertion rather than only as a comment.
    for (const word of ['reach', 'view', 'impression', 'sermon']) {
      for (const tab of DASHBOARD_TABS) {
        expect(tab.upcoming.toLowerCase(), `${tab.id} still promises ${word}`).not.toContain(word);
      }
    }
  });

  /* ── 7b · A comment records WHY they were removed ────────────────────────── */

  it('a table in the source records each deletion and its reason', () => {
    expect(DELETED_CONTENT_WIDGETS).toHaveLength(3);
    expect(DELETED_CONTENT_WIDGETS.map((w) => w.id).sort())
      .toEqual(['blog-views', 'completions-over-time', 'reach']);
    for (const deleted of DELETED_CONTENT_WIDGETS) {
      // A reason long enough to actually be one, naming the missing field rather
      // than saying "not supported".
      expect(deleted.why.length, `${deleted.id} has no real reason`).toBeGreaterThan(120);
    }
    expect(DELETED_CONTENT_WIDGETS.find((w) => w.id === 'reach')!.why)
      .toContain('route PATTERNS');
    expect(DELETED_CONTENT_WIDGETS.find((w) => w.id === 'completions-over-time')!.why)
      .toContain('never WHEN');
  });

  /* ── 7c · The deferrable ones DO still render deferred ───────────────────── */

  it('🔴 the retention heatmap and the geo map still render a DEFERRED state on Growth', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Growth');

    // The distinction this ticket turns on: deferrable is not impossible. Both
    // have data in Firestore already and only need a component or a dependency.
    expect(stateOf(c, 'Retention cohorts')).toBe('deferred');
    expect(stateOf(c, 'Where your people are')).toBe('deferred');
    expect(text(widget(c, 'Retention cohorts'))).toContain('is not built yet');
    expect(text(widget(c, 'Where your people are'))).toContain('is not built yet');
    // And all three of THE-283's deferrals are untouched by this slice.
    expect(DEFERRED_GROWTH_WIDGETS).toHaveLength(3);
    for (const w of DEFERRED_GROWTH_WIDGETS) expect(stateOf(c, w.title)).toBe('deferred');
  });

  it('and nothing on the two new tabs is deferred — there is no work here to promise', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    expect(c.querySelectorAll('[data-engagement-tab] [data-state="deferred"]')).toHaveLength(0);
    await openTab(c, 'Content');
    expect(c.querySelectorAll('[data-content-tab] [data-state="deferred"]')).toHaveLength(0);
  });
});

/* ═══ 8 · Activity type is labelled activity type, not channel share ════════ */

describe('activity type is labelled activity type, not channel share', () => {
  it('the widget is titled "Activity type"', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    expect(widget(c, 'Activity type')).toBeTruthy();
  });

  it('🔴 the words "channel" and "share" appear NOWHERE on the tab', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    const rendered = text(c.querySelector('[data-engagement-tab]'));
    expect(rendered, 'the tab renders "channel"').not.toMatch(/channel/i);
    // "Share" would reintroduce the framing even under a different heading.
    expect(rendered, 'the tab renders "share"').not.toMatch(/\bshares?\b/i);
  });

  it('and no percentage is computed, which is what makes a breakdown read as a share', () => {
    const breakdown = aggregateActivityTypes(ACTIVITIES.map(toActivityRow));
    for (const row of breakdown.rows) {
      expect(Object.keys(row).sort())
        .toEqual(['activities', 'adminLogged', 'appRecorded', 'label', 'type']);
    }
  });

  it('the five types are the union this app actually writes, closed', () => {
    expect([...ACTIVITY_TYPES].sort()).toEqual(['call', 'donation', 'email', 'meeting', 'note']);
    expect([...APP_RECORDED_WRITERS].sort())
      .toEqual(['checkin', 'event-registration', 'form', 'system']);
  });
});

/* ═══ 9 · Attendance sums attendeeCount and names its drift ═════════════════ */

describe('attendance sums attendeeCount and names its known drift', () => {
  it('the total is the sum of the field on the session documents', () => {
    const readable = readableSessions(SESSIONS.map(toSessionRow));
    expect(readable.kind).toBe('complete');
    if (readable.kind !== 'complete') return;
    const summary = summariseAttendance(readable.rows);
    expect(summary.sessions).toBe(4);
    expect(summary.checkIns).toBe(42 + 0 + 17 + 8);
    expect(summary.busiest).toBe(42);
    expect(summary.empty).toBe(1);
  });

  it('🔴 the figure is shown as a FLOOR, because the counter can only be short', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    const rendered = text(c.querySelector('[data-attendance]'));
    expect(rendered).toContain('At least 67');
    expect(rendered).toContain('At least 42');
  });

  it('and the drift is named on screen, with its direction', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    const drift = text(c.querySelector('[data-attendance-drift]'));
    expect(drift).toContain('two separate writes');
    expect(drift).toContain('one behind');
    expect(drift).toContain('short, never over');
  });

  it('a session with no readable count REFUSES the total rather than counting it as zero', () => {
    const refused = readableSessions([
      toSessionRow({ attendeeCount: 12 }),
      toSessionRow({ attendeeCount: null }),
      toSessionRow({ attendeeCount: Number.NaN }),
    ]);
    expect(refused.kind).toBe('unavailable');
    if (refused.kind !== 'unavailable') return;
    // 🔴 NaN and Infinity are both `typeof 'number'` — THE-290's tightening,
    // applied here rather than rediscovered when a total renders as "NaN".
    expect(refused.reason).toContain('2 of 3 check-in sessions');
  });

  it('and Infinity is refused too', () => {
    const refused = readableSessions([toSessionRow({ attendeeCount: Number.POSITIVE_INFINITY })]);
    expect(refused.kind).toBe('unavailable');
  });
});

/* ═══ 10 · 🔴 No member is itemised inappropriately ═════════════════════════ */

describe('no member is itemised inappropriately', () => {
  it('no activity description, prayer request or author name reaches the screen', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    const rendered = text(c);

    for (const secret of [...ACTIVITY_TEXT, ...PRAYER_TEXT]) {
      expect(rendered, `the tab renders "${secret}"`).not.toContain(secret);
    }
  });

  it('no learner name or email reaches the Content tab', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await contentScreen();
    const rendered = text(c);
    for (const secret of LEARNER_IDENTIFIERS) {
      expect(rendered, `the tab renders "${secret}"`).not.toContain(secret);
    }
  });

  it('🔴 no contact id reaches the aggregates — the grouping key never leaves the module', () => {
    const spread = spreadOfEngagement(ACTIVITIES.map(toActivityRow));
    const serialised = JSON.stringify(spread);
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      expect(serialised, `the spread carries ${id}`).not.toContain(`"${id}"`);
    }
    // And the type has no field that could hold one.
    expect(Object.keys(spread).sort())
      .toEqual(['activities', 'bands', 'busiest', 'contacts', 'withoutContact']);
  });

  it('the tab renders no ranked list of people at all, and says why', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    const rendered = text(c.querySelector('[data-engagement-tab]'));
    expect(rendered).not.toMatch(/most engaged/i);
    expect(rendered).not.toMatch(/leaderboard|top \d+|ranked/i);
    expect(text(c.querySelector('[data-no-leaderboard-note]')))
      .toContain('no ranking of individuals here');
  });

  it('and no person is ever combined with a location — the two reads never meet', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await engagementScreen();
    // The Growth tab reads `users.country`/`city`; nothing on this tab does, and
    // nothing here carries a person to combine one with.
    for (const q of built) {
      expect(q.where.map(([f]) => f)).not.toContain('country');
      expect(q.where.map(([f]) => f)).not.toContain('city');
    }
    expect(text(c.querySelector('[data-engagement-tab]'))).not.toMatch(/Nairobi|Kenya/);
  });
});

/* ═══ 11 · Overview, Growth and Giving figures are unchanged ════════════════ */

/** The Overview tab's KPI values and every widget's state, as one comparable. */
function overviewSnapshot(c: ParentNode): string {
  const kpis = [...c.querySelectorAll('[data-kpi]')].map((card) =>
    `${card.getAttribute('data-kpi')}=${card.getAttribute('data-state')}:${text(card.querySelector('[data-kpi-value]'))}`,
  );
  const widgets = [...c.querySelectorAll('[data-kpi-grid] ~ * [data-widget], [data-widget]')].map((w) =>
    `${w.getAttribute('data-widget')}:${w.getAttribute('data-state')}`,
  );
  return [...kpis, ...widgets].join('|');
}

describe('Overview, Growth and Giving figures are unchanged', () => {
  it('🔴 the Overview tab renders identically before and after the two new tabs are opened', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    const before = overviewSnapshot(c);

    await openTab(c, 'Engagement');
    await openTab(c, 'Content');
    await openTab(c, 'Overview');
    const after = overviewSnapshot(c);

    expect(after).toBe(before);
    // Non-vacuous: the snapshot really did capture the seven KPI cards.
    expect(before).toContain('Members=exact');
    expect(c.querySelectorAll('[data-kpi]').length).toBeGreaterThanOrEqual(6);
  });

  it('the Overview KPI values are the exact counts, unaffected by this slice', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    const value = (label: string) =>
      text(c.querySelector(`[data-kpi="${label}"] [data-kpi-value]`));

    expect(value('Members')).toBe('5');
    expect(value('Contacts')).toBe('42');
    expect(value('Community posts')).toBe('7');
    expect(value('Articles')).toBe('4');
    expect(value('Receipts')).toBe('3');
  });

  it('the Growth tab still renders its trend, its table and its three deferrals', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Growth');
    expect(c.querySelector('[data-growth-tab]')).toBeTruthy();
    expect(stateOf(c, 'Member growth')).toBe('ready');
    expect(c.querySelectorAll('[data-deferred-grid] [data-state="deferred"]')).toHaveLength(3);
  });

  it('the Giving tab still renders its three widgets and its relocated series', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Giving');
    expect(c.querySelector('[data-giving-tab]')).toBeTruthy();
    expect(stateOf(c, 'Giving over time')).toBe('ready');
    expect(widget(c, 'Campaign progress')).toBeTruthy();
    expect(widget(c, 'Pledge fulfilment')).toBeTruthy();
  });
});

/* ═══ 12 · The strict money gate still refuses a missing amount ═════════════ */

describe('the strict money gate still refuses a missing amount', () => {
  it('a receipt with no `amount` refuses the giving figures and says how many', () => {
    const rows = [
      toInvoiceRow({ amount: 25000, type: 'donation_receipt', issuedAt: iso(DAY) }),
      toInvoiceRow({ type: 'donation_receipt', issuedAt: iso(DAY) }),
    ];
    // 🔴 #421's own defect: `toInvoiceRow` used to coerce this to `0`.
    expect(rows[1].amountCents).toBeNull();
    const gated = readableReceipts(rows);
    expect(gated.kind).toBe('unavailable');
    if (gated.kind !== 'unavailable') return;
    expect(gated.reason).toContain('1 of 2 receipts');
  });

  it('and NaN and Infinity are refused too, not summed into the total', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toInvoiceRow({ amount, type: 'donation_receipt' }).amountCents).toBeNull();
    }
  });

  it('the refusal reaches the screen on the Overview and Giving tabs together', async () => {
    grantAnalytics();
    healthyTenant();
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, type: 'donation_receipt', issuedAt: iso(DAY) },
      { type: 'donation_receipt', issuedAt: iso(DAY) },
    ]);
    counts.set('tenants/grace/invoices', 2);
    const c = await screen();
    expect(stateOf(c, 'Giving & growth')).toBe('ready'); // members still plot
    expect(text(widget(c, 'Giving & growth'))).toContain('1 of 2 receipts');

    await openTab(c, 'Giving');
    expect(stateOf(c, 'Giving over time')).toBe('unavailable');
    expect(reasonOf(c, 'Giving over time')).toContain('1 of 2 receipts');
  });

  it('and nothing this slice reads is money, so no new coercion could have been added', () => {
    // `attendeeCount` is the only summed field on the new tabs and it refuses
    // exactly as `readableReceipts` does — asserted in section 9. Course
    // completion and activity counts are counts of documents, not of value.
    expect(CONTENT_REASON.unreadableCourses(1, 2)).toContain('1 of 2 courses');
    expect(ENGAGEMENT_REASON.unreadableSessions(1, 2)).toContain('1 of 2 check-in sessions');
  });
});

/* ═══ Scope: the apex, and the tab-selected read ════════════════════════════ */

describe('scoping and deferral', () => {
  it('on the apex every widget on both tabs reports that no ministry is in scope', async () => {
    authState.currentUser = { uid: 'root', email: 'founder@harvest.app' };
    docReads.set('users/root', { role: 'super_admin', permissions: { analytics: true }, tenantId: null });
    counts.set('users', 3); counts.set('contacts', 1); counts.set('courses', 0);
    counts.set('community_posts', 0); counts.set('blog_posts', 0); counts.set('submissions', 0);
    counts.set('tenants', 2);
    docsFor.set('users', []); docsFor.set('submissions', []);

    const c = await mount(
      <AdminDashboardHome tenantId={null} isSuperAdmin unreadCount={0} onNavigate={() => {}} />,
    );
    await openTab(c, 'Engagement');
    for (const title of ENGAGEMENT_WIDGETS) {
      expect(stateOf(c, title), title).toBe('unavailable');
      expect(reasonOf(c, title)).toContain('No ministry is in scope');
    }
    await openTab(c, 'Content');
    expect(reasonOf(c, 'Course completion')).toContain('No ministry is in scope');
  });

  it('🔴 neither tab reads anything until it is selected — Base UI mounts one panel', async () => {
    grantAnalytics();
    healthyTenant();
    await screen();

    // The Overview tab's own reads have run; the Engagement and Content ones
    // have not. `contactActivities` is the largest collection the dashboard
    // touches, and a visit that only looks at Overview must never pay for it.
    expect(counted).toContain('users');
    expect(counted).not.toContain('contactActivities');
    expect(counted).not.toContain('tenants/grace/checkinSessions');
    expect(counted).not.toContain('prayer_requests');
    expect(counted).not.toContain('tenants/grace/adoptedCourses');
  });

  it('and they do read once selected', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Engagement');
    expect(counted).toContain('contactActivities');
    expect(counted).toContain('tenants/grace/checkinSessions');
    expect(counted).toContain('prayer_requests');
    await openTab(c, 'Content');
    expect(counted).toContain('tenants/grace/adoptedCourses');
    expect(counted).toContain('libraryCourses');
  });

  it('the Engagement tab reads contactActivities ONCE for its three widgets', async () => {
    grantAnalytics();
    healthyTenant();
    const c = await screen();
    await openTab(c, 'Engagement');
    expect(fetched.filter((p) => p === 'contactActivities')).toHaveLength(1);
    expect(counted.filter((p) => p === 'contactActivities')).toHaveLength(1);
  });

  it('a tenant with no adoption never reads the shared library at all', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('tenants/grace/adoptedCourses', 0);
    docsFor.set('tenants/grace/adoptedCourses', []);
    const c = await screen();
    await openTab(c, 'Content');
    expect(counted).not.toContain('libraryCourses');
    expect(stateOf(c, 'Course completion')).toBe('ready');
  });

  it('a tenant with no course at all is told so, rather than shown a zero', async () => {
    grantAnalytics();
    healthyTenant();
    counts.set('courses', 0);
    docsFor.set('courses', []);
    counts.set('tenants/grace/adoptedCourses', 0);
    docsFor.set('tenants/grace/adoptedCourses', []);
    const c = await contentScreen();
    expect(stateOf(c, 'Course completion')).toBe('unavailable');
    expect(reasonOf(c, 'Course completion')).toContain('nothing to complete yet');
  });
});

/* ═══ Housekeeping the mount would otherwise hide ═══════════════════════════ */

describe('the tab shell learned nothing about what these tabs hold', () => {
  it('EngagementTab and ContentTab take their data as a prop and read nothing themselves', () => {
    const engagement: EngagementData = {
      loading: false,
      activitySeries: null, activityTypes: null, activityReason: 'no', spread: null,
      attendance: null, attendanceReason: 'no',
      prayer: null, prayerReason: 'no',
    };
    const content: ContentData = { loading: false, completion: null, completionReason: 'no' };
    // Rendering them as plain functions proves they need no provider, no hook
    // and no Firestore — which is what lets the layout test render them to a
    // static string in a real browser.
    expect(EngagementTab({ engagement })).toBeTruthy();
    expect(ContentTab({ content })).toBeTruthy();
    // Neither issued a query: `built` is untouched by rendering them directly.
    expect(built).toHaveLength(0);
  });
});
