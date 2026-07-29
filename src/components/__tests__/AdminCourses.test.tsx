import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCourses from '../AdminCourses';

/**
 * Pins maxCourses enforcement (mirrors the maxChurches fail-closed pattern in
 * AdminChurches): the "New course" button must disable once the tenant's
 * course count reaches their plan's maxCourses, fall back to 'plus' on an
 * unknown/loading plan, treat -1 as unlimited, and never hide or delete
 * courses a tenant already has beyond their (possibly downgraded) limit.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-uid' } } }));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant-1' }));
vi.mock('../AdminCourseEditor', () => ({
  default: () => <div data-testid="course-editor" />,
}));

const tenantCtx = vi.hoisted(() => ({ tenantPlan: undefined as string | undefined }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => tenantCtx,
}));

let mockCourses: Array<{ id: string; title: string; author: string; status: string }> = [];
let mockLibrary: Array<{ id: string; title: string; status: string }> = [];
let mockAdopted: Array<{ id: string; libraryCourseId: string }> = [];

// Records the collection paths and every where() field, so the query SHAPES can
// be asserted directly — /courses must stay tenant-filtered while the library
// and adoption reads must stay unfiltered.
const calls = vi.hoisted(() => ({ paths: [] as string[], wheres: [] as string[], writes: [] as any[] }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args }),
  where: (field: string) => { calls.wheres.push(field); return {}; },
  limit: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  deleteDoc: async (ref: any) => { calls.writes.push({ op: 'delete', path: ref?.__path }); },
  setDoc: async (ref: any, data: unknown) => { calls.writes.push({ op: 'set', path: ref?.__path, data }); },
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (q: any, onNext: (snap: unknown) => void) => {
    const path = q?.__path ?? '';
    calls.paths.push(path);
    let rows: any[] = [];
    if (path === 'courses') rows = mockCourses;
    else if (path === 'libraryCourses') rows = mockLibrary;
    else if (path.includes('adoptedCourses')) rows = mockAdopted;
    onNext({ docs: rows.map((c) => ({ id: c.id, data: () => c })) });
    return () => {};
  },
}));

function makeCourses(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `course-${i}`,
    title: `Course ${i}`,
    author: 'Author',
    status: 'draft',
  }));
}

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminCourses />);
    // Flush the getTenantScope() microtask + onSnapshot callback inside the effect.
    await Promise.resolve();
    await Promise.resolve();
  });
}

function newCourseButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').trim().startsWith('New course')
  );
  if (!button) throw new Error('No "New course" button found');
  return button as HTMLButtonElement;
}

describe('AdminCourses — maxCourses enforcement', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = undefined;
    mockCourses = [];
    mockLibrary = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  it('allows creating a new course when under the plan limit', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxCourses: 2
    mockCourses = makeCourses(1);
    await mount();

    const button = newCourseButton();
    expect(button.disabled).toBe(false);

    await act(async () => { button.click(); });
    expect(container.querySelector('[data-testid="course-editor"]')).not.toBeNull();
  });

  it('blocks creating a new course at the plan limit', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxCourses: 2
    mockCourses = makeCourses(2);
    await mount();

    const button = newCourseButton();
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/plan includes up to 2 course/i);

    await act(async () => { button.click(); });
    // Disabled buttons don't dispatch click handlers — the editor never opens.
    expect(container.querySelector('[data-testid="course-editor"]')).toBeNull();
  });

  it('treats -1 as unlimited (Ministry/ultra) regardless of course count', async () => {
    tenantCtx.tenantPlan = 'ultra'; // maxCourses: -1
    mockCourses = makeCourses(50);
    await mount();

    const button = newCourseButton();
    expect(button.disabled).toBe(false);

    await act(async () => { button.click(); });
    expect(container.querySelector('[data-testid="course-editor"]')).not.toBeNull();
  });

  it('fails closed to the plus limit when the plan is unknown/still loading', async () => {
    tenantCtx.tenantPlan = undefined;
    mockCourses = makeCourses(2); // at plus's cap of 2
    await mount();

    const button = newCourseButton();
    expect(button.disabled).toBe(true);
  });

  it('never hides or deletes existing courses when a tenant is already over their limit', async () => {
    tenantCtx.tenantPlan = 'plus'; // maxCourses: 2, tenant has 5 (e.g. after a downgrade)
    mockCourses = makeCourses(5);
    await mount();

    // Creation is blocked...
    expect(newCourseButton().disabled).toBe(true);
    // ...but every existing course is still shown and editable/deletable.
    for (const course of mockCourses) {
      expect(container.textContent).toContain(course.title);
    }
    expect(container.querySelectorAll('[title="Delete"]').length).toBeGreaterThanOrEqual(5);
  });
});

function libraryTab(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').trim().startsWith('Library (')
  );
  if (!button) throw new Error('No Library tab found');
  return button as HTMLButtonElement;
}

function adoptButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter((b) =>
    (b.textContent || '').trim() === 'Adopt'
  ) as HTMLButtonElement[];
}

function makeLibrary(n: number, status = 'published') {
  return Array.from({ length: n }, (_, i) => ({
    id: `lib-${i}`, title: `Library Course ${i}`, status,
  }));
}

/**
 * Adoption: the browse-and-adopt sub-view, and the cap counting BOTH lists.
 *
 * The cap is the load-bearing one. maxCourses has always been computed from
 * `courses.length` alone; an adopted course now occupies a slot too, so a tenant
 * with one own course and one adoption is at the Individual limit of 2 — the
 * exact case a count of own courses would miss.
 */
describe('AdminCourses — library adoption', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = undefined;
    mockCourses = [];
    mockLibrary = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  describe('the cap counts adopted courses', () => {
    it('one own course + one adoption reaches the Individual limit of 2', async () => {
      tenantCtx.tenantPlan = 'plus';
      mockCourses = makeCourses(1);
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      await mount();

      expect(newCourseButton().disabled).toBe(true);
      expect(newCourseButton().title).toMatch(/up to 2 courses/i);
    });

    it('mentions adopted courses in the cap message', async () => {
      tenantCtx.tenantPlan = 'plus';
      mockCourses = makeCourses(1);
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      await mount();
      expect(newCourseButton().title).toMatch(/including adopted/i);
    });

    it('adoptions alone can exhaust the plan', async () => {
      tenantCtx.tenantPlan = 'plus';
      mockCourses = [];
      mockAdopted = [
        { id: 'lib-0', libraryCourseId: 'lib-0' },
        { id: 'lib-1', libraryCourseId: 'lib-1' },
      ];
      await mount();
      expect(newCourseButton().disabled).toBe(true);
    });

    it('blocks adopting once the cap is reached', async () => {
      tenantCtx.tenantPlan = 'plus';
      mockCourses = makeCourses(2);
      mockLibrary = makeLibrary(3);
      await mount();
      await act(async () => { libraryTab().click(); });

      const buttons = adoptButtons();
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) expect(b.disabled).toBe(true);

      await act(async () => { buttons[0].click(); });
      expect(calls.writes.filter((w) => w.op === 'set')).toHaveLength(0);
    });

    it('allows adopting under the cap, and -1 never blocks', async () => {
      tenantCtx.tenantPlan = 'ultra'; // maxCourses: -1
      mockCourses = makeCourses(50);
      mockLibrary = makeLibrary(2);
      await mount();
      await act(async () => { libraryTab().click(); });

      for (const b of adoptButtons()) expect(b.disabled).toBe(false);
    });

    it('fails closed to the plus limit when the plan is still loading', async () => {
      tenantCtx.tenantPlan = undefined;
      mockAdopted = [
        { id: 'lib-0', libraryCourseId: 'lib-0' },
        { id: 'lib-1', libraryCourseId: 'lib-1' },
      ];
      await mount();
      expect(newCourseButton().disabled).toBe(true);
    });
  });

  describe('query shapes', () => {
    it('reads libraryCourses and the tenant adoption subcollection', async () => {
      await mount();
      expect(calls.paths).toContain('libraryCourses');
      expect(calls.paths).toContain('tenants/tenant-1/adoptedCourses');
    });

    it('keeps the /courses read tenant-filtered', async () => {
      await mount();
      expect(calls.paths).toContain('courses');
      // Exactly ONE where() in the whole screen: the tenantId filter on /courses.
      // The library and adoption reads must add none — their rules reference no
      // document field, so a filter there would silently match nothing.
      expect(calls.wheres).toEqual(['tenantId']);
    });
  });

  describe('adopting', () => {
    it('writes a pointer with no course content to the tenant subcollection', async () => {
      tenantCtx.tenantPlan = 'pro';
      mockLibrary = makeLibrary(1);
      await mount();
      await act(async () => { libraryTab().click(); });
      await act(async () => { adoptButtons()[0].click(); });

      const write = calls.writes.find((w) => w.op === 'set');
      expect(write).toBeDefined();
      expect(write.path).toBe('tenants/tenant-1/adoptedCourses/lib-0');
      expect(write.data.libraryCourseId).toBe('lib-0');
      expect(write.data.adoptedBy).toBe('admin-uid');
      for (const key of ['title', 'levels', 'description', 'thumbnail']) {
        expect(key in write.data).toBe(false);
      }
    });

    it('un-adopting deletes the pointer', async () => {
      tenantCtx.tenantPlan = 'pro';
      mockLibrary = makeLibrary(1);
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      await mount();
      await act(async () => { libraryTab().click(); });

      const remove = Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('Remove from your courses')
      ) as HTMLButtonElement;
      expect(remove).toBeDefined();

      await act(async () => { remove.click(); });
      expect(calls.writes.find((w) => w.op === 'delete')?.path)
        .toBe('tenants/tenant-1/adoptedCourses/lib-0');
    });
  });

  describe('unpublished catalogue entries', () => {
    it('are neither shown nor adoptable', async () => {
      tenantCtx.tenantPlan = 'pro';
      mockLibrary = [
        { id: 'lib-pub', title: 'Published One', status: 'published' },
        { id: 'lib-draft', title: 'Draft One', status: 'draft' },
      ];
      await mount();
      await act(async () => { libraryTab().click(); });

      expect(container.textContent).toContain('Published One');
      expect(container.textContent).not.toContain('Draft One');
      expect(adoptButtons()).toHaveLength(1);
    });
  });

  it('does not let a tenant edit an adopted course', async () => {
    // Adopted courses are pointers into a catalogue the tenant does not own —
    // the library view offers Adopt/Remove only, never the builder.
    tenantCtx.tenantPlan = 'pro';
    mockLibrary = makeLibrary(1);
    mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
    await mount();
    await act(async () => { libraryTab().click(); });

    expect(container.querySelector('[data-testid="course-editor"]')).toBeNull();
    expect(container.querySelectorAll('[title="Edit"]')).toHaveLength(0);
  });
});
