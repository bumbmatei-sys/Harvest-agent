import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoursePreview } from '../CoursePreview';
import type { Author, LibraryCourse } from '../../../types/course.types';

/**
 * The read-only catalogue preview.
 *
 * The load-bearing property is the one in the name: it writes NOTHING. An admin
 * deciding whether to spend one of 2 or 5 plan slots must be able to look at a
 * course without leaving a trace in their members' data.
 *
 * That guarantee is STRUCTURAL here rather than a flag: the component is handed
 * every piece of data it renders and imports no Firestore handle and no auth
 * handle, so there is nothing in it that COULD write. `../../../firebase` and
 * `firebase/firestore` are both mocked to proxies that RECORD every property
 * access — if the component ever grows an import of either, the read-only test
 * below fails by name rather than the screen silently starting to write.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Any use of the Firestore SDK or the app's firebase handles is RECORDED rather
// than thrown, so the failure lands on the named assertion below instead of
// blowing up at import time (the module loader itself probes `then`).
// `spyModule` lives inside vi.hoisted because vi.mock factories are hoisted
// above ordinary top-level consts.
const firestoreCalls = vi.hoisted(() => {
  const used: string[] = [];
  return {
    used,
    spyModule: (label: string) => new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop === 'symbol' || prop === 'then' || prop === '__esModule') return undefined;
        used.push(`${label}.${prop}`);
        return () => undefined;
      },
    }),
  };
});
vi.mock('../../../firebase', () => firestoreCalls.spyModule('firebase'));
vi.mock('firebase/firestore', () => firestoreCalls.spyModule('firestore'));

// The real player needs a DOM YouTube iframe API; the embed URL is what matters.
vi.mock('react-player/youtube', () => ({
  default: ({ url }: { url: string }) => <div data-testid="react-player" data-url={url} />,
}));

// Passthrough spy over the REAL sanitizer, so the formatting assertions run
// against the real implementation while "the description goes through
// sanitizeHtml at all" stays directly assertable. DOMPurify's own stripping is
// not re-tested here — it is exercised by sanitize's own suite, and its
// behaviour under happy-dom differs from a browser's.
const sanitizeCalls = vi.hoisted(() => ({ html: [] as string[] }));
vi.mock('../../../utils/sanitize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/sanitize')>();
  return {
    ...actual,
    sanitizeHtml: (html: string) => { sanitizeCalls.html.push(html); return actual.sanitizeHtml(html); },
  };
});

const AUTHORS: Author[] = [
  { id: 'lib-auth-1', name: 'Dr Platform Teacher', title: 'Theologian', bio: 'Has taught for thirty years.' },
  { id: 'tenant-auth', name: 'Local Pastor' },
];

function makeCourse(over: Partial<LibraryCourse> = {}): LibraryCourse {
  return {
    id: 'lib-0',
    title: 'Foundations of Prayer',
    description: '<p>A <strong>deep</strong> study.</p><p>Second paragraph.</p>',
    category: 'Discipleship',
    thumbnail: '',
    featured: false,
    status: 'published',
    authorIds: ['lib-auth-1'],
    levels: [{
      id: 'lv1', title: 'Level 1', sections: [{
        id: 's1', title: 'Beginnings', lessons: [
          { id: 'l1', title: 'Why We Pray', duration: '10 min', authorId: 'lib-auth-1', summary: 'Opening.', youtubeId: 'abc12345678' },
          { id: 'l2', title: 'How We Pray', duration: '12 min', authorId: 'lib-auth-1', summary: '', youtubeUrl: 'https://youtu.be/xyz98765432' },
        ],
      }],
    }],
    ...over,
  } as LibraryCourse;
}

let container: HTMLDivElement;
let root: Root;
const onAdopt = vi.fn();
const onClose = vi.fn();
const onSetOverride = vi.fn();

function render(props: Partial<React.ComponentProps<typeof CoursePreview>> = {}) {
  act(() => {
    root = createRoot(container);
    root.render(
      <CoursePreview
        course={makeCourse()}
        authors={AUTHORS}
        onClose={onClose}
        onAdopt={onAdopt}
        isAdopted={false}
        {...props}
      />,
    );
  });
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim().includes(text),
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  firestoreCalls.used.length = 0;
  onAdopt.mockClear();
  onClose.mockClear();
  onSetOverride.mockClear();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

describe('CoursePreview — what an admin sees before adopting', () => {
  it('renders the FULL description with its formatting intact', () => {
    // sanitizeHtml, not stripHtml: this is a detail view, so the rich-text
    // formatting is wanted. The two-line catalogue card is where a flattened
    // summary belongs.
    render();
    const desc = container.querySelector('[data-testid="preview-description"]')!;
    expect(desc.textContent).toContain('A deep study.');
    expect(desc.textContent).toContain('Second paragraph.');
    expect(desc.querySelector('strong')).not.toBeNull();
    expect(desc.innerHTML).toContain('<p>');
  });

  it('routes the description through sanitizeHtml — never raw catalogue HTML', () => {
    // The author is a super admin, but rendering unsanitised HTML with
    // dangerouslySetInnerHTML would be a needless XSS surface regardless. Same
    // call CourseOverview makes; the sanitizer's own stripping is its suite's job.
    render({ course: makeCourse({ description: '<p>Safe</p><script>alert(1)</script>' }) });
    expect(sanitizeCalls.html).toContain('<p>Safe</p><script>alert(1)</script>');
  });

  it('uses sanitizeHtml, NOT stripHtml — the detail view keeps its formatting', () => {
    render();
    const desc = container.querySelector('[data-testid="preview-description"]')!;
    // stripHtml would have flattened this to plain text with no elements left.
    expect(desc.querySelector('strong')).not.toBeNull();
  });

  it('renders the author name, title AND bio from the pool it is given', () => {
    render();
    expect(container.textContent).toContain('Dr Platform Teacher');
    expect(container.textContent).toContain('Theologian');
    expect(container.textContent).toContain('Has taught for thirty years.');
  });

  it('does not render authors the course does not claim', () => {
    render();
    expect(container.textContent).not.toContain('Local Pastor');
  });

  it('renders the category and lesson count', () => {
    render();
    expect(container.textContent).toContain('Discipleship');
    expect(container.textContent).toContain('2 lessons');
  });

  it('renders the level/section structure and every lesson title', () => {
    render();
    expect(container.textContent).toContain('Level 1');
    expect(container.textContent).toContain('Beginnings');
    expect(container.textContent).toContain('Why We Pray');
    expect(container.textContent).toContain('How We Pray');
  });

  it('plays the video for a lesson, built from youtubeId', () => {
    render();
    // Collapsed until asked — N players mounted at once would be wasteful.
    expect(container.querySelector('[data-testid="react-player"]')).toBeNull();

    act(() => { buttonWithText('Why We Pray')!.click(); });
    const player = container.querySelector('[data-testid="react-player"]')!;
    expect(player.getAttribute('data-url')).toBe('https://www.youtube.com/watch?v=abc12345678');
  });

  it('plays the video for a lesson that carries a youtubeUrl instead', () => {
    // Same resolution LessonView uses — the existing embed, not a second one.
    render();
    act(() => { buttonWithText('How We Pray')!.click(); });
    expect(container.querySelector('[data-testid="react-player"]')!.getAttribute('data-url'))
      .toBe('https://youtu.be/xyz98765432');
  });

  it('says so plainly when a lesson has no video', () => {
    render({ course: makeCourse({
      levels: [{ id: 'lv1', title: 'L', sections: [{ id: 's', title: 'S', lessons: [
        { id: 'l1', title: 'Reading Only', duration: '5', authorId: 'lib-auth-1', summary: '' },
      ] }] }],
    }) });
    act(() => { buttonWithText('Reading Only')!.click(); });
    expect(container.textContent).toContain('No video for this lesson');
    expect(container.querySelector('[data-testid="react-player"]')).toBeNull();
  });

  it('tolerates a course with no lessons rather than rendering an empty shell', () => {
    render({ course: makeCourse({ levels: [] }) });
    expect(container.textContent).toContain('no lessons yet');
  });

  it('tolerates a missing description', () => {
    render({ course: makeCourse({ description: '' }) });
    expect(container.textContent).toContain('No description available');
  });
});

describe('CoursePreview — strictly read-only', () => {
  it('PERFORMS NO FIRESTORE WRITES — it cannot even reach Firestore', () => {
    // THE test that matters most. Removing the read-only guard — giving this
    // component a db/auth handle so it could record progress — fails here.
    render();
    // Exercise every interaction the screen offers: open both lessons (which
    // mounts their players), then collapse and re-expand the level.
    act(() => { buttonWithText('Why We Pray')!.click(); });
    act(() => { buttonWithText('How We Pray')!.click(); });
    const levelHeader = Array.from(container.querySelectorAll('div'))
      .find((d) => (d.textContent || '').includes('2 lessons') && d.className.includes('cursor-pointer'))!;
    act(() => { levelHeader.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    act(() => { levelHeader.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(firestoreCalls.used).toEqual([]);
  });

  it('offers no progress affordance at all', () => {
    // No "Mark complete", no quiz, no notepad, no certificate. Every one of
    // those is a write into users/{uid}.
    render();
    act(() => { buttonWithText('Why We Pray')!.click(); });
    const text = container.textContent || '';
    expect(text).not.toMatch(/mark complete/i);
    expect(text).not.toMatch(/download certificate/i);
    expect(text).not.toMatch(/save note/i);
    expect(text).not.toMatch(/quiz/i);
  });

  it('tells the admin nothing is being recorded', () => {
    render();
    expect(container.textContent).toMatch(/nothing here is recorded against your account/i);
  });

  it('offers no Edit control for the platform-owned content', () => {
    // #249 removed Edit deliberately: the tenant does not own this content.
    render({ isAdopted: true, adoption: { id: 'lib-0', libraryCourseId: 'lib-0', adoptedAt: '', adoptedBy: '' }, onSetOverride });
    expect(container.querySelector('[title="Edit"]')).toBeNull();
    expect(buttonWithText('Edit')).toBeUndefined();
  });
});

describe('CoursePreview — adopting from the preview', () => {
  it('offers Adopt, and hands the caller the same course object the card would', () => {
    render();
    const adopt = buttonWithText('Adopt')!;
    expect(adopt).toBeDefined();
    act(() => { adopt.click(); });
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onAdopt.mock.calls[0][0].id).toBe('lib-0');
  });

  it('shows Adopted instead of the button once held', () => {
    render({ isAdopted: true });
    expect(container.textContent).toContain('Adopted');
    expect(buttonWithText('Adopt')).toBeUndefined();
  });

  it('disables Adopt at the plan cap and explains why', () => {
    render({ adoptBlocked: true, blockedReason: 'Your plan includes up to 2 courses.' });
    const adopt = buttonWithText('Adopt')!;
    expect(adopt.disabled).toBe(true);
    expect(adopt.title).toMatch(/up to 2 courses/);
  });

  it('disables Adopt while a request is in flight', () => {
    render({ adoptBusy: true });
    expect(buttonWithText('Adopting…')!.disabled).toBe(true);
  });

  it('closes back to the library', () => {
    render();
    act(() => { buttonWithText('Back to the library')!.click(); });
    expect(onClose).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two tenant-owned toggles. Everything else on this screen is read-only.
// ─────────────────────────────────────────────────────────────────────────────
describe('CoursePreview — the church\'s own settings', () => {
  const adoption = (over: any = {}) => ({
    id: 'lib-0', libraryCourseId: 'lib-0', adoptedAt: '', adoptedBy: '', ...over,
  });
  const withQuiz = makeCourse({
    levels: [{ id: 'lv', title: 'L', sections: [{ id: 's', title: 'S', lessons: [
      { id: 'l1', title: 'Q Lesson', duration: '5', authorId: 'lib-auth-1', summary: '',
        quiz: [{ id: 'q', q: 'Q?', options: [{ id: 'a', text: 'A', correct: true }] }] },
    ] }] }],
  });

  function toggle(label: string): HTMLButtonElement {
    return container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  }

  it('are not offered at all for a course that has not been adopted', () => {
    render();
    expect(container.textContent).not.toMatch(/your church's settings/i);
  });

  it('shows them once adopted, marked as the church\'s own choice', () => {
    render({ isAdopted: true, adoption: adoption(), onSetOverride, course: withQuiz });
    expect(container.textContent).toMatch(/your church.s settings/i);
    expect(container.textContent).toMatch(/do not affect any other church/i);
  });

  it('reflects the PLATFORM value when the church has not chosen', () => {
    render({
      isAdopted: true, adoption: adoption(), onSetOverride,
      course: makeCourse({ issueCertificate: true }),
    });
    expect(toggle('Issue a certificate').getAttribute('aria-checked')).toBe('true');
  });

  it('reflects the CHURCH\'s value once they have, overriding the platform', () => {
    render({
      isAdopted: true, adoption: adoption({ issueCertificate: false }), onSetOverride,
      course: makeCourse({ issueCertificate: true }),
    });
    expect(toggle('Issue a certificate').getAttribute('aria-checked')).toBe('false');
  });

  it('a church TRUE shows through a platform FALSE', () => {
    render({
      isAdopted: true, adoption: adoption({ issueCertificate: true }), onSetOverride,
      course: makeCourse({ issueCertificate: false }),
    });
    expect(toggle('Issue a certificate').getAttribute('aria-checked')).toBe('true');
  });

  it('reports the new value to the caller — it does not write itself', () => {
    render({
      isAdopted: true, adoption: adoption({ issueCertificate: false }), onSetOverride,
      course: makeCourse({ issueCertificate: false }),
    });
    act(() => { toggle('Issue a certificate').click(); });
    expect(onSetOverride).toHaveBeenCalledWith('issueCertificate', true);
    expect(firestoreCalls.used).toEqual([]);
  });

  it('toggles requireQuiz on a course that HAS a quiz', () => {
    render({ isAdopted: true, adoption: adoption(), onSetOverride, course: withQuiz });
    const t = toggle('Require the quiz');
    expect(t.disabled).toBe(false);
    act(() => { t.click(); });
    expect(onSetOverride).toHaveBeenCalledWith('requireQuiz', true);
  });

  it('DISABLES requireQuiz on a course with no quizzes, and says why', () => {
    // The route refuses this too (409) — the route is the authority; the UI just
    // does not offer a setting it knows would do nothing.
    render({ isAdopted: true, adoption: adoption(), onSetOverride, course: makeCourse() });
    const t = toggle('Require the quiz');
    expect(t.disabled).toBe(true);
    expect(t.title).toMatch(/no quizzes/i);
    expect(container.textContent).toMatch(/would have no effect/i);

    act(() => { t.click(); });
    expect(onSetOverride).not.toHaveBeenCalled();
  });

  it('still lets a church turn requireQuiz OFF on a quiz-less course', () => {
    // Turning it off is always meaningful — it clears a setting that is there.
    render({
      isAdopted: true, adoption: adoption({ requireQuiz: true }), onSetOverride,
      course: makeCourse(),
    });
    const t = toggle('Require the quiz');
    expect(t.disabled).toBe(false);
    act(() => { t.click(); });
    expect(onSetOverride).toHaveBeenCalledWith('requireQuiz', false);
  });

  it('disables both while a save is in flight', () => {
    render({ isAdopted: true, adoption: adoption(), onSetOverride, course: withQuiz, overrideBusy: true });
    expect(toggle('Require the quiz').disabled).toBe(true);
    expect(toggle('Issue a certificate').disabled).toBe(true);
  });

  it('offers ONLY those two — nothing else about the course is editable', () => {
    render({ isAdopted: true, adoption: adoption(), onSetOverride, course: withQuiz });
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches.map((s) => s.getAttribute('aria-label')).sort())
      .toEqual(['Issue a certificate', 'Require the quiz']);
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });
});
