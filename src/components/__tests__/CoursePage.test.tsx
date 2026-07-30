import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CoursePage from '../CoursePage';

/**
 * The member-facing course screen, and specifically WHICH tenant its adopted
 * library courses are read from.
 *
 * CoursePage issues two reads with opposite scoping requirements from what used
 * to be one resolver:
 *
 *   • /courses          — FIELD-FILTERED (`where('tenantId','==',…)`). null is
 *                         correct here: a super admin on the apex reads unscoped.
 *   • adoptedCourses    — a tenant-scoped PATH, tenants/{id}/adoptedCourses.
 *                         null cannot build it, so the block was skipped and the
 *                         adopted course silently never reached the member app.
 *
 * Both resolvers are mocked INDEPENDENTLY here (as in AdminCourses' tests), because
 * the entire bug is that they differ for a super admin with no host scope.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
}));

// Records every collection path read, so the adoption path can be asserted directly.
const calls = vi.hoisted(() => ({ paths: [] as string[], wheres: [] as string[] }));

const data = vi.hoisted(() => ({
  courses: [] as any[],
  authors: [] as any[],
  categories: [] as any[],
  libraryCourses: [] as any[],
  libraryAuthors: [] as any[],
  libraryCategories: [] as any[],
  adopted: [] as any[],
}));

function rowsFor(path: string): any[] {
  if (path === 'courses') return data.courses;
  if (path === 'authors') return data.authors;
  if (path === 'categories') return data.categories;
  if (path === 'libraryCourses') return data.libraryCourses;
  if (path === 'libraryAuthors') return data.libraryAuthors;
  if (path === 'libraryCategories') return data.libraryCategories;
  if (path.includes('adoptedCourses')) return data.adopted;
  return [];
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args }),
  where: (field: string) => { calls.wheres.push(field); return {}; },
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  updateDoc: async () => {},
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async (ref: any) => {
    const path = ref?.__path ?? '';
    calls.paths.push(path);
    const rows = rowsFor(path);
    const docs = rows.map((r) => ({ id: r.id, data: () => r }));
    return { docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
  },
}));

// The library screen is mocked to expose the merged list CoursePage hands it —
// the merge is what these tests are about, not CourseLibrary's rendering.
const received = vi.hoisted(() => ({ courses: [] as any[], authors: [] as any[], categories: [] as any[] }));
vi.mock('../../components/course/CourseLibrary', () => ({
  CourseLibrary: (props: any) => {
    received.courses = props.courses;
    received.authors = props.authors;
    received.categories = props.categories;
    return <div data-testid="library">{props.courses.map((c: any) => <span key={c.id}>{c.title}</span>)}</div>;
  },
}));

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<CoursePage />);
    // Flush the resolver microtasks + the three sequential getDocs chains.
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function titles(): string[] {
  return received.courses.map((c) => c.title);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  calls.paths = [];
  calls.wheres = [];
  received.courses = [];
  received.authors = [];
  received.categories = [];
  data.courses = [];
  data.authors = [];
  data.categories = [];
  data.libraryCourses = [];
  data.libraryAuthors = [];
  data.libraryCategories = [];
  data.adopted = [];
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

/** Apex super admin: read scope null ("all tenants"), write scope the platform tenant. */
function apexSuperAdmin() {
  scope.read = null;
  scope.write = 'harvest';
}

function seedAdopted(over?: any) {
  data.libraryCourses = [{
    id: 'lib-0', title: 'Foundations of Prayer', status: 'published',
    description: '<p>Library course.</p>', category: 'Discipleship', authorIds: ['lib-auth-1'],
    levels: [], ...over,
  }];
  data.adopted = [{ id: 'lib-0', libraryCourseId: 'lib-0' }];
}

describe('CoursePage — adopted courses reach the member app on the apex', () => {
  it('an apex super admin (read scope null, write scope "harvest") SEES the adopted course', async () => {
    // ── THE regression test for the reported bug. ──
    // Reverting the gate to getTenantScope() makes this fail: the read scope is
    // null on the apex, so the adopted block is skipped entirely and the member
    // list comes back with the tenant's own courses only — no error, no empty
    // state, just a course that silently does not exist for members.
    apexSuperAdmin();
    seedAdopted();
    await mount();

    expect(calls.paths).toContain('tenants/harvest/adoptedCourses');
    expect(titles()).toContain('Foundations of Prayer');
  });

  it('reads the adoption path from the WRITE scope, never the null read scope', async () => {
    apexSuperAdmin();
    seedAdopted();
    await mount();
    // A null read scope must never be interpolated into the path.
    expect(calls.paths.some((p) => p.includes('tenants/null/'))).toBe(false);
  });

  it('keeps the /courses read unscoped on the apex — that branch is deliberate', async () => {
    // The fix must NOT touch the field-filtered read: null means "every tenant"
    // there, which is exactly right for a super admin in platform context.
    apexSuperAdmin();
    data.courses = [{ id: 'own-1', title: 'Our Own Course', status: 'published', levels: [] }];
    seedAdopted();
    await mount();

    expect(calls.paths).toContain('courses');
    expect(calls.wheres).not.toContain('tenantId');
    expect(titles()).toEqual(['Our Own Course', 'Foundations of Prayer']);
  });

  it('an ordinary member on a subdomain is unchanged', async () => {
    // Both resolvers agree on a real host scope, so nothing about the common
    // case moves.
    scope.read = 'tenant-1';
    scope.write = 'tenant-1';
    data.courses = [{ id: 'own-1', title: 'Our Own Course', status: 'published', levels: [] }];
    seedAdopted();
    await mount();

    expect(calls.paths).toContain('tenants/tenant-1/adoptedCourses');
    expect(calls.wheres).toContain('tenantId');
    expect(titles()).toEqual(['Our Own Course', 'Foundations of Prayer']);
  });

  it('no resolvable tenant at all reads no adoption path and shows only own courses', async () => {
    // A signed-out / tenant-less visitor. Still the right outcome: there is
    // genuinely no tenant whose adoptions could apply.
    scope.read = null;
    scope.write = null;
    data.courses = [{ id: 'own-1', title: 'Our Own Course', status: 'published', levels: [] }];
    seedAdopted();
    await mount();

    expect(calls.paths.some((p) => p.includes('adoptedCourses'))).toBe(false);
    expect(titles()).toEqual(['Our Own Course']);
  });
});

describe('CoursePage — what members may see', () => {
  it('an UNPUBLISHED adopted course never reaches members', async () => {
    // adoptableCourses() is the single filtering mechanism: the church still
    // holds the pointer (and the plan slot), but members stop seeing it.
    apexSuperAdmin();
    seedAdopted({ status: 'draft' });
    await mount();

    expect(calls.paths).toContain('tenants/harvest/adoptedCourses');
    expect(titles()).not.toContain('Foundations of Prayer');
    expect(titles()).toHaveLength(0);
  });

  it("the tenant's OWN featured course still wins over an adopted one", async () => {
    // CourseLibrary picks the hero with courses.find(c => c.featured); a featured
    // LIBRARY course must never outrank a church's own content on their screen.
    apexSuperAdmin();
    data.courses = [{ id: 'own-1', title: 'Our Own Course', status: 'published', featured: true, levels: [] }];
    seedAdopted({ featured: true });
    await mount();

    const hero = received.courses.find((c: any) => c.featured);
    expect(hero.id).toBe('own-1');
    // The adopted course is still listed — it just loses the hero slot.
    expect(titles()).toContain('Foundations of Prayer');
    expect(received.courses.find((c: any) => c.id === 'lib-0').featured).toBe(false);
  });

  it('an adopted course keeps `featured` when the tenant features nothing of their own', async () => {
    apexSuperAdmin();
    data.courses = [{ id: 'own-1', title: 'Our Own Course', status: 'published', levels: [] }];
    seedAdopted({ featured: true });
    await mount();
    expect(received.courses.find((c: any) => c.id === 'lib-0').featured).toBe(true);
  });

  it('an unpublished OWN course is still filtered out', async () => {
    data.courses = [
      { id: 'own-1', title: 'Published', status: 'published', levels: [] },
      { id: 'own-2', title: 'Draft', status: 'draft', levels: [] },
    ];
    await mount();
    expect(titles()).toEqual(['Published']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The sweep half of the fix: the OTHER reads on this screen.
//
// :78 (authors) and :105 (categories) are FIELD-FILTERED reads, not paths — they
// are correct on the apex exactly as they are, and the library pools they merge
// with are read unconditionally, so an adopted course's author and category
// resolve for a super admin too. These pin that, so a future "consistency" sweep
// does not convert them to the write scope and re-scope a deliberately unscoped
// read.
// ─────────────────────────────────────────────────────────────────────────────
describe('CoursePage — author and category resolution for an adopted course', () => {
  beforeEach(() => {
    data.libraryAuthors = [{ id: 'lib-auth-1', name: 'Dr Platform Teacher', bio: 'Teaches.' }];
    data.libraryCategories = [{ id: 'lc-1', name: 'Discipleship' }];
  });

  it("resolves an adopted course's author from libraryAuthors on the apex", async () => {
    apexSuperAdmin();
    seedAdopted();
    await mount();

    expect(calls.paths).toContain('libraryAuthors');
    expect(received.authors.find((a: any) => a.id === 'lib-auth-1')?.name).toBe('Dr Platform Teacher');
  });

  it("resolves an adopted course's category from libraryCategories on the apex", async () => {
    apexSuperAdmin();
    seedAdopted();
    await mount();

    expect(calls.paths).toContain('libraryCategories');
    expect(received.categories).toContain('Discipleship');
  });

  it('merges tenant authors first, library authors after, without dropping either', async () => {
    data.authors = [{ id: 'a-1', name: 'Our Pastor' }];
    seedAdopted();
    await mount();
    expect(received.authors.map((a: any) => a.name)).toEqual(['Our Pastor', 'Dr Platform Teacher']);
  });

  it('de-duplicates category labels, tenant labels first', async () => {
    data.categories = [{ id: 'c-1', name: 'Discipleship' }];
    seedAdopted();
    await mount();
    // "All" is prepended by the screen; 'Discipleship' must appear exactly once.
    expect(received.categories.filter((c: string) => c === 'Discipleship')).toHaveLength(1);
    expect(received.categories[0]).toBe('All');
  });

  it('keeps the authors and categories reads FIELD-filtered on a subdomain', async () => {
    // Two where('tenantId') clauses — authors and categories — plus the one on
    // /courses. The library reads add none, by design.
    seedAdopted();
    await mount();
    expect(calls.wheres).toEqual(['tenantId', 'tenantId', 'tenantId']);
  });

  it('drops the tenantId filters entirely on the apex, on all three reads', async () => {
    apexSuperAdmin();
    seedAdopted();
    await mount();
    expect(calls.wheres).toEqual([]);
  });
});
