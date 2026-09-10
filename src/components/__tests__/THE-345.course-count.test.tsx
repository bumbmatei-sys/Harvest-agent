import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCourses from '../AdminCourses';

/**
 * THE-345, defect 2 - THE GHOST IN THE COURSE COUNT.
 * ===========================================================================
 *
 * The founder: "In courses I only adopted one course in shadcn tenant from
 * library but it says I used 2 in total." His screen read "2 of 15 courses
 * used", "Your courses (2)" and "Library (2 adopted)" with exactly ONE row
 * rendered, and one of his fifteen plan slots was spent on a course that does
 * not exist.
 *
 * WHY THE POINTER DANGLES, established rather than assumed - and it is the
 * reason this fix is safe to make at all. `adoptedCourses` holds POINTERS into
 * the platform catalogue and nothing keeps the two in step; the platform can
 * delete a `libraryCourses` document and no rule or hook reaches into every
 * tenant to tidy up. `readDocsByIds` resolves them through
 * `where(documentId(), 'in', ids)`, which returns only documents that EXIST, so
 * a deleted one is simply absent. What CANNOT produce the same symptom is a
 * failed read: `readDocsByIds` THROWS on a rejected chunk and never resolves
 * into a short list. That distinction is asserted directly below, because a fix
 * that hid the symptom without it could have been hiding a read that broke.
 *
 * THESE TESTS DRIVE THE REAL COMPONENT. Every figure below is read off the
 * rendered DOM, not off the source, so a guard cannot pass by finding a word in
 * a comment.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-uid' } } }));

const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
}));
vi.mock('../AdminCourseEditor', () => ({ default: () => <div data-testid="course-editor" /> }));

const tenantCtx = vi.hoisted(() => ({ tenantPlan: undefined as string | undefined }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));

const mockAuthFetch = vi.hoisted(() => vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
const calls = vi.hoisted(() => ({ fetches: [] as Array<{ url: string; method?: string; body: Record<string, unknown> }> }));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: (url: string, options: { method?: string; body?: string }) => {
    calls.fetches.push({ url, method: options?.method, body: JSON.parse(options?.body || '{}') });
    return mockAuthFetch();
  },
}));

let mockCourses: Array<{ id: string; title: string; author: string; status: string }> = [];
let mockLibrary: Array<{ id: string; title: string; status: string }> = [];
let mockAdopted: Array<{ id: string; libraryCourseId?: string }> = [];

/**
 * WHICH READ IS ALLOWED TO FAIL, and it is the whole of test 14.
 *
 * `byIdRejects` makes ONLY the by-id adoption read reject - the one carrying
 * `where('__name__','in',[...])`. The catalogue listener and the counts keep
 * working, which is exactly the shape of a real partial outage and the shape in
 * which "a failure looks like fewer courses" would be invisible.
 */
let byIdRejects = false;

function rowsFor(path: string): Array<{ id: string; [k: string]: unknown }> {
  if (path === 'courses') return mockCourses;
  if (path === 'libraryCourses') return mockLibrary;
  if (path.includes('adoptedCourses')) return mockAdopted as Array<{ id: string }>;
  return [];
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: { __path?: string; args?: unknown[] }, ...args: unknown[]) =>
    ({ __path: col?.__path, args: [...(col?.args ?? []), ...args] }),
  where: (field: string, op?: string, value?: unknown) => ({ __where: { field, op, value } }),
  limit: (n: number) => ({ __limit: n }),
  orderBy: (field: unknown) => ({ __orderBy: field }),
  documentId: () => '__name__',
  getCountFromServer: async (q: { __path?: string }) => ({ data: () => ({ count: rowsFor(q?.__path ?? '').length }) }),
  getDocs: async (q: { __path?: string; args?: Array<{ __where?: { field: string; value: string[] } }> }) => {
    const path = q?.__path ?? '';
    const inClause = (q?.args ?? []).find((a) => a?.__where?.field === '__name__');
    const ids: string[] | null = inClause ? inClause.__where!.value : null;
    if (ids && byIdRejects) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    const rows = rowsFor(path).filter((r) => (ids ? ids.includes(r.id) : true));
    const docs = rows.map((r) => ({ id: r.id, data: () => r }));
    return { docs, forEach: (fn: (d: unknown) => void) => docs.forEach(fn) };
  },
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  deleteDoc: async () => {},
  setDoc: async () => {},
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (q: { __path?: string }, onNext: (snap: unknown) => void) => {
    const rows = rowsFor(q?.__path ?? '');
    onNext({ docs: rows.map((c) => ({ id: c.id, data: () => c })) });
    return () => {};
  },
}));

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminCourses />);
    // Three flushes, not two: the by-id adoption read is a SECOND await behind
    // the adoption listener, so a two-flush mount would measure the screen
    // mid-resolution and every ghost assertion would pass for the wrong reason.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The header figure, read off the rendered heading rather than reconstructed. */
function headerText(): string {
  return Array.from(container.querySelectorAll('h1, h2, h3'))
    .map((h) => (h.textContent || '').trim())
    .find((t) => /course/i.test(t)) ?? '';
}

function tabLabel(which: 'own' | 'library'): string {
  const needle = which === 'own' ? /^Your courses/ : /^Library/;
  const b = Array.from(container.querySelectorAll('button')).find((x) => needle.test((x.textContent || '').trim()));
  if (!b) throw new Error(`no ${which} tab rendered`);
  return (b.textContent || '').trim();
}

function newCourseButton(): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button'))
    .find((x) => (x.textContent || '').trim().startsWith('New course'));
  if (!b) throw new Error('No "New course" button found');
  return b as HTMLButtonElement;
}

/** Number of course rows actually rendered under "Your courses". */
function renderedOwnRows(): number {
  return container.querySelectorAll('[data-course-row], .grid > *').length;
}

const REAL = { id: 'lib-real', title: 'Real Adopted Course', status: 'published' };

describe('THE-345 · a dangling adoption is not a course', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = undefined;
    mockCourses = [];
    mockLibrary = [];
    mockAdopted = [];
    byIdRejects = false;
    calls.fetches = [];
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  /* ═══ 9 · the founder's bug, exactly as he reported it ════════════════════ */

  it('9 · a dangling adoption does not count towards the figure', async () => {
    // The founder's tenant, reduced: fifteen slots, TWO adoption pointers, ONE
    // of which the platform has deleted from the catalogue.
    tenantCtx.tenantPlan = 'max'; // maxCourses: 15
    mockLibrary = [REAL];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-ghost', libraryCourseId: 'lib-ghost' },
    ];
    await mount();

    expect(headerText(), 'the header still counts the ghost').toContain('1 of 15');
    expect(headerText(), 'the header still says 2').not.toContain('2 of 15');
  });

  it('9b · a MALFORMED pointer does not count either', async () => {
    // The second cause: a record with no libraryCourseId at all. It is filtered
    // out before the by-id read, so it was never even asked about - and was
    // counted anyway.
    tenantCtx.tenantPlan = 'max';
    mockLibrary = [REAL];
    mockAdopted = [{ id: REAL.id, libraryCourseId: REAL.id }, { id: 'broken' }];
    await mount();

    expect(headerText()).toContain('1 of 15');
  });

  /* ═══ 10 · the plan slot ══════════════════════════════════════════════════ */

  it('10 · a dangling adoption does not consume a plan slot', async () => {
    // Two slots, one real adoption, one ghost. Before THE-345 this church was
    // at its limit and could not create a course; the slot was spent on nothing.
    tenantCtx.tenantPlan = 'plus'; // maxCourses: 2
    mockLibrary = [REAL];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-ghost', libraryCourseId: 'lib-ghost' },
    ];
    await mount();

    expect(newCourseButton().disabled, 'a course that does not exist is holding a plan slot').toBe(false);
  });

  /* ═══ 11 · the three figures agree, and are named per figure ══════════════ */

  it('11 · the count, the tab label and the plan cap agree', async () => {
    tenantCtx.tenantPlan = 'max';
    mockCourses = [{ id: 'own-1', title: 'Ours', author: 'A', status: 'draft' }];
    mockLibrary = [REAL];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-ghost', libraryCourseId: 'lib-ghost' },
    ];
    await mount();

    // One own course + one RESOLVED adoption = 2, on all three surfaces.
    expect(headerText(), 'the header figure').toContain('2 of 15');
    expect(tabLabel('own'), 'the "Your courses" tab').toBe('Your courses (2)');
    expect(tabLabel('library'), 'the "Library (N adopted)" tab').toBe('Library (1 adopted)');
    // And the cap agrees: 2 of 15 is nowhere near the limit.
    expect(newCourseButton().disabled).toBe(false);
  });

  it('11b · the search box cannot move the figure, the tab or the cap', async () => {
    // `myAdoptedCourses` is search-filtered and must never be any of the three.
    // Typing in the search box would otherwise change "N courses used" and,
    // through the same number, the plan cap.
    tenantCtx.tenantPlan = 'plus';
    mockLibrary = [REAL];
    mockAdopted = [{ id: REAL.id, libraryCourseId: REAL.id }];
    await mount();

    const before = { header: headerText(), own: tabLabel('own'), library: tabLabel('library') };
    const search = container.querySelector('input') as HTMLInputElement;
    expect(search, 'no search box rendered').toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'zzzz-matches-nothing');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(headerText(), 'search moved the header figure').toBe(before.header);
    expect(tabLabel('own'), 'search moved the tab count').toBe(before.own);
    expect(tabLabel('library'), 'search moved the library tab count').toBe(before.library);
  });

  /* ═══ 12 · a REAL adoption still counts — no-regression ═══════════════════ */

  it('12 · a real adoption still counts and still occupies a slot', async () => {
    // Deliberate, and recorded as such in AdminCourses: an adopted course
    // occupies a plan slot exactly like one the church authored. ONLY the ghost
    // stops counting.
    tenantCtx.tenantPlan = 'plus'; // maxCourses: 2
    mockCourses = [{ id: 'own-1', title: 'Ours', author: 'A', status: 'draft' }];
    mockLibrary = [REAL];
    mockAdopted = [{ id: REAL.id, libraryCourseId: REAL.id }];
    await mount();

    expect(headerText(), 'a real adoption stopped counting').toContain('2 of 2');
    expect(newCourseButton().disabled, 'a real adoption stopped occupying a slot').toBe(true);
    expect(newCourseButton().title).toMatch(/including adopted/i);
  });

  it('12b · two real adoptions alone still exhaust the plan', async () => {
    tenantCtx.tenantPlan = 'plus';
    mockLibrary = [REAL, { id: 'lib-2', title: 'Second', status: 'published' }];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-2', libraryCourseId: 'lib-2' },
    ];
    await mount();

    expect(newCourseButton().disabled).toBe(true);
  });

  /* ═══ 13 · the cap still fails closed — no-regression on THE-342 ══════════ */

  it('13 · an unknown or loading plan still falls back to plus and fails closed', async () => {
    tenantCtx.tenantPlan = undefined; // maxCourses: 2
    mockLibrary = [REAL, { id: 'lib-2', title: 'Second', status: 'published' }];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-2', libraryCourseId: 'lib-2' },
    ];
    await mount();

    expect(newCourseButton().disabled, 'an unknown plan stopped failing closed').toBe(true);
    expect(newCourseButton().title).toMatch(/up to 2 course/i);
  });

  /* ═══ 14 · a failed read is a FAILURE, never a smaller number ═════════════ */

  it('14 · a failed by-id read surfaces as a FAILURE, never as a zero', async () => {
    // THE HEART OF THIS TICKET'S RISK. Both a deleted catalogue course and a
    // rejected read leave `adoptedCourseDocs` short; if the screen treated them
    // alike, THE-345 would have turned a broken read into "you have fewer
    // courses" and, worse, into a free plan slot.
    tenantCtx.tenantPlan = 'plus'; // maxCourses: 2
    mockLibrary = [REAL, { id: 'lib-2', title: 'Second', status: 'published' }];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-2', libraryCourseId: 'lib-2' },
    ];
    byIdRejects = true;
    await mount();

    // The figure does NOT shrink: it stays at the raw pointer count.
    expect(headerText(), 'a failed read read as fewer courses').toContain('2 of 2');
    // The cap does NOT open.
    expect(newCourseButton().disabled, 'a failed read handed the church a free slot').toBe(true);
    // And the church is TOLD, rather than shown a quietly smaller number. The
    // failure Alert lives on the library view, where the read that failed is.
    const libraryTab = Array.from(container.querySelectorAll('button'))
      .find((b) => /^Library/.test((b.textContent || '').trim()))!;
    await act(async () => { libraryTab.click(); });
    expect(
      container.querySelector('[data-courses-read-failed]'),
      'a rejected read rendered no failure notice',
    ).toBeTruthy();
  });

  it('14b · a failed read shows no dangling-adoption notice — it is not the same fact', async () => {
    // "We could not read this" and "the platform withdrew a course you had" are
    // different sentences and a church must not be told the second when the
    // first happened.
    tenantCtx.tenantPlan = 'max';
    mockLibrary = [REAL];
    mockAdopted = [{ id: REAL.id, libraryCourseId: REAL.id }, { id: 'lib-ghost', libraryCourseId: 'lib-ghost' }];
    byIdRejects = true;
    await mount();

    expect(container.querySelector('[data-courses-dangling-adoptions]')).toBeNull();
  });

  /* ═══ the notice, and the cleanup path ════════════════════════════════════ */

  it('says so on screen rather than silently rounding the number off', async () => {
    tenantCtx.tenantPlan = 'max';
    mockLibrary = [REAL];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-ghost', libraryCourseId: 'lib-ghost' },
    ];
    await mount();

    const notice = container.querySelector('[data-courses-dangling-adoptions]');
    expect(notice, 'the count moved and nothing on screen said why').toBeTruthy();
    expect(notice!.getAttribute('data-courses-dangling-adoptions')).toBe('1');
  });

  it('clears a leftover record through the EXISTING un-adopt route, adding none', async () => {
    // `adoptedCourses` is `allow write: if false` and stays that way. DELETE
    // /api/courses/adopt already removes a pointer by id, already requires
    // createCourses, never reads libraryCourses on the way through, and is
    // documented idempotent - so a ghost needs no new route and no migration.
    tenantCtx.tenantPlan = 'max';
    mockLibrary = [REAL];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-ghost', libraryCourseId: 'lib-ghost' },
    ];
    await mount();

    const remove = Array.from(container.querySelectorAll('button'))
      .find((b) => /Remove leftover record/.test(b.textContent || ''));
    expect(remove, 'no way to clear the leftover record').toBeTruthy();
    await act(async () => { remove!.click(); });

    expect(calls.fetches).toHaveLength(1);
    expect(calls.fetches[0].url).toBe('/api/courses/adopt');
    expect(calls.fetches[0].method).toBe('DELETE');
    expect(calls.fetches[0].body).toEqual({ tenantId: 'tenant-1', libraryCourseId: 'lib-ghost' });
  });

  it('a church with no ghosts is shown no notice at all', async () => {
    tenantCtx.tenantPlan = 'max';
    mockLibrary = [REAL];
    mockAdopted = [{ id: REAL.id, libraryCourseId: REAL.id }];
    await mount();
    expect(container.querySelector('[data-courses-dangling-adoptions]')).toBeNull();
  });

  it('a church that has adopted nothing counts nothing and is told nothing', async () => {
    tenantCtx.tenantPlan = 'max';
    mockCourses = [{ id: 'own-1', title: 'Ours', author: 'A', status: 'draft' }];
    await mount();
    expect(headerText()).toContain('1 of 15');
    expect(tabLabel('library')).toBe('Library (0 adopted)');
    expect(container.querySelector('[data-courses-dangling-adoptions]')).toBeNull();
  });

  it('renders exactly one row for one real adoption — the row count matches the figure', async () => {
    // The founder's actual complaint was the DISAGREEMENT: two in the count,
    // one on screen. This asserts they now agree.
    tenantCtx.tenantPlan = 'max';
    mockLibrary = [REAL];
    mockAdopted = [
      { id: REAL.id, libraryCourseId: REAL.id },
      { id: 'lib-ghost', libraryCourseId: 'lib-ghost' },
    ];
    await mount();

    const html = container.innerHTML;
    // The real adoption is on screen...
    expect(html, 'the real adopted course stopped rendering').toContain(REAL.title);
    // ...and the ghost is nowhere, which is what makes the figure of 1 honest
    // rather than merely smaller. (The title is asserted by presence, not by
    // occurrence count: the card renders it in both a text node and a `title`
    // attribute, and pinning that arrangement would be pinning presentation.)
    expect(html, 'the ghost pointer reached the screen').not.toContain('lib-ghost');
    expect(renderedOwnRows(), 'no rows rendered at all').toBeGreaterThan(0);
  });
});
