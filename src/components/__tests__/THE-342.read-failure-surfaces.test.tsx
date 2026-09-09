import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CoursePage from '../CoursePage';
import { CourseLibrary } from '../course/CourseLibrary';

/**
 * THE-342 — the BEHAVIOUR: what each surface actually renders when its read is
 * truncated, and when its read is REFUSED.
 *
 * `THE-342.read-honesty-guards.test.ts` asserts the SHAPE of the reads against
 * the files on disk. This file asserts the consequence, by making the read
 * reject and looking at the DOM — which is the only way to prove the two states
 * are distinguishable to a person, rather than merely present in the source.
 *
 * The defect, in one sentence: `courses` is `[]` both when a church has
 * published nothing and when Firestore refused the query, so the two are
 * indistinguishable in the data and were indistinguishable on screen. A member
 * on the apex domain whose tenant scope resolved to null ran an unfiltered
 * /courses query — rejected wholesale, because the rule dereferences
 * `resource.data.tenantId` and rules are not filters — and was shown "No
 * courses found". AGENTS.md's Silent-Failure Rule names exactly this.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
  PLATFORM_TENANT_ID: 'harvest',
}));

/**
 * `reject` names the collection paths whose reads must FAIL, so a test can
 * refuse exactly one read and leave the others working — which is how "per
 * site" in the ticket is satisfied rather than approximated by failing
 * everything at once.
 */
const state = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  /** Paths whose getDocs rejects, as Firestore would on permission-denied. */
  reject: [] as string[],
  /** Paths whose getCountFromServer reports more than `rows` holds. */
  inflate: {} as Record<string, number>,
}));

const rowsFor = (path: string): any[] => state.rows[path] ?? [];
const shouldReject = (path: string) => state.reject.some((p) => path.includes(p));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args: [...(col?.args ?? []), ...args] }),
  where: (field: string, op?: string, value?: unknown) => ({ __where: { field, op, value } }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (f: unknown) => ({ __orderBy: f }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  updateDoc: async () => {},
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getCountFromServer: async (q: any) => {
    const path = q?.__path ?? '';
    if (shouldReject(path)) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    return { data: () => ({ count: state.inflate[path] ?? rowsFor(path).length }) };
  },
  getDocs: async (q: any) => {
    const path = q?.__path ?? '';
    if (shouldReject(path)) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    const inClause = (q?.args ?? []).find((a: any) => a?.__where?.field === '__name__');
    const ids: string[] | null = inClause ? inClause.__where.value : null;
    const rows = rowsFor(path).filter((r) => (ids ? ids.includes(r.id) : true));
    const docs = rows.map((r) => ({ id: r.id, data: () => r }));
    return { docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
  },
}));

let container: HTMLDivElement;
let root: Root;

async function mount(node: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(node);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

const text = () => container.textContent ?? '';
const q = (sel: string) => container.querySelector(sel);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  state.rows = {};
  state.reject = [];
  state.inflate = {};
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5 — a failed read surfaces as a FAILURE, never as an empty list', () => {
  it('CoursePage: a refused /courses read renders the failure and NOT the empty state', async () => {
    state.reject = ['courses'];
    await mount(<CoursePage />);
    // The distinction, asserted in both directions — either half alone would
    // pass while the bug was present.
    expect(q('[data-courses-read-failed]'), 'no failure state rendered').not.toBeNull();
    expect(q('[data-courses-empty]'), 'the empty state was rendered for a REFUSED read').toBeNull();
    expect(text()).toContain('could not load');
    expect(text(), 'a refused read still claimed the church has no courses')
      .not.toContain('No courses found');
  });

  it('CoursePage: an EMPTY church still gets the empty state, not a failure', async () => {
    // The other half of the same guarantee. If this passed while the test above
    // also passed only because everything renders a failure, the screen would
    // have swapped one lie for another.
    state.rows = { courses: [], authors: [], categories: [] };
    await mount(<CoursePage />);
    expect(q('[data-courses-empty]'), 'a genuinely empty library lost its empty state').not.toBeNull();
    expect(q('[data-courses-read-failed]'), 'an empty church was reported as a failure').toBeNull();
  });

  it('CoursePage: a refused AUTHORS read is reported rather than rendering courses authorless', async () => {
    state.reject = ['authors'];
    state.rows = { courses: [{ id: 'c1', title: 'Romans', status: 'published', levels: [] }] };
    await mount(<CoursePage />);
    expect(text()).toContain('Teacher profiles could not be loaded');
  });

  it('CoursePage: a refused CATEGORIES read is reported rather than silently dropping filters', async () => {
    state.reject = ['categories'];
    state.rows = { courses: [{ id: 'c1', title: 'Romans', status: 'published', levels: [] }] };
    await mount(<CoursePage />);
    expect(text()).toContain('Categories could not be loaded');
  });

  it('CourseLibrary: the failure state wins over the empty state at the component level', async () => {
    await mount(
      <CourseLibrary courses={[]} authors={[]} categories={['All']} onSelectCourse={() => {}} readFailed />,
    );
    expect(q('[data-courses-read-failed]')).not.toBeNull();
    expect(q('[data-courses-empty]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3-4 — a truncated list says so, with an EXACT total', () => {
  it('CoursePage: says "Showing N of M" when the courses read is capped', async () => {
    state.rows = {
      courses: [
        { id: 'c1', title: 'Romans', status: 'published', levels: [] },
        { id: 'c2', title: 'Acts', status: 'published', levels: [] },
      ],
    };
    // The aggregation reports the TRUE total, which the ceiling did not reach.
    state.inflate = { courses: 250 };
    await mount(<CoursePage />);
    expect(q('[data-courses-truncated]'), 'nothing on screen said the list was short').not.toBeNull();
    expect(text()).toContain('Showing 2 of 250');
  });

  it('CoursePage: says NOTHING when the read is complete', async () => {
    // ⚠️ Non-vacuity for the test above: if the notice rendered unconditionally
    // it would pass there and be useless.
    state.rows = { courses: [{ id: 'c1', title: 'Romans', status: 'published', levels: [] }] };
    await mount(<CoursePage />);
    expect(q('[data-courses-truncated]'), 'a complete list claimed to be truncated').toBeNull();
    expect(text()).not.toContain('Showing 1 of');
  });

  it('the figure quoted is the AGGREGATION, not the length of what was loaded', async () => {
    // The whole point of counting first: a count taken from the fetched rows
    // would be clamped by the ceiling and would silently equal it.
    state.rows = { courses: [{ id: 'c1', title: 'Romans', status: 'published', levels: [] }] };
    state.inflate = { courses: 640 };
    await mount(<CoursePage />);
    expect(text()).toContain('of 640');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6 — the adopted library courses are complete however large the catalogue', () => {
  it('an adopted course is reached even when the catalogue is far past any ceiling', async () => {
    // 🔴 The trap a naive ceiling would have introduced: this course sorts last
    // by documentId(), so a bounded SCAN of the catalogue would have dropped it
    // from the member app silently. The by-id read cannot.
    state.rows = {
      courses: [],
      'tenants/tenant-1/adoptedCourses': [{ id: 'a1', libraryCourseId: 'zzz-last' }],
      libraryCourses: [{ id: 'zzz-last', title: 'Adopted Late', status: 'published', levels: [] }],
    };
    state.inflate = { libraryCourses: 5000 };
    await mount(<CoursePage />);
    expect(text()).toContain('Adopted Late');
    expect(q('[data-courses-read-failed]')).toBeNull();
  });
});
