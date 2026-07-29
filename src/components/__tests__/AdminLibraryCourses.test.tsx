import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminLibraryCourses from '../AdminLibraryCourses';

/**
 * The super-admin library authoring screen.
 *
 * Two behaviours are pinned here, both of which are the OPPOSITE of the tenant
 * course screen next door (AdminCourses.test.tsx pins that one's maxCourses
 * enforcement):
 *
 *  1. NO plan cap. maxCourses limits how many courses a CHURCH may hold; the
 *     platform catalogue a super admin authors is unlimited. If someone later
 *     copies AdminCourses' cap in here, these tests fail.
 *
 *  2. The catalogue query is UNFILTERED — no where('tenantId', …). libraryCourses
 *     docs carry no tenantId and the read rule references no document field, so
 *     a tenant filter would match nothing and the screen would render empty.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../AdminCourseEditor', () => ({
  default: (props: { library?: boolean }) => (
    <div data-testid="course-editor" data-library={String(props.library)} />
  ),
}));

// Records every collection()/where() the screen asks for, so the "unfiltered"
// claim is asserted against the actual query, not the rendered output.
const calls = vi.hoisted(() => ({ collections: [] as string[], wheres: [] as string[] }));

let mockCourses: Array<{ id: string; title: string; author: string; status: string }> = [];
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => { calls.collections.push(name); return {}; },
  query: (...args: unknown[]) => args,
  where: (field: string) => { calls.wheres.push(field); return {}; },
  limit: () => ({}),
  doc: () => ({}),
  deleteDoc: async () => {},
  onSnapshot: (_q: unknown, onNext: (snap: unknown) => void) => {
    onNext({ docs: mockCourses.map((c) => ({ id: c.id, data: () => c })) });
    return () => {};
  },
}));

function makeCourses(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `lib-course-${i}`,
    title: `Library Course ${i}`,
    author: 'Platform Teacher',
    status: 'draft',
  }));
}

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminLibraryCourses />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function newCourseButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').trim().startsWith('New library course')
  );
  if (!button) throw new Error('No "New library course" button found');
  return button as HTMLButtonElement;
}

describe('AdminLibraryCourses', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockCourses = [];
    calls.collections = [];
    calls.wheres = [];
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  describe('no maxCourses cap', () => {
    it('allows a new library course with an empty catalogue', async () => {
      await mount();
      expect(newCourseButton().disabled).toBe(false);
    });

    it('still allows a new library course well past every plan cap', async () => {
      // 50 courses — far beyond plus (2), pro (5). A tenant screen would be
      // disabled here; the platform catalogue must not be.
      mockCourses = makeCourses(50);
      await mount();

      const button = newCourseButton();
      expect(button.disabled).toBe(false);
      expect(button.title ?? '').not.toMatch(/plan includes up to/i);

      await act(async () => { button.click(); });
      expect(container.querySelector('[data-testid="course-editor"]')).not.toBeNull();
    });

    it('shows no upgrade/limit messaging at any catalogue size', async () => {
      mockCourses = makeCourses(10);
      await mount();
      expect(container.textContent || '').not.toMatch(/upgrade to add more/i);
      expect(container.textContent || '').not.toMatch(/plan includes up to/i);
    });
  });

  describe('catalogue query shape', () => {
    it('reads libraryCourses, not courses', async () => {
      await mount();
      expect(calls.collections).toContain('libraryCourses');
      expect(calls.collections).not.toContain('courses');
    });

    it('issues NO tenantId filter — the query must be unfiltered', async () => {
      await mount();
      expect(calls.wheres).toEqual([]);
    });
  });

  it('opens the shared editor in library mode', async () => {
    await mount();
    await act(async () => { newCourseButton().click(); });
    const editor = container.querySelector('[data-testid="course-editor"]');
    expect(editor).not.toBeNull();
    expect(editor?.getAttribute('data-library')).toBe('true');
  });

  it('lists every authored course', async () => {
    mockCourses = makeCourses(3);
    await mount();
    for (const course of mockCourses) {
      expect(container.textContent).toContain(course.title);
    }
  });
});
