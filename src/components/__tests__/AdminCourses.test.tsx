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

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant-1' }));
vi.mock('../AdminCourseEditor', () => ({
  default: () => <div data-testid="course-editor" />,
}));

const tenantCtx = vi.hoisted(() => ({ tenantPlan: undefined as string | undefined }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => tenantCtx,
}));

let mockCourses: Array<{ id: string; title: string; author: string; status: string }> = [];
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: (...args: unknown[]) => args,
  where: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  deleteDoc: async () => {},
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (_q: unknown, onNext: (snap: unknown) => void) => {
    onNext({ docs: mockCourses.map((c) => ({ id: c.id, data: () => c })) });
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
