import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * THE-309 — "I have submitted a form response but it doesn't appear on
 * dashboard."
 *
 * ─── The defect ──────────────────────────────────────────────────────────────
 *
 * 🔴 TWO DIFFERENT COLLECTIONS. The Overview tab's "Form submissions" card
 * counted a TOP-LEVEL `submissions` collection filtered `tenantId ==`, and
 * `/api/forms/submit` writes to `tenants/{tenantId}/forms/{formId}/submissions`
 * — a SUBCOLLECTION, per form, as the route's own docblock says and as THE-298
 * pinned. So the KPI could never be anything but zero, and the `+0% vs last
 * week` chip beneath it was derived from the same empty read, which is exactly
 * what made the pair look consistent rather than broken.
 *
 * ⚠️ The aggregation itself was never wrong. `getCountFromServer` answered
 * honestly, unclamped, over the path it was given. That is the shape of this
 * bug and why #421's rule did not catch it: the rule asks whether a figure's
 * READ is exact or provably complete, and this one was both — of the wrong
 * collection. A zero that means "we looked in the wrong place" renders
 * identically to a zero that means "there are none", which is the same failure
 * mode #421 exists to prevent, one layer up.
 *
 * ─── What this suite defends ─────────────────────────────────────────────────
 *
 * That a response written where the app actually writes it is COUNTED; that the
 * count is exact and says so; that the chip comes from that same traversal and
 * not a second one; that a failed read still refuses rather than falling back
 * to zero; and that nothing else on the screen, in the write path, in the rules
 * or in the index file moved to achieve it.
 */

/* ═════════════════════════════════════════════════════════════════════════════
   The recorder. Same shape as THE-276's, so a read's PATH is assertable.
   ═══════════════════════════════════════════════════════════════════════════ */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BuiltQuery = { path: string[]; where: Array<[string, string, unknown]>; limit: number | null };

const { built, aggregated, fetched, counts, docsFor, docReads, authState, groups } = vi.hoisted(() => ({
  built: [] as BuiltQuery[],
  /** Every path a `getCountFromServer` ran against, in order. */
  aggregated: [] as string[],
  /** Every path a `getDocs` ran against, in order. */
  fetched: [] as string[],
  counts: new Map<string, number | Error>(),
  docsFor: new Map<string, Array<Record<string, unknown>>>(),
  docReads: new Map<string, Record<string, unknown> | null>(),
  authState: { currentUser: null as { uid: string; email: string; displayName?: string } | null },
  /**
   * 🔴 Every `collectionGroup()` this screen calls. It must stay EMPTY: see the
   * suite below, and {@link formSubmissionsQuery}'s header for why the rules
   * deny such a read outright rather than merely failing to index it.
   */
  groups: [] as string[],
}));

const keyOf = (q: BuiltQuery) => q.path.join('/');

vi.mock('../../firebase', () => ({ db: {}, get auth() { return authState; } }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments }),
  collectionGroup: (_db: unknown, id: string) => { groups.push(id); return { __path: [id] }; },
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
    aggregated.push(keyOf(q));
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
const {
  REASON,
  DASHBOARD_FETCH_LIMIT,
  readFormSubmissions,
  toSubmissionRow,
  deltaOf,
} = await import('../dashboard/dashboard-data');

/* ═════════════════════════════════════════════════════════════════════════════
   Mounting and fixtures.
   ═══════════════════════════════════════════════════════════════════════════ */

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

const DAY = 24 * 60 * 60 * 1000;
/**
 * ⚠️ THE REAL CLOCK, captured once at load. `AdminDashboardHome` passes no
 * `now` to `useOverviewData`, so a mounted screen buckets against `Date.now()`
 * — a frozen literal here would put every fixture row outside the eight-week
 * window and every trend assertion would pass over an all-zero series.
 * `readFormSubmissions` takes `now` explicitly, so the unit tests below pin it
 * to this same value and the two halves agree.
 */
const NOW = Date.now();
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const screen = () =>
  mount(<AdminDashboardHome tenantId="grace" tenantName="Grace Chapel" isSuperAdmin={false} unreadCount={0} onNavigate={() => {}} />);

function grantAnalytics() {
  authState.currentUser = { uid: 'u1', email: 'pastor@grace.org', displayName: 'Ada Grace' };
  docReads.set('users/u1', { role: 'admin', permissions: { analytics: true }, tenantId: 'grace' });
}

/** Every OTHER KPI, at the values THE-276 and #429/#433 pinned. */
function otherKpis() {
  counts.set('users', 3);
  counts.set('contacts', 42);
  counts.set('courses', 2);
  counts.set('community_posts', 7);
  counts.set('blog_posts', 4);
  counts.set('tenants/grace/invoices', 2);
  docsFor.set('users', [{ createdAt: NOW - 2 * DAY }, { createdAt: NOW - 3 * DAY }, { createdAt: NOW - 40 * DAY }]);
  docsFor.set('tenants/grace/invoices', [
    { amount: 25000, issuedAt: new Date(NOW - 2 * DAY).toISOString(), type: 'donation_receipt' },
    { amount: 5000, issuedAt: new Date(NOW - 30 * DAY).toISOString(), type: 'event_ticket' },
  ]);
  docReads.set('tenants/grace/livestream/current', { active: true, title: 'Sunday service' });
}

/**
 * 🔴 THE FIXTURE THIS WHOLE TICKET TURNS ON: responses written to the
 * SUBCOLLECTION `/api/forms/submit` writes to, keyed by `formId` and dated by
 * `submittedAt` — never to a top-level `submissions` collection, and never
 * under `createdAt`.
 */
function forms(spec: Record<string, Array<Record<string, unknown>>>) {
  const ids = Object.keys(spec);
  counts.set('tenants/grace/forms', ids.length);
  docsFor.set('tenants/grace/forms', ids.map((id) => ({ __id: id, title: `Form ${id}` })));
  for (const id of ids) {
    counts.set(`tenants/grace/forms/${id}/submissions`, spec[id].length);
    docsFor.set(`tenants/grace/forms/${id}/submissions`, spec[id]);
  }
}

const submittedDaysAgo = (days: number) => ({ submittedAt: NOW - days * DAY, answers: { q1: 'yes' } });

const kpi = (c: ParentNode, label: string) => c.querySelector(`[data-kpi="${label}"]`);
const valueOf = (c: ParentNode, label: string) => text(kpi(c, label)?.querySelector('[data-kpi-value]') ?? null);
const reasonOf = (c: ParentNode, label: string) => text(kpi(c, label)?.querySelector('[data-kpi-unavailable]') ?? null);
const stateOf = (c: ParentNode, label: string) => kpi(c, label)?.getAttribute('data-state');
const deltaChip = (c: ParentNode, label: string) => text(kpi(c, label)?.querySelector('[data-kpi-delta]') ?? null);

beforeEach(() => {
  built.length = 0; aggregated.length = 0; fetched.length = 0; groups.length = 0;
  counts.clear(); docsFor.clear(); docReads.clear();
  authState.currentUser = null;
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container?.remove();
});

/* ═════════════════════════════════════════════════════════════════════════════
   1. The ticket.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a submitted form response is counted by the Form submissions KPI', () => {
  it('🔴 one response in the subcollection is one on the card, not zero', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-volunteer': [submittedDaysAgo(1)] });
    const c = await screen();

    expect(stateOf(c, 'Form submissions')).toBe('exact');
    expect(valueOf(c, 'Form submissions')).toBe('1');
  });

  it('🔴 sums across every form the ministry owns', async () => {
    grantAnalytics();
    otherKpis();
    forms({
      'form-volunteer': [submittedDaysAgo(1), submittedDaysAgo(2)],
      'form-prayer': [submittedDaysAgo(3)],
      'form-baptism': [],
    });
    const c = await screen();
    expect(valueOf(c, 'Form submissions')).toBe('3');
  });

  it('🔴 reads the SUBCOLLECTION, and never the top-level collection', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-volunteer': [submittedDaysAgo(1)] });
    await screen();

    expect(aggregated).toContain('tenants/grace/forms');
    expect(aggregated).toContain('tenants/grace/forms/form-volunteer/submissions');
    // 🔴 The mutation guard: point the read back at the top-level collection
    // and this is the assertion that fails. `submissions` as a WHOLE path — the
    // subcollection reads above end in it but are four segments long.
    expect(built.filter((q) => keyOf(q) === 'submissions'), 'the legacy top-level collection was read').toEqual([]);
    expect(aggregated).not.toContain('submissions');
    expect(fetched).not.toContain('submissions');
  });

  it('⚠️ dates the response by submittedAt, the only field the write path writes', () => {
    // `/api/forms/submit` writes `submittedAt: FieldValue.serverTimestamp()`
    // and nothing writes `createdAt` here, so reading `createdAt` would date
    // every row `null` — a COMPLETE read whose trend is eight empty buckets.
    expect(toSubmissionRow({ submittedAt: NOW, createdAt: null }).createdAt).toBe(NOW);
    expect(toSubmissionRow({ createdAt: NOW }).createdAt).toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   2. Exact, or provably complete — and which.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the count is exact or provably complete', () => {
  it('🔴 it is EXACT: a sum of getCountFromServer aggregations, not of page lengths', async () => {
    grantAnalytics();
    // The aggregation says three; the page is deliberately EMPTY. A figure read
    // off `rows.length` would say 0 here, which is precisely the "length of a
    // page reported as a count" defect THE-276 exists to refuse.
    counts.set('tenants/grace/forms', 1);
    docsFor.set('tenants/grace/forms', [{ __id: 'form-a', title: 'A' }]);
    counts.set('tenants/grace/forms/form-a/submissions', 3);
    docsFor.set('tenants/grace/forms/form-a/submissions', []);

    const read = await readFormSubmissions('grace', NOW);
    expect(read.figure).toEqual({ kind: 'exact', value: 3 });
  });

  it('🔴 the figure survives a form too large to CHART, because the two are gated apart', async () => {
    counts.set('tenants/grace/forms', 1);
    docsFor.set('tenants/grace/forms', [{ __id: 'form-a', title: 'A' }]);
    counts.set('tenants/grace/forms/form-a/submissions', DASHBOARD_FETCH_LIMIT + 1);

    const read = await readFormSubmissions('grace', NOW);
    // Exact, because the aggregation is unclamped and loads no documents...
    expect(read.figure).toEqual({ kind: 'exact', value: DASHBOARD_FETCH_LIMIT + 1 });
    // ...and the trend refuses, because a trend needs the documents.
    expect(read.series).toEqual({ kind: 'unavailable', reason: REASON.tooManyToChart });
  });

  it('🔴 ONE form refusing refuses the WHOLE figure — a partial sum is not a smaller truth', async () => {
    counts.set('tenants/grace/forms', 2);
    docsFor.set('tenants/grace/forms', [{ __id: 'form-a', title: 'A' }, { __id: 'form-b', title: 'B' }]);
    counts.set('tenants/grace/forms/form-a/submissions', 5);
    docsFor.set('tenants/grace/forms/form-a/submissions', [submittedDaysAgo(1)]);
    counts.set('tenants/grace/forms/form-b/submissions', new Error('permission-denied'));

    const read = await readFormSubmissions('grace', NOW);
    expect(read.figure.kind).toBe('unavailable');
    // 🔴 Not 5. A total that silently omits form-b is wrong by exactly form-b.
    expect(JSON.stringify(read.figure)).not.toContain('5');
  });

  it('🔴 a truncated FORMS list refuses too, and says which ceiling it hit', async () => {
    counts.set('tenants/grace/forms', DASHBOARD_FETCH_LIMIT + 1);
    const read = await readFormSubmissions('grace', NOW);
    expect(read.figure).toEqual({ kind: 'unavailable', reason: REASON.tooManyForms });
    expect(read.series.kind).toBe('unavailable');
  });

  it('the series is COMPLETE and buckets every form’s responses together', async () => {
    counts.set('tenants/grace/forms', 2);
    docsFor.set('tenants/grace/forms', [{ __id: 'form-a', title: 'A' }, { __id: 'form-b', title: 'B' }]);
    counts.set('tenants/grace/forms/form-a/submissions', 2);
    docsFor.set('tenants/grace/forms/form-a/submissions', [submittedDaysAgo(1), submittedDaysAgo(9)]);
    counts.set('tenants/grace/forms/form-b/submissions', 1);
    docsFor.set('tenants/grace/forms/form-b/submissions', [submittedDaysAgo(2)]);

    const read = await readFormSubmissions('grace', NOW);
    expect(read.series.kind).toBe('complete');
    const points = read.series.kind === 'complete' ? read.series.points : [];
    // Two in the last seven days, one in the week before.
    expect(points[points.length - 1].value).toBe(2);
    expect(points[points.length - 2].value).toBe(1);
    expect(points.reduce((a, p) => a + p.value, 0)).toBe(3);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   3. The chip.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the % chip derives from the same read, not a separate one', () => {
  it('🔴 exactly one aggregation and one page per form — nothing is traversed twice', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-a': [submittedDaysAgo(1)], 'form-b': [submittedDaysAgo(9)] });
    await screen();

    const submissionReads = (log: string[]) => log.filter((p) => p.endsWith('/submissions'));
    // Two forms → two aggregations and two pages. A chip fed by its own read
    // would double one of these numbers.
    expect(submissionReads(aggregated)).toEqual([
      'tenants/grace/forms/form-a/submissions',
      'tenants/grace/forms/form-b/submissions',
    ]);
    expect(submissionReads(fetched)).toEqual([
      'tenants/grace/forms/form-a/submissions',
      'tenants/grace/forms/form-b/submissions',
    ]);
    // And the forms themselves are enumerated exactly once.
    expect(aggregated.filter((p) => p === 'tenants/grace/forms')).toHaveLength(1);
    expect(fetched.filter((p) => p === 'tenants/grace/forms')).toHaveLength(1);
  });

  it('the chip renders from those same rows: one this week against one last week is +0%', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-a': [submittedDaysAgo(1), submittedDaysAgo(9)] });
    const c = await screen();
    expect(valueOf(c, 'Form submissions')).toBe('2');
    expect(deltaChip(c, 'Form submissions')).toContain('+0% vs last week');
  });

  it('🔴 and a real rise is a real chip — the +0% was the bug, not the format', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-a': [submittedDaysAgo(1), submittedDaysAgo(2), submittedDaysAgo(9)] });
    const c = await screen();
    expect(valueOf(c, 'Form submissions')).toBe('3');
    expect(deltaChip(c, 'Form submissions')).toContain('+100% vs last week');
  });

  it('no chip at all when the trend was refused — deltaOf has nothing to divide', async () => {
    counts.set('tenants/grace/forms', 1);
    docsFor.set('tenants/grace/forms', [{ __id: 'form-a', title: 'A' }]);
    counts.set('tenants/grace/forms/form-a/submissions', DASHBOARD_FETCH_LIMIT + 1);
    const read = await readFormSubmissions('grace', NOW);
    expect(read.series.kind).toBe('unavailable');
    expect(deltaOf([])).toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   4. Zero, and the difference between "none" and "we could not look".
   ═══════════════════════════════════════════════════════════════════════════ */

describe('zero forms shows zero, not an error — and a failed read shows neither', () => {
  it('a ministry with no forms has provably received nothing: an EXACT zero', async () => {
    grantAnalytics();
    otherKpis();
    counts.set('tenants/grace/forms', 0);
    docsFor.set('tenants/grace/forms', []);
    const c = await screen();

    expect(stateOf(c, 'Form submissions')).toBe('exact');
    expect(valueOf(c, 'Form submissions')).toBe('0');
    // 🔴 No per-form read was issued, because there was no form to open.
    expect(aggregated.filter((p) => p.endsWith('/submissions'))).toEqual([]);
  });

  it('a form with no responses yet is also an exact zero', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-a': [] });
    const c = await screen();
    expect(valueOf(c, 'Form submissions')).toBe('0');
  });

  it('🔴 A READ FAILURE IS AN EMPTY STATE, NEVER A ZERO — the whole point of #421', async () => {
    grantAnalytics();
    otherKpis();
    counts.set('tenants/grace/forms', new Error('permission-denied'));
    const c = await screen();

    expect(stateOf(c, 'Form submissions')).toBe('unavailable');
    expect(kpi(c, 'Form submissions')!.querySelector('[data-kpi-value]')).toBeNull();
    expect(reasonOf(c, 'Form submissions')).toBe(REASON.readFailed);
    // And no chip drawn over a number that does not exist.
    expect(kpi(c, 'Form submissions')!.querySelector('[data-kpi-delta]')).toBeNull();
  });

  it('🔴 a per-form read failure is an empty state too', async () => {
    grantAnalytics();
    otherKpis();
    counts.set('tenants/grace/forms', 1);
    docsFor.set('tenants/grace/forms', [{ __id: 'form-a', title: 'A' }]);
    counts.set('tenants/grace/forms/form-a/submissions', new Error('permission-denied'));
    const c = await screen();

    expect(stateOf(c, 'Form submissions')).toBe('unavailable');
    expect(text(c)).not.toMatch(/Form submissions 0/);
  });

  it('on the apex it says responses are per-ministry, and issues no read for them', async () => {
    authState.currentUser = { uid: 'root', email: 'founder@harvest.app' };
    docReads.set('users/root', { role: 'super_admin', permissions: { analytics: true }, tenantId: null });
    counts.set('users', 3); counts.set('contacts', 1); counts.set('courses', 0);
    counts.set('community_posts', 0); counts.set('blog_posts', 0); counts.set('tenants', 2);
    docsFor.set('users', []);

    const c = await mount(
      <AdminDashboardHome tenantId={null} isSuperAdmin unreadCount={0} onNavigate={() => {}} />,
    );
    expect(stateOf(c, 'Form submissions')).toBe('unavailable');
    expect(reasonOf(c, 'Form submissions')).toBe(REASON.perMinistryOnly);
    // 🔴 And NOT an unscoped read of the legacy collection, which a super
    // admin's token would in fact have passed.
    expect(built.filter((q) => keyOf(q) === 'submissions')).toEqual([]);
    expect(aggregated.filter((p) => p.endsWith('/submissions'))).toEqual([]);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   5. No collection-group query. The rules forbid it.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('no collection-group query is issued', () => {
  it('🔴 the screen calls collectionGroup() zero times', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-a': [submittedDaysAgo(1)], 'form-b': [submittedDaysAgo(2)] });
    await screen();
    expect(groups, 'a collection-group query was issued').toEqual([]);
  });

  it('🔴 and no dashboard source file so much as names it', () => {
    // ⚠️ Comments stripped first: dashboard-data's header explains at length
    // why a collection-group read is denied here, and that explanation is the
    // reason the code below must not contain one.
    for (const rel of DASHBOARD_FILES) {
      expect(stripComments(readRepo(rel)), `${rel} calls collectionGroup`).not.toMatch(/\bcollectionGroup\b/);
    }
  });

  it('⚠️ because firestore.rules has NO recursive match for one to be evaluated against', () => {
    // THE-285 established this for `attendees`; the same file, the same
    // absence. A collection-group read is matched ONLY by `match /{path=**}/`
    // rules — the tenants/{t}/forms/{f}/submissions rule does not apply to it —
    // so with none present the read is DENIED, not merely unindexed. No index
    // would fix it, and the rules file auto-deploys, so it is not touched.
    const rules = readRepo('firestore.rules');
    expect(rules).not.toMatch(/match\s*\/\{[A-Za-z_]*\s*=\s*\*\*\}/);
    expect(rules).toContain('match /submissions/{subId}');
    expect(rules).toContain('match /submissions/{submissionId}');
  });

  it('⚠️ and the one submissions index that exists is COLLECTION-scoped, for the legacy inbox', () => {
    const idx = JSON.parse(readRepo('firestore.indexes.json')) as {
      indexes: { collectionGroup: string; queryScope: string }[];
    };
    const subs = idx.indexes.filter((i) => i.collectionGroup === 'submissions');
    expect(subs).toHaveLength(1);
    // 🔴 COLLECTION, not COLLECTION_GROUP. It serves the top-level legacy
    // inbox. Adding a COLLECTION_GROUP one here would be inert anyway —
    // deploy-rules.yml deploys `firestore:rules,storage` and its paths: filter
    // never names this file — so the query would throw failed-precondition in
    // production while looking correct in the repo.
    expect(subs[0].queryScope).toBe('COLLECTION');
    const workflow = readRepo('.github/workflows/deploy-rules.yml');
    expect(workflow).toContain('firestore:rules,storage');
    expect(workflow).not.toContain('firestore.indexes.json');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   6-8, 11. Nothing else moved.
   ═══════════════════════════════════════════════════════════════════════════ */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const readRepo = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The files THE-309 actually edits. Everything else below is pinned. */
const DASHBOARD_FILES = [
  'src/components/dashboard/dashboard-data.ts',
  'src/components/dashboard/useOverviewData.ts',
  'src/components/dashboard/InsightFeed.tsx',
];

describe('api/forms/submit is byte-identical', () => {
  /**
   * ⚠️ APPENDED, not substituted. THE-298 pins this same digest and its guard
   * stays exactly where it is; this is a second, independent claim from the
   * ticket that had the strongest reason to want to edit the file.
   *
   * 🔴 THE-309 needed a count of a subcollection and the cheapest answer would
   * have been a denormalised `submissionCount` on the form document. One
   * already exists here and is NOT used — see readFormSubmissions' header for
   * the two ways it drifts. Making it trustworthy means a transaction in this
   * route, which is a WRITE-PATH change and out of scope; it is reported.
   */
  it('the only writer of the subcollection carries no edit from this ticket', () => {
    expect(sha256(readRepo('src/app/api/forms/submit/route.ts')))
      .toBe('5322a5cf3c9aee481833e6a33d33a060aa32db403341b1747a86fde64cddb9cc');
  });

  it('still writes the shape this KPI now reads', () => {
    const src = readRepo('src/app/api/forms/submit/route.ts');
    expect(src).toContain("await formRef.collection('submissions').add({");
    expect(src).toContain('submittedAt: FieldValue.serverTimestamp(),');
    // 🔴 The counter this ticket declined to trust, still exactly as it was:
    // an `add()` and an `increment()` as two sequential awaits, no transaction.
    expect(src).toContain("await formRef.set({ submissionCount: FieldValue.increment(1) }, { merge: true });");
  });

  it('is STILL the only writer of that subcollection — rescanned, not assumed', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
        return /\.(ts|tsx)$/.test(e.name) && !p.includes('__tests__') ? [p] : [];
      });
    const writers = walk(path.join(REPO_ROOT, 'src'))
      .filter((f) => /collection\(['"]submissions['"]\)\s*\.add\(/.test(readFileSync(f, 'utf8')));
    expect(writers.map((f) => path.relative(REPO_ROOT, f))).toEqual(['src/app/api/forms/submit/route.ts']);
  });
});

describe('the other readers of the same subcollection are untouched', () => {
  /**
   * 🔴 THE-298's answers view and THE-304's option editor read and write the
   * same `tenants/{t}/forms/{f}/submissions` this KPI now counts, and both are
   * pinned byte-for-byte: THE-309 adds a READER in the dashboard and changes
   * nothing they depend on. Their own suites assert their behaviour; these
   * digests assert this ticket did not reach into it.
   */
  /**
   * ⚠️ A SET PER FILE, APPENDED TO BY THE-319 rather than substituted — the
   * shape THE-276 established, and for its reason: CI runs against
   * `refs/pull/N/merge`, so a file another ticket legitimately lands on `main`
   * holds a different value there than on that ticket's own branch. A value
   * that is NEITHER still fails, which is the whole threat this guard is about.
   *
   * 🔴 `FormAnswersView.tsx` moved in THE-319 and the ORIGINAL DIGEST IS STILL
   * HERE, first, unchanged. THE-319 is the composition sweep: the per-option
   * proportion bar is now `ui/progress` instead of a hand-rolled track and fill,
   * which is why the file's bytes moved. It is not a change THE-309 has any
   * stake in — every figure, every string and every measured box on that screen
   * is identical, verified in Chromium at all five viewports, and the assertion
   * two below (that the view still keys responses by the same path and field)
   * is the claim THE-309 actually cares about and is untouched.
   */
  const PINNED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
    // THE-298 — the answers view and its complete, paged read.
    'src/components/forms/form-answers.ts': [
      ['b84d40bcd9f47910e9f7afaad3e38ef7eaa68500bb90b4b7fbd9990744ebd0eb', 'THE-298\'s value — untouched by THE-319, which reads it and does not edit it'],
    ],
    'src/components/forms/FormAnswersView.tsx': [
      ['edf8fccd4ad2759c09b5b6114d1109d9237a580c021b620e98224b97a8ad1df1', 'THE-298\'s value — main before THE-319'],
      ['db6c05f4d6e3ed101d3c3c22f9104bb38793f91aecda89243cfa17b886304027', 'THE-319 (composition sweep) — the option bar is `ui/progress`; no figure, copy or measured value moved'],
    ],
    // THE-304 — the option editor, and the form list that mounts both views.
    'src/components/AdminForms.tsx': [
      ['8e7fc10589b8ba3c5bc27ec88debd1d598e19e33cfedd0041a5be65074249a9e', "THE-304's option editor — untouched by THE-319"],
      // 🔴 APPENDED BY THE-360, never substituted. Two captures of one event,
      // `form_published`, fired where a form BECOMES reachable: on create,
      // where `active: true` is written unconditionally, and on `toggleActive`
      // in the ON direction only. `toggleActive` now names the value it writes
      // so the direction can be read; the value written is identical. No
      // submission count, field, label or title moved — which is what THE-309
      // pins this file for — and no read of the submissions subcollection
      // changed.
      ['ae9ac5039cf3dd10513fc7e7797f0f005d053bd9536eba8fa87d6213da2d59b5', 'THE-360 — form_published fires where a form goes live'],
    ],
    'src/app/api/forms/get/route.ts': [
      ['8e8ad1d36349725c7219f1c45c7e2f4e103e07e05bcfe70e3c6a2c5de98de2cc', 'unchanged since THE-298'],
    ],
    // ⚠️ The LEGACY top-level inbox. It is not migrated, redirected or
    // deleted by this ticket — rules still grant it, rows still exist, and
    // AdminInbox is still the surface for them.
    'src/components/AdminInbox.tsx': [
      ['001d256d75ea4a02d908005827d51468af52a269dc88e18070407f8dac76f371', 'the legacy top-level inbox, not migrated'],
    ],
  };

  it.each(Object.entries(PINNED))('%s carries no edit from this ticket', (file, accepted) => {
    const actual = sha256(readRepo(file));
    expect(
      accepted.find(([digest]) => digest === actual),
      `${file} is at ${actual}, which is none of:\n  ` +
        accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('THE-298’s answers view still keys responses by the same path and field', () => {
    const src = readRepo('src/components/forms/form-answers.ts');
    expect(src).toContain("collection(db, 'tenants', tenantId, 'forms', formId, 'submissions')");
    expect(src).toContain('submittedAt');
  });

  it('THE-304’s option editor still writes to the FORM, never to its responses', () => {
    const src = readRepo('src/components/AdminForms.tsx');
    expect(src).toContain('submissionCount');
    // The builder saves fields onto tenants/{t}/forms/{id}; a write into the
    // responses subcollection from there is what THE-304 forbids.
    expect(src).not.toMatch(/collection\(db,\s*'tenants',[^)]*'submissions'\)\s*\)?\s*,\s*\{/);
  });
});

describe('firestore.rules, firestore.indexes.json and functions/ byte-identical', () => {
  /**
   * 🔴 APPENDED to the pins THE-298 and THE-304 already hold on these two, with
   * this ticket's reason: `firestore.rules` AUTO-DEPLOYS to production on merge
   * and CI runs no emulator tests against it, so the recursive match a
   * collection-group count would need is not added here. `firestore.indexes.json`
   * does NOT deploy at all, so an index added there would be inert. Neither is
   * edited, which is why the count is a per-form fan-out.
   */
  const UNTOUCHED: Record<string, string> = {
    'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
  };

  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so
   * a legitimate rules change is one new record rather than 50 edits.
   */
  it('firestore.rules carries no edit from this ticket', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it.each(Object.entries(UNTOUCHED))('%s carries no edit from this ticket', (file, digest) => {
    expect(sha256(readRepo(file))).toBe(digest);
  });

  it('functions/ is unchanged, file for file', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(`${path.relative(REPO_ROOT, p)}:${sha256(readFileSync(p, 'utf8'))}`);
      }
    };
    walk(path.join(REPO_ROOT, 'functions'));
    // 🔴 A LITERAL digest of the tree as `main` carries it, not one computed
    // from the same walk — comparing a walk against itself would pass over any
    // edit at all. The file count is pinned beside it so emptying the tree
    // cannot satisfy the hash by accident.
    expect(out).toHaveLength(5);
    expect(sha256(out.sort().join('\n')))
      .toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   9-10. Every other figure on the screen.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('every other KPI’s figure is unchanged', () => {
  it('🔴 Members 3, Contacts 42, Courses 2, Posts 7, Articles 4, Receipts 2 — named', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-volunteer': [submittedDaysAgo(1)] });
    const c = await screen();

    // The values #429 and #433 pinned identical to Overview's when they
    // relocated these widgets. Only the sixth card's SOURCE moved.
    expect(valueOf(c, 'Members')).toBe('3');
    expect(valueOf(c, 'Contacts')).toBe('42');
    expect(valueOf(c, 'Published courses')).toBe('2');
    expect(valueOf(c, 'Community posts')).toBe('7');
    expect(valueOf(c, 'Articles')).toBe('4');
    expect(valueOf(c, 'Form submissions')).toBe('1');
    expect(valueOf(c, 'Receipts')).toBe('2');
  });

  it('and each of them still reads its own top-level collection, exactly once', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-volunteer': [submittedDaysAgo(1)] });
    await screen();

    for (const name of ['contacts', 'courses', 'community_posts', 'blog_posts']) {
      expect(aggregated.filter((p) => p === name), name).toHaveLength(1);
    }
    // ⚠️ `users` and the invoice ledger are aggregated TWICE, and were before
    // this ticket: once for the card's count, once inside `completeRead` for
    // the trend beside it. Pinned at two rather than smoothed to one — this
    // suite asserts THE-309 changed nothing here, not that the count is ideal.
    expect(aggregated.filter((p) => p === 'users')).toHaveLength(2);
    expect(aggregated.filter((p) => p === 'tenants/grace/invoices')).toHaveLength(2);
  });
});

describe('the strict money gate still refuses a missing amount', () => {
  it('🔴 no coercion to 0 crept back in — #421’s finding, re-asserted', async () => {
    grantAnalytics();
    otherKpis();
    forms({ 'form-volunteer': [submittedDaysAgo(1)] });
    docsFor.set('tenants/grace/invoices', [
      { amount: 25000, issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
      { issuedAt: new Date(NOW - DAY).toISOString(), type: 'donation_receipt' },
    ]);
    const c = await screen();

    expect(text(c)).toContain('carry no readable amount or type');
    // The RECEIPT COUNT is still exact — the ledger was read, its money was not.
    expect(valueOf(c, 'Receipts')).toBe('2');
    // And the submissions card beside it is unaffected by the refusal.
    expect(valueOf(c, 'Form submissions')).toBe('1');
  });

  it('toInvoiceRow still maps a missing amount to null, never to zero', async () => {
    const { toInvoiceRow } = await import('../dashboard/dashboard-data');
    expect(toInvoiceRow({ issuedAt: null, type: 'donation_receipt' }).amountCents).toBeNull();
    expect(toInvoiceRow({ amount: Number.NaN, issuedAt: null, type: 'x' }).amountCents).toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   12. No emoji, no inline style, no hardcoded colour.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('no emoji, no inline style, no hardcoded colour; both palettes resolve', () => {
  it('renders no emoji anywhere on the tab', async () => {
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    grantAnalytics();
    otherKpis();
    forms({ 'form-volunteer': [submittedDaysAgo(1)] });
    const c = await screen();
    const found = text(c).match(EMOJI);
    expect(found, `the tab renders ${found?.[0]}`).toBeNull();
  });

  it('spells no emoji in any RENDERED string of the files this ticket edits', () => {
    // ⚠️ The repo's 🔴/⚠️ annotation marks live in comments and are the house
    // style; only code that reaches a screen is in scope.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const rel of DASHBOARD_FILES) {
      const code = stripComments(readRepo(rel));
      expect(EMOJI.test(code), `${rel} spells an emoji in code`).toBe(false);
    }
  });

  it('🔴 writes no inline style and hardcodes no colour — the dashboard has zero of each', () => {
    for (const rel of DASHBOARD_FILES) {
      const src = readRepo(rel);
      expect(src, `${rel} writes an inline style`).not.toMatch(/style=\{\{/);
      expect(stripComments(src), `${rel} spells a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, `${rel} spells rgb()/hsl()`).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    }
  });

  it('mints no token of its own: every colour is a --chart-N both palettes define', () => {
    const css = readRepo('src/app/globals.css');
    // ⚠️ The four palettes, in the formulation THE-298 already uses against
    // this same file: the Harvest family on :root in light and dark, and the
    // Classic family — the default since #409 — in light and dark. A KPI
    // sparkline's colour is a `var(--chart-N)` string all the way down, so it
    // is correct in each only if each defines the token.
    // 🔴 THE-338 — the Classic FAMILY's two selectors are gone; its 14
    // overrides were promoted into the two theme scopes asserted below.
    expect(css, 'a palette family selector is back').not.toContain('data-palette');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    for (const n of [1, 2, 3, 4, 5]) expect(css, `--chart-${n} is gone`).toContain(`--chart-${n}`);

    // 🔴 And the card spends them through KPI_VAR, unchanged: this ticket moved
    // the sixth card's SOURCE, never its colour or its position.
    const tab = readRepo('src/components/dashboard/OverviewTab.tsx');
    expect(tab).toContain('const KPI_VAR = [...CHART_VARS, CHART_VARS[0], CHART_VARS[1]] as const;');
    expect(tab).toContain("{ label: 'Form submissions', icon: FileText, figure: data.submissions, series: data.submissionSeries },");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   Helpers used by the source sweeps above.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Strip block and line comments so a sweep judges CODE, not annotation. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
