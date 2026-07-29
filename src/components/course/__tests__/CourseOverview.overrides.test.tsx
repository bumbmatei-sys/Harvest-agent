import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourseOverview } from '../CourseOverview';
import type { Author, Course, Lesson } from '../../../types/course.types';

/**
 * The member-facing "Download certificate" affordance, under a per-tenant
 * override.
 *
 * The button must follow the RESOLVED value — the adopting church's choice —
 * not the library course's raw one, for the same reason it recomputes
 * completion at all: a learner must never be shown an action the server would
 * refuse, nor be denied one the server would grant. Both sides resolve through
 * the same helper, so they cannot disagree.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'tok' } } }));
vi.mock('../../../utils/share-url', () => ({ usePublicShareUrl: () => 'https://example.test/c/1' }));
vi.mock('../../ShareButton', () => ({ default: () => <div /> }));

const lesson = (id: string, withQuiz = false): Lesson => ({
  id, title: `Lesson ${id}`, duration: '10', authorId: 'a-1', summary: '',
  ...(withQuiz ? { quiz: [{ id: `${id}-q`, q: 'Q?', options: [{ id: 'o', text: 'A', correct: true }] }] } : {}),
});

function makeCourse(over: Partial<Course> = {}): Course {
  return {
    id: 'lib-0', featured: false, title: 'Foundations of Prayer', description: 'About.',
    category: 'Discipleship', thumbnail: '', authorIds: ['a-1'],
    levels: [{ id: 'lv', title: 'L', sections: [{ id: 's', title: 'S', lessons: [lesson('l1'), lesson('l2', true)] }] }],
    ...over,
  };
}

const AUTHORS: Author[] = [{ id: 'a-1', name: 'Dr Platform Teacher' }];
const ALL_DONE = new Set(['l1', 'l2']);
const PASSED = { l2: { score: 1, total: 1, passed: true, answeredAt: 'x' } };
const FAILED = { l2: { score: 0, total: 1, passed: false, answeredAt: 'x' } };

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<React.ComponentProps<typeof CourseOverview>> = {}) {
  act(() => {
    root = createRoot(container);
    root.render(
      <CourseOverview
        course={makeCourse()}
        authors={AUTHORS}
        onBack={() => {}}
        onStartLesson={() => {}}
        completed={ALL_DONE}
        quizAttempts={PASSED as any}
        {...props}
      />,
    );
  });
}

function downloadButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent || '').includes('Download certificate'),
  ) as HTMLButtonElement | undefined;
}

const adoption = (over: any = {}) => ({ requireQuiz: undefined, issueCertificate: undefined, ...over });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

describe('CourseOverview — the Download button follows the RESOLVED value', () => {
  it('SHOWS it when the platform says false but the church set true', () => {
    // Reverting this component to read course.issueCertificate raw makes this
    // fail: the learner would be denied a certificate their church grants.
    render({
      course: makeCourse({ issueCertificate: false }),
      adoption: adoption({ issueCertificate: true }),
    });
    expect(downloadButton()).toBeDefined();
  });

  it('HIDES it when the platform says true but the church set false', () => {
    render({
      course: makeCourse({ issueCertificate: true }),
      adoption: adoption({ issueCertificate: false }),
    });
    expect(downloadButton()).toBeUndefined();
    // ...and the ordinary CTA is shown instead, not a dead screen.
    expect(container.textContent).toMatch(/start course|continue/i);
  });

  it('falls back to the platform value when the church has not chosen', () => {
    render({ course: makeCourse({ issueCertificate: true }), adoption: adoption() });
    expect(downloadButton()).toBeDefined();

    act(() => { root.unmount(); });
    render({ course: makeCourse({ issueCertificate: false }), adoption: adoption() });
    expect(downloadButton()).toBeUndefined();
  });

  it('behaves exactly as before for a course with no adoption record', () => {
    render({ course: makeCourse({ issueCertificate: true }), adoption: null });
    expect(downloadButton()).toBeDefined();

    act(() => { root.unmount(); });
    render({ course: makeCourse({ issueCertificate: true }) }); // prop omitted entirely
    expect(downloadButton()).toBeDefined();
  });

  it('still requires genuine completion — an override is not a bypass', () => {
    render({
      course: makeCourse({ issueCertificate: false }),
      adoption: adoption({ issueCertificate: true }),
      completed: new Set(['l1']), // l2 outstanding
    });
    expect(downloadButton()).toBeUndefined();
  });

  describe('a requireQuiz override moves the completion bar too', () => {
    it("hides the button when the church requires a quiz the learner failed", () => {
      // The platform left requireQuiz false; the church turned it on. The bar the
      // client shows must be the bar the server will apply.
      render({
        course: makeCourse({ issueCertificate: true, requireQuiz: false }),
        adoption: adoption({ requireQuiz: true }),
        quizAttempts: FAILED as any,
      });
      expect(downloadButton()).toBeUndefined();
    });

    it('shows it once that quiz is passed', () => {
      render({
        course: makeCourse({ issueCertificate: true, requireQuiz: false }),
        adoption: adoption({ requireQuiz: true }),
        quizAttempts: PASSED as any,
      });
      expect(downloadButton()).toBeDefined();
    });

    it('shows it when the church turned OFF a quiz the platform required', () => {
      render({
        course: makeCourse({ issueCertificate: true, requireQuiz: true }),
        adoption: adoption({ requireQuiz: false }),
        quizAttempts: FAILED as any,
      });
      expect(downloadButton()).toBeDefined();
    });
  });

  it('never alters the platform content it renders', () => {
    render({
      course: makeCourse({ issueCertificate: false }),
      adoption: adoption({ issueCertificate: true, requireQuiz: true }),
    });
    expect(container.textContent).toContain('Foundations of Prayer');
    expect(container.textContent).toContain('Discipleship');
    expect(container.textContent).toContain('Dr Platform Teacher');
  });
});
