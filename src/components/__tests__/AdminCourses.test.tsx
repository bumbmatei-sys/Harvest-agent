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
// Both resolvers, independently controllable — the whole apex bug is that they
// differ for a super admin with no host scope.
const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
}));
vi.mock('../AdminCourseEditor', () => ({
  default: () => <div data-testid="course-editor" />,
}));

const tenantCtx = vi.hoisted(() => ({ tenantPlan: undefined as string | undefined }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => tenantCtx,
}));

let mockCourses: Array<{ id: string; title: string; author: string; status: string }> = [];
let mockLibrary: Array<{ id: string; title: string; status: string }> = [];
let mockLibraryAuthors: Array<{ id: string; name: string; bio?: string }> = [];
let mockAdopted: Array<{ id: string; libraryCourseId: string }> = [];

// The read-only preview embeds the same player LessonView uses; the real one
// needs a live YouTube iframe API.
vi.mock('react-player/youtube', () => ({
  default: ({ url }: { url: string }) => <div data-testid="react-player" data-url={url} />,
}));

// Records the collection paths and every where() field, so the query SHAPES can
// be asserted directly — /courses must stay tenant-filtered while the library
// and adoption reads must stay unfiltered.
const calls = vi.hoisted(() => ({ paths: [] as string[], wheres: [] as string[], writes: [] as any[], fetches: [] as any[] }));

// Adoption is server-only now: adoptedCourses is `allow write: if false`, so the
// screen calls /api/courses/adopt instead of writing Firestore directly.
const mockAuthFetch = vi.hoisted(() => vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: (url: string, options: any) => {
    calls.fetches.push({ url, method: options?.method, body: JSON.parse(options?.body || '{}') });
    return mockAuthFetch();
  },
}));

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
    else if (path === 'libraryAuthors') rows = mockLibraryAuthors;
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
    mockLibraryAuthors = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
    calls.fetches = [];
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
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
    mockLibraryAuthors = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
    calls.fetches = [];
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as any);
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
      expect(calls.fetches).toHaveLength(0);
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

    it('keeps the /courses read tenant-filtered and the library reads unfiltered', async () => {
      await mount();
      expect(calls.paths).toContain('courses');
      // Exactly ONE where() in the whole screen: the tenantId filter on
      // /courses, whose rule dereferences resource.data.tenantId. The
      // libraryCourses and adoptedCourses rules reference no document field, so
      // adding a filter there would be pointless and removing the tenantId one
      // would empty the tenant list silently rather than erroring.
      expect(calls.wheres).toEqual(['tenantId']);
    });

    it('does NOT filter the catalogue by status — drafts are excluded in JS', async () => {
      // One filtering mechanism, not two. A status filter here would duplicate
      // adoptableCourses() and re-couple the query shape to a document field.
      mockLibrary = makeLibrary(1);
      await mount();
      expect(calls.wheres).not.toContain('status');
    });
  });

  describe('adopting', () => {
    it('goes through the server route, never a direct Firestore write', async () => {
      // adoptedCourses is `allow write: if false` — a direct setDoc would now be
      // rejected by the rules, so the screen must not attempt one.
      tenantCtx.tenantPlan = 'pro';
      mockLibrary = makeLibrary(1);
      await mount();
      await act(async () => { libraryTab().click(); });
      await act(async () => { adoptButtons()[0].click(); });

      expect(calls.writes.filter((w) => w.op === 'set')).toHaveLength(0);
      expect(calls.fetches).toHaveLength(1);
      expect(calls.fetches[0].url).toBe('/api/courses/adopt');
      expect(calls.fetches[0].method).toBe('POST');
      expect(calls.fetches[0].body).toEqual({ tenantId: 'tenant-1', libraryCourseId: 'lib-0' });
    });

    it('sends no course content to the route — the server derives it', async () => {
      tenantCtx.tenantPlan = 'pro';
      mockLibrary = makeLibrary(1);
      await mount();
      await act(async () => { libraryTab().click(); });
      await act(async () => { adoptButtons()[0].click(); });

      for (const key of ['title', 'levels', 'description', 'thumbnail', 'adoptedBy']) {
        expect(key in calls.fetches[0].body).toBe(false);
      }
    });

    it('surfaces the server 403 message when the cap is hit server-side', async () => {
      // The client cap is presentation; the route is the authority. If they ever
      // disagree (e.g. a stale plan in context), the server message is shown.
      tenantCtx.tenantPlan = 'pro';
      mockLibrary = makeLibrary(1);
      mockAuthFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Your plan includes up to 5 courses (including adopted library courses). Upgrade to add more.' }),
      } as any);
      await mount();
      await act(async () => { libraryTab().click(); });
      await act(async () => { adoptButtons()[0].click(); });

      expect(container.textContent).toMatch(/plan includes up to 5 courses/i);
    });

    it('un-adopting calls DELETE on the route', async () => {
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
      expect(calls.writes.filter((w) => w.op === 'delete')).toHaveLength(0);
      expect(calls.fetches[0]).toEqual({
        url: '/api/courses/adopt',
        method: 'DELETE',
        body: { tenantId: 'tenant-1', libraryCourseId: 'lib-0' },
      });
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

// ─────────────────────────────────────────────────────────────────────────────
// Adoption on the APEX domain as a super admin.
//
// getTenantScope() returns null BY DESIGN for a super admin with no host scope —
// null means "all tenants", which is right for a read and fatal for a write. The
// old code threw before the request left the browser, so there was no Vercel log
// and no Sentry event: just "Failed to adopt this course. Please try again.",
// deterministically, forever. getWriteTenantScope() resolves the platform tenant
// ('harvest') instead, which is exactly what it exists for.
// ─────────────────────────────────────────────────────────────────────────────
describe('AdminCourses — adoption on the apex domain', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = 'pro';
    mockCourses = [];
    mockLibrary = [];
    mockLibraryAuthors = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
    calls.fetches = [];
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as any);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  /** Apex super admin: the read scope is null, the write scope is the platform tenant. */
  function apexSuperAdmin() {
    scope.read = null;
    scope.write = 'harvest';
  }

  it('handleAdopt posts tenantId "harvest" when the read scope is null (apex super admin)', async () => {
    // THE regression test for the reported bug. Reverting handleAdopt to
    // getTenantScope() makes this fail: no fetch is issued at all.
    apexSuperAdmin();
    mockLibrary = makeLibrary(1);
    await mount();
    await act(async () => { libraryTab().click(); });
    await act(async () => { adoptButtons()[0].click(); });

    expect(calls.fetches).toHaveLength(1);
    expect(calls.fetches[0].method).toBe('POST');
    expect(calls.fetches[0].body).toEqual({ tenantId: 'harvest', libraryCourseId: 'lib-0' });
  });

  it('un-adopt resolves the tenant the same way on the apex', async () => {
    apexSuperAdmin();
    mockLibrary = makeLibrary(1);
    mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
    await mount();
    await act(async () => { libraryTab().click(); });

    const remove = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('Remove from your courses')
    ) as HTMLButtonElement;
    await act(async () => { remove.click(); });

    expect(calls.fetches[0]).toEqual({
      url: '/api/courses/adopt',
      method: 'DELETE',
      body: { tenantId: 'harvest', libraryCourseId: 'lib-0' },
    });
  });

  it('the adoption listener subscribes to the platform tenant on the apex', async () => {
    // Without this the adopt fix is invisible: the write lands but nothing reads
    // it back, so no "Adopted" badge and the plan cap undercounts.
    apexSuperAdmin();
    await mount();
    expect(calls.paths).toContain('tenants/harvest/adoptedCourses');
  });

  it('a non-super-admin with no resolvable tenant does NOT post, and says why', async () => {
    // Both resolvers null — a genuinely unresolvable tenant. Still the right
    // outcome, but it must not masquerade as a transient failure.
    scope.read = null;
    scope.write = null;
    mockLibrary = makeLibrary(1);
    await mount();
    await act(async () => { libraryTab().click(); });
    await act(async () => { adoptButtons()[0].click(); });

    expect(calls.fetches).toHaveLength(0);
    expect(container.textContent).toMatch(/could not determine which church/i);
    expect(container.textContent).not.toMatch(/please try again/i);
  });

  // NOTE: there is deliberately no un-adopt equivalent of the test above. With
  // no resolvable tenant the adoption listener never subscribes, so `adopted` is
  // empty and the UI shows "Adopt" rather than "Remove" — the un-adopt guard is
  // unreachable through the interface. It shares describeAdoptionFailure with
  // handleAdopt, which IS covered. Fabricating the state to reach it would test
  // a situation that cannot occur.

  it('an ordinary tenant admin on a subdomain is unaffected', async () => {
    // getWriteTenantScope falls through to the host scope, so nothing changes
    // for the overwhelmingly common case.
    mockLibrary = makeLibrary(1);
    await mount();
    await act(async () => { libraryTab().click(); });
    await act(async () => { adoptButtons()[0].click(); });
    expect(calls.fetches[0].body).toEqual({ tenantId: 'tenant-1', libraryCourseId: 'lib-0' });
  });
});

describe('AdminCourses — library card description', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = 'pro';
    mockCourses = [];
    mockLibrary = [];
    mockLibraryAuthors = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
    calls.fetches = [];
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  it('renders the description as text, not raw HTML', async () => {
    // Descriptions come from the rich-text editor, so `<p>Test</p>` was being
    // shown literally on the card.
    mockLibrary = [{ id: 'lib-0', title: 'Course', status: 'published', description: '<p>Test</p>' } as any];
    await mount();
    await act(async () => { libraryTab().click(); });

    expect(container.textContent).toContain('Test');
    expect(container.textContent).not.toContain('<p>');
    expect(container.innerHTML).not.toContain('&lt;p&gt;');
  });

  it('flattens a multi-paragraph description to one line', async () => {
    mockLibrary = [{
      id: 'lib-0', title: 'Course', status: 'published',
      description: '<p>First.</p><p>Second.</p>',
    } as any];
    await mount();
    await act(async () => { libraryTab().click(); });
    expect(container.textContent).toContain('First. Second.');
  });

  it('tolerates a missing description', async () => {
    mockLibrary = [{ id: 'lib-0', title: 'Course', status: 'published' } as any];
    await mount();
    await act(async () => { libraryTab().click(); });
    expect(container.textContent).toContain('Course');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Adopted courses on the "Your courses" tab.
//
// They occupy a plan slot and members see them, so listing them only under
// Library made the tab that answers "what does this church have?" answer it
// wrongly. They render READ-ONLY: no Edit, because the tenant does not own the
// content — the platform edits it and the change reaches every adopter — and the
// remove action un-adopts the pointer rather than deleting anything.
// ─────────────────────────────────────────────────────────────────────────────
describe('AdminCourses — adopted courses under "Your courses"', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = 'pro';
    mockCourses = [];
    mockLibrary = [];
    mockLibraryAuthors = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
    calls.fetches = [];
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as any);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  function seedOneAdopted(title = 'Foundations of Prayer') {
    mockLibrary = [{ id: 'lib-0', title, status: 'published' } as any];
    mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
  }

  it('lists an adopted course on the Your courses tab', async () => {
    seedOneAdopted();
    await mount();
    // Default view is 'own' — no tab click.
    expect(container.textContent).toContain('Foundations of Prayer');
    expect(container.textContent).toContain('Adopted');
  });

  it('counts adopted courses in the Your courses tab label', async () => {
    mockCourses = makeCourses(2);
    seedOneAdopted();
    await mount();
    expect(container.textContent).toContain('Your courses (3)');
  });

  it('shows own courses AND adopted courses together', async () => {
    mockCourses = makeCourses(1);
    seedOneAdopted();
    await mount();
    expect(container.textContent).toContain('Course 0');
    expect(container.textContent).toContain('Foundations of Prayer');
  });

  it('offers NO edit control for an adopted course', async () => {
    // One own course → exactly one Edit control, belonging to it. The adopted
    // row must not add a second: the tenant does not own that content.
    mockCourses = makeCourses(1);
    seedOneAdopted();
    await mount();
    expect(container.querySelectorAll('[title="Edit"]')).toHaveLength(1);
  });

  it('an adopted course with no own courses offers no edit control at all', async () => {
    seedOneAdopted();
    await mount();
    expect(container.querySelectorAll('[title="Edit"]')).toHaveLength(0);
  });

  it('removing an adopted course un-adopts it — it does not delete anything', async () => {
    // The distinction that matters: the tenant Delete button opens a destructive
    // confirm for a course they own; this one calls the un-adopt route.
    seedOneAdopted();
    await mount();

    const remove = container.querySelector('[title="Remove from your courses"]') as HTMLButtonElement;
    expect(remove).not.toBeNull();
    await act(async () => { remove.click(); });

    expect(calls.fetches[0]).toEqual({
      url: '/api/courses/adopt',
      method: 'DELETE',
      body: { tenantId: 'tenant-1', libraryCourseId: 'lib-0' },
    });
    // No Firestore delete, and no destructive confirm dialog.
    expect(calls.writes.filter((w) => w.op === 'delete')).toHaveLength(0);
    expect(container.textContent).not.toContain('Delete course');
  });

  it('a dangling adoption pointer is dropped, not rendered blank', async () => {
    // The platform can delete a catalogue course; the adoption record survives
    // until someone un-adopts it.
    mockLibrary = [];
    mockLibraryAuthors = [];
    mockAdopted = [{ id: 'gone', libraryCourseId: 'gone' }];
    await mount();
    expect(container.querySelectorAll('[title="Remove from your courses"]')).toHaveLength(0);
    expect(container.textContent).toContain('No courses found');
  });

  it('the empty state accounts for adopted courses', async () => {
    seedOneAdopted();
    await mount();
    expect(container.textContent).not.toContain('No courses found');
  });

  it('search filters adopted courses too', async () => {
    mockCourses = [];
    mockLibrary = [
      { id: 'lib-0', title: 'Prayer', status: 'published' } as any,
      { id: 'lib-1', title: 'Fasting', status: 'published' } as any,
    ];
    mockAdopted = [
      { id: 'lib-0', libraryCourseId: 'lib-0' },
      { id: 'lib-1', libraryCourseId: 'lib-1' },
    ];
    await mount();
    // ×2: the mobile and desktop lists both render in happy-dom, which applies
    // no CSS media queries, so each row appears once per viewport variant.
    expect(container.querySelectorAll('[title="Remove from your courses"]')).toHaveLength(4);

    const search = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'Prayer');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('[title="Remove from your courses"]')).toHaveLength(2);
    expect(container.textContent).toContain('Prayer');
    expect(container.textContent).not.toContain('Fasting');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The read-only catalogue preview, reached from the Library tab.
//
// Adopting a course to find out what is in it costs one of 2 or 5 plan slots.
// The preview is how an admin sees the description, teacher and curriculum —
// including the videos — before spending one.
// ─────────────────────────────────────────────────────────────────────────────
function previewCard(title: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.title || '') === `Preview ${title}`,
  );
  if (!button) throw new Error(`No preview affordance for "${title}"`);
  return button as HTMLButtonElement;
}

function inPreview(): boolean {
  return (container.textContent || '').includes('Library preview');
}

describe('AdminCourses — previewing a catalogue course', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tenantCtx.tenantPlan = 'pro';
    mockCourses = [];
    mockLibrary = [];
    mockLibraryAuthors = [];
    mockAdopted = [];
    calls.paths = [];
    calls.wheres = [];
    calls.writes = [];
    calls.fetches = [];
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as any);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  const RICH = {
    id: 'lib-0', title: 'Foundations of Prayer', status: 'published',
    description: '<p>A <strong>deep</strong> study.</p>',
    category: 'Discipleship', authorIds: ['lib-auth-1'],
    levels: [{ id: 'lv', title: 'Level 1', sections: [{ id: 's', title: 'Beginnings', lessons: [
      { id: 'l1', title: 'Why We Pray', duration: '10 min', authorId: 'lib-auth-1', summary: '', youtubeId: 'abc12345678' },
    ] }] }],
  };

  async function openPreview() {
    mockLibrary = [RICH as any];
    mockLibraryAuthors = [{ id: 'lib-auth-1', name: 'Dr Platform Teacher', bio: 'Thirty years.' }];
    await mount();
    await act(async () => { libraryTab().click(); });
    await act(async () => { previewCard('Foundations of Prayer').click(); });
  }

  it('opens from the catalogue card and shows the course in detail', async () => {
    await openPreview();
    expect(inPreview()).toBe(true);
    expect(container.textContent).toContain('Foundations of Prayer');
    expect(container.textContent).toContain('A deep study.');   // formatted, not stripped
    expect(container.textContent).toContain('Dr Platform Teacher');
    expect(container.textContent).toContain('Thirty years.');   // the author's bio
    expect(container.textContent).toContain('Level 1');
    expect(container.textContent).toContain('Beginnings');
    expect(container.textContent).toContain('Why We Pray');
  });

  it('reads libraryAuthors — a catalogue author never resolves in tenant /authors', async () => {
    // Separate namespaces. This is the same trap #248 hit on the certificate's
    // teacher name: looking a library author up in /authors finds nothing.
    await openPreview();
    expect(calls.paths).toContain('libraryAuthors');
  });

  it('OPENING A PREVIEW PERFORMS ZERO FIRESTORE WRITES', async () => {
    // THE test that matters most. A preview must not create a single document —
    // no progress, no completedLessons, no quiz attempt, no lastWatchedVideo.
    // Removing the read-only guard fails here.
    await openPreview();
    await act(async () => {
      const lesson = Array.from(container.querySelectorAll('button'))
        .find((b) => (b.textContent || '').includes('Why We Pray')) as HTMLButtonElement;
      lesson.click();
    });

    expect(calls.writes).toHaveLength(0);
    expect(calls.fetches).toHaveLength(0);
  });

  it('does not count a preview against the plan cap', async () => {
    // Looking is free; only adopting spends a slot.
    tenantCtx.tenantPlan = 'plus'; // 2
    mockCourses = makeCourses(1);
    await openPreview();
    await act(async () => { buttonInPreview('Back to the library')!.click(); });
    // One own course, nothing adopted — the preview spent nothing.
    expect(container.textContent).toContain('1 of 2 courses used');
    const ownTab = Array.from(container.querySelectorAll('button'))
      .find((b) => (b.textContent || '').startsWith('Your courses')) as HTMLButtonElement;
    await act(async () => { ownTab.click(); });
    expect(newCourseButton().disabled).toBe(false);
  });

  it('closes back to the library list', async () => {
    await openPreview();
    await act(async () => { buttonInPreview('Back to the library')!.click(); });
    expect(inPreview()).toBe(false);
    // Back on the Library tab, with the catalogue card and its Adopt button.
    expect(container.textContent).toContain('Courses published by Harvest');
    expect(adoptButtons()).toHaveLength(1);
  });

  it('falls back to the list if the catalogue course disappears while open', async () => {
    // The platform can delete a course; a blank screen would be the wrong answer.
    await openPreview();
    expect(inPreview()).toBe(true);
    mockLibrary = [];
    mockLibraryAuthors = [];
    await act(async () => { root.unmount(); });
    await mount();
    expect(inPreview()).toBe(false);
  });

  describe('adopting from the preview', () => {
    it('posts the SAME payload as the catalogue card', async () => {
      await openPreview();
      await act(async () => { buttonInPreview('Adopt')!.click(); });

      expect(calls.fetches).toHaveLength(1);
      expect(calls.fetches[0]).toEqual({
        url: '/api/courses/adopt',
        method: 'POST',
        body: { tenantId: 'tenant-1', libraryCourseId: 'lib-0' },
      });
      // Server-only collection: still never a direct Firestore write.
      expect(calls.writes).toHaveLength(0);
    });

    it('sends no course content — the server derives it', async () => {
      await openPreview();
      await act(async () => { buttonInPreview('Adopt')!.click(); });
      for (const key of ['title', 'levels', 'description', 'thumbnail', 'adoptedBy']) {
        expect(key in calls.fetches[0].body).toBe(false);
      }
    });

    it('resolves the tenant with the WRITE scope on the apex', async () => {
      scope.read = null;
      scope.write = 'harvest';
      await openPreview();
      await act(async () => { buttonInPreview('Adopt')!.click(); });
      expect(calls.fetches[0].body).toEqual({ tenantId: 'harvest', libraryCourseId: 'lib-0' });
    });

    it('disables Adopt at the cap, with the same message the card shows', async () => {
      tenantCtx.tenantPlan = 'plus';
      mockCourses = makeCourses(2);
      await openPreview();
      const adopt = buttonInPreview('Adopt')!;
      expect(adopt.disabled).toBe(true);
      expect(adopt.title).toMatch(/plan includes up to 2 course/i);
    });
  });

  describe("the church's own settings", () => {
    it('are not offered for a course that has not been adopted', async () => {
      await openPreview();
      expect(container.textContent).not.toMatch(/your church's settings/i);
    });

    it('PATCH the route — never a direct Firestore write', async () => {
      // adoptedCourses is `allow write: if false` (#247) and stays that way.
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      await openPreview();

      const toggle = container.querySelector('[aria-label="Issue a certificate"]') as HTMLButtonElement;
      expect(toggle).not.toBeNull();
      await act(async () => { toggle.click(); });

      expect(calls.writes).toHaveLength(0);
      expect(calls.fetches).toHaveLength(1);
      expect(calls.fetches[0]).toEqual({
        url: '/api/courses/adopt',
        method: 'PATCH',
        body: { tenantId: 'tenant-1', libraryCourseId: 'lib-0', issueCertificate: true },
      });
    });

    it('send ONLY the one field being changed', async () => {
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      await openPreview();
      const toggle = container.querySelector('[aria-label="Issue a certificate"]') as HTMLButtonElement;
      await act(async () => { toggle.click(); });
      expect(Object.keys(calls.fetches[0].body).sort())
        .toEqual(['issueCertificate', 'libraryCourseId', 'tenantId']);
    });

    it('offer NO edit control for anything else', async () => {
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      await openPreview();
      expect(container.querySelectorAll('[title="Edit"]')).toHaveLength(0);
      const switches = Array.from(container.querySelectorAll('[role="switch"]'));
      expect(switches.map((s) => s.getAttribute('aria-label')).sort())
        .toEqual(['Issue a certificate', 'Require the quiz']);
    });

    it('requireQuiz is disabled on a course with no quizzes, and explains why', async () => {
      // The route refuses it too (409); the UI simply does not offer a setting
      // it knows would have no effect.
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      await openPreview();
      const toggle = container.querySelector('[aria-label="Require the quiz"]') as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
      expect(toggle.title).toMatch(/no quizzes/i);

      await act(async () => { toggle.click(); });
      expect(calls.fetches).toHaveLength(0);
    });

    it('surfaces the route error when a save is refused', async () => {
      mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
      mockAuthFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'This course has no quizzes, so requiring one would have no effect.' }),
      } as any);
      await openPreview();
      const toggle = container.querySelector('[aria-label="Issue a certificate"]') as HTMLButtonElement;
      await act(async () => { toggle.click(); });
      expect(container.textContent).toMatch(/no quizzes/i);
    });
  });

  it('is reachable from the adopted row under "Your courses" too', async () => {
    mockLibrary = [RICH as any];
    mockAdopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
    await mount();
    // Default view is 'own' — no tab click.
    await act(async () => { previewCard('Foundations of Prayer').click(); });
    expect(inPreview()).toBe(true);
    expect(container.textContent).toMatch(/your church's settings/i);
  });
});

function buttonInPreview(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim().includes(text),
  ) as HTMLButtonElement | undefined;
}
