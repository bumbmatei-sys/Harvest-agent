import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import CoursesTab from '../CoursesTab';
import { mergeCoursesForMembers, isAtCourseLimit } from '../../utils/course-adoption';

/**
 * THE-140 — a course adopted from the library never reached the member app.
 *
 * The member course list read /courses and nothing else, so
 * tenants/{t}/adoptedCourses — the ONLY place an adoption exists, since adoption
 * stores a pointer rather than a copy — was invisible to it. The failure was
 * silent: no error, just a church that had adopted a course being rendered as a
 * church with no courses.
 *
 * These tests drive the component through a mocked Firestore so the two reads
 * with OPPOSITE scoping requirements can be asserted independently:
 *
 *   • /courses         — FIELD-FILTERED. A null scope is correct (super admin,
 *                        apex) and means "every tenant".
 *   • adoptedCourses   — a tenant-scoped PATH. A null scope CANNOT build it.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('next/image', () => ({
  default: (props: any) => <img alt={props.alt} src={typeof props.src === 'string' ? props.src : ''} />,
}));

const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
}));

// Every collection path the component reads, recorded so the adoption path can
// be asserted directly (and its ABSENCE asserted for a null scope).
const calls = vi.hoisted(() => ({ paths: [] as string[] }));

const data = vi.hoisted(() => ({
  courses: [] as any[],
  libraryCourses: [] as any[],
  adopted: [] as any[],
}));

function rowsFor(path: string): any[] {
  if (path === 'courses') return data.courses;
  if (path === 'libraryCourses') return data.libraryCourses;
  if (path.includes('adoptedCourses')) return data.adopted;
  return [];
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any, ...args: unknown[]) => ({ __path: col?.__path, args }),
  where: () => ({}),
  limit: () => ({}),
  getDocs: async (ref: any) => {
    const path = ref?.__path ?? '';
    calls.paths.push(path);
    const rows = rowsFor(path);
    const docs = rows.map((r) => ({ id: r.id, data: () => r }));
    return { docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
  },
}));

// The merge is asserted to COME FROM course-adoption rather than to merely
// produce the right answer — a second inline `[...own, ...adopted]` would give
// the same list today and diverge from the admin view the first time the
// featured rule changes, which is how these two screens disagreed originally.
// The real implementation still runs; only the call is observed.
vi.mock('../../utils/course-adoption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/course-adoption')>();
  return { ...actual, mergeCoursesForMembers: vi.fn(actual.mergeCoursesForMembers) };
});
const mergeSpy = vi.mocked(mergeCoursesForMembers);

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<CoursesTab />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const ownCourse = (over: Record<string, unknown> = {}) => ({
  id: 'own-1', title: 'Own Course', status: 'published', tenantId: 'tenant-1',
  featured: false, description: '', category: 'Faith', thumbnail: '',
  authorIds: [], levels: [], createdAt: '2026-01-02T00:00:00.000Z', ...over,
});

const libraryCourse = (over: Record<string, unknown> = {}) => ({
  id: 'lib-1', title: 'Library Course', status: 'published',
  featured: false, description: '', category: 'Discipleship', thumbnail: '',
  authorIds: [], levels: [], createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

const adoptionRecord = (over: Record<string, unknown> = {}) => ({
  id: 'lib-1', libraryCourseId: 'lib-1',
  adoptedAt: '2026-01-03T00:00:00.000Z', adoptedBy: 'admin-uid', ...over,
});

function titles(): string[] {
  return Array.from(container.querySelectorAll('h3')).map((h) => h.textContent ?? '');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  calls.paths = [];
  data.courses = [];
  data.libraryCourses = [];
  data.adopted = [];
  mergeSpy.mockClear();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('THE-140 — adopted library courses in the member app', () => {
  it('an adopted library course appears in the member course list', async () => {
    data.courses = [];
    data.libraryCourses = [libraryCourse({ title: 'Foundations of Prayer' })];
    data.adopted = [adoptionRecord()];

    await mount();

    expect(calls.paths).toContain('tenants/tenant-1/adoptedCourses');
    expect(titles()).toContain('Foundations of Prayer');
  });

  it("a tenant's own published course still appears", async () => {
    data.courses = [ownCourse({ title: 'Membership Class' })];

    await mount();

    expect(titles()).toContain('Membership Class');
  });

  it('an unpublished tenant course still does not appear', async () => {
    data.courses = [
      ownCourse({ id: 'own-1', title: 'Membership Class' }),
      ownCourse({ id: 'own-2', title: 'Half Written Draft', status: 'draft' }),
    ];

    await mount();

    expect(titles()).toContain('Membership Class');
    expect(titles()).not.toContain('Half Written Draft');
  });

  it('an adopted course whose library entry is unpublished does not appear', async () => {
    // The visibility rule for an adopted course is the LIBRARY course's own
    // status, via course-adoption's isPubliclyVisible(). The adoption record
    // carries no status to filter on.
    data.libraryCourses = [libraryCourse({ title: 'Unfinished Catalogue Draft', status: 'draft' })];
    data.adopted = [adoptionRecord()];

    await mount();

    expect(titles()).not.toContain('Unfinished Catalogue Draft');
  });

  it("an adopted course reaches members as the adopting church runs it", async () => {
    // The two tenant-owned flags are resolved HERE, where the member list is
    // composed, so CourseOverview's certificate affordance, LessonView's quiz
    // gate and verifyCourseCompletion all see the same values without a second
    // copy of the precedence rule. THE TENANT WINS IN BOTH DIRECTIONS, and
    // absent is not false.
    data.libraryCourses = [libraryCourse({ requireQuiz: true, issueCertificate: false })];
    data.adopted = [adoptionRecord({ requireQuiz: false, issueCertificate: true })];

    await mount();

    const adopted = mergeSpy.mock.calls[0][1];
    expect(adopted).toHaveLength(1);
    expect(adopted[0].requireQuiz).toBe(false);
    expect(adopted[0].issueCertificate).toBe(true);
  });

  it("an adopted course with no override keeps the library course's own flags", async () => {
    data.libraryCourses = [libraryCourse({ requireQuiz: true, issueCertificate: false })];
    data.adopted = [adoptionRecord()];

    await mount();

    const adopted = mergeSpy.mock.calls[0][1];
    expect(adopted[0].requireQuiz).toBe(true);
    expect(adopted[0].issueCertificate).toBe(false);
  });

  it('the member list and the admin count agree about how many courses exist', async () => {
    data.courses = [ownCourse({ id: 'own-1', title: 'Membership Class' })];
    data.libraryCourses = [
      libraryCourse({ id: 'lib-1', title: 'Foundations of Prayer' }),
      libraryCourse({ id: 'lib-2', title: 'Reading the Gospels' }),
    ];
    data.adopted = [
      adoptionRecord({ id: 'lib-1', libraryCourseId: 'lib-1' }),
      adoptionRecord({ id: 'lib-2', libraryCourseId: 'lib-2' }),
    ];

    await mount();

    // AdminCourses' count is `courses.length + adopted.length`, and it is the
    // same number the plan cap is charged for — a member list that shows fewer
    // means a church pays a slot for a course nobody can see.
    const adminCount = data.courses.length + data.adopted.length;
    expect(titles()).toHaveLength(adminCount);
    expect(isAtCourseLimit(data.courses.length, data.adopted.length, 3)).toBe(true);
  });

  it('the merge comes from course-adoption, not a second implementation', async () => {
    data.courses = [ownCourse({ featured: true })];
    data.libraryCourses = [libraryCourse({ featured: true })];
    data.adopted = [adoptionRecord()];

    await mount();

    expect(mergeSpy).toHaveBeenCalled();
    const [own, adopted] = mergeSpy.mock.calls[0];
    expect(own.map((c) => c.id)).toEqual(['own-1']);
    expect(adopted.map((c) => c.id)).toEqual(['lib-1']);
    // The rule the shared merge owns: the church's own featured course wins on
    // the church's own screen.
    const merged = mergeSpy.mock.results[0].value as { id: string; featured: boolean }[];
    expect(merged.find((c) => c.id === 'own-1')?.featured).toBe(true);
    expect(merged.find((c) => c.id === 'lib-1')?.featured).toBe(false);
  });

  it('a null tenant scope never builds an adoptedCourses path', async () => {
    // A regular user on the apex: no host scope, no user tenant, not a super
    // admin — so BOTH resolvers are null. tenants/{null}/adoptedCourses is not
    // a path; the read must be skipped, not attempted.
    scope.read = null;
    scope.write = null;
    data.courses = [ownCourse({ title: 'Membership Class' })];
    data.adopted = [adoptionRecord()];

    await mount();

    expect(calls.paths.some((p) => p.includes('adoptedCourses'))).toBe(false);
    expect(calls.paths.some((p) => p.includes('undefined') || p.includes('null'))).toBe(false);
    // The field-filtered /courses read is still correct while unscoped.
    expect(titles()).toContain('Membership Class');
  });

  it('a super admin on the apex reads the platform tenant\'s adoptions', async () => {
    // The read scope is null (correct — /courses is field-filtered and null
    // means every tenant), but the PATH scope is not: getWriteTenantScope()
    // resolves the platform tenant, exactly as AdminCourses' adoption listener
    // does. Using the read scope for the path skips the read entirely and the
    // adopted course silently disappears — no error, just an empty list.
    scope.read = null;
    scope.write = 'harvest';
    data.libraryCourses = [libraryCourse({ title: 'Foundations of Prayer' })];
    data.adopted = [adoptionRecord()];

    await mount();

    expect(calls.paths).toContain('tenants/harvest/adoptedCourses');
    expect(titles()).toContain('Foundations of Prayer');
  });

  it('no colour is hardcoded', () => {
    // THE-136: hardcoded colours on a list surface are what breaks desktop dark
    // mode. Every surface here must resolve through a theme token
    // (bg-surface-*, text-strong/muted/faint, border-line, text-gold).
    const sources = [
      readFileSync(join(process.cwd(), 'src/components/CoursesTab.tsx'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/utils/member-courses.ts'), 'utf8'),
    ];
    // The one documented exception: a scrim over cover ART, not over a themed
    // surface — it must stay opaque-dark in both themes or the category label
    // becomes unreadable on a light photo.
    const IMAGE_SCRIM = 'bg-black/60 backdrop-blur-md text-white';
    const PALETTE = 'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

    for (const raw of sources) {
      // Comments are stripped first: they carry PR references like `#249`,
      // which are not colours and never reach a stylesheet.
      const source = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*)/.test(line))
        .join('\n')
        .split(IMAGE_SCRIM)
        .join('');
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
      expect(source).not.toMatch(new RegExp(`\\b(bg|text|border|from|to|via)-(${PALETTE})-\\d{2,3}\\b`));
      expect(source).not.toMatch(/\b(bg|text|border)-(white|black)\b/);
    }
  });
});
