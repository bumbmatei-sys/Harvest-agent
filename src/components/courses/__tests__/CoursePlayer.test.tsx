import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoursePlayer, type CoursePlayerProps } from '@/components/courses/CoursePlayer';
import { CourseLanding } from '@/components/courses/CourseLanding';
import { emptyLesson } from '@/lib/courses/lessons';
import type { ProductCourse, ProductLesson } from '@/types/course-product.types';
import type { Lesson } from '@/types/course.types';
import { all, byName, click, mount, need, text, type as typeInto, unmount } from '@/components/email/__tests__/dom';

vi.mock('react-player/youtube', () => ({
  default: ({ url }: { url: string }) => <div data-testid="react-player" data-url={url} />,
}));
vi.mock('@/firebase', () => ({ auth: { currentUser: null }, db: {} }));
// DOMPurify does not behave under happy-dom (it keeps <script> and drops <p>), and
// the sanitiser has its own suite. What matters here is that every body and
// description is ROUTED through it, which a recording stand-in proves.
const sanitize = vi.hoisted(() => vi.fn((html: string) => html));
vi.mock('@/utils/sanitize', () => ({ sanitizeHtml: sanitize, stripHtml: (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }));

afterEach(unmount);

const textLesson = (id: string, title: string, body: string): Lesson =>
  ({ ...emptyLesson('text'), id, title, body }) as Lesson;

const COURSE: ProductCourse & { id: string } = {
  id: 'c1',
  title: 'Prayer basics',
  description: '',
  category: '',
  thumbnail: '',
  featured: false,
  authorIds: [],
  author: 'Pastor Ana',
  issueCertificate: true,
  requireQuiz: false,
  status: 'published',
  levels: [{
    id: 'lv', title: 'Course',
    sections: [
      { id: 's1', title: 'Start here', lessons: [textLesson('a', 'Why we pray', '<h2>Why</h2><p>Because <strong>He listens</strong>.</p>')] },
      { id: 's2', title: 'Week one', lessons: [
        textLesson('b', 'Morning prayer', '<p>Begin the day.</p>'),
        { ...emptyLesson('video'), id: 'c', title: 'Watch: evening prayer', youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } as Lesson,
      ] },
    ],
  }],
};

function player(over: Partial<CoursePlayerProps> = {}) {
  const props = {
    course: COURSE,
    lessonId: 'a',
    completed: new Set<string>(),
    onSelectLesson: vi.fn(),
    onToggleComplete: vi.fn(),
    onQuizSubmit: vi.fn(),
    onSaveNote: vi.fn(),
    onClose: vi.fn(),
    ...over,
  } satisfies CoursePlayerProps;
  return { ui: <CoursePlayer {...props} />, props };
}

const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);

describe('CoursePlayer — a text lesson', () => {
  it('reads as a centred column: title, headings and bold from the body, and no video player', async () => {
    await mount(player().ui);
    const column = need(q('[data-reading-column]'), 'column');
    expect(column.getAttribute('data-lesson-kind')).toBe('text');
    expect(need(q('[data-lesson-title]'), 'title').textContent).toBe('Why we pray');
    expect(column.querySelector('h2')?.textContent).toBe('Why');
    expect(column.querySelector('strong')?.textContent).toBe('He listens');
    expect(q('[data-testid="react-player"]')).toBeNull();
    expect(q('[data-player-crumb]')?.textContent).toBe('Start here · Lesson 1 of 1');
  });

  it('renders only what the sanitiser returns for a lesson body, never the raw HTML', async () => {
    const raw = '<p onclick="steal()">hi</p><script>window.__pwn=1</script>';
    const evil = textLesson('a', 'Why', raw);
    const course = { ...COURSE, levels: [{ id: 'lv', title: 'C', sections: [{ id: 's', title: 'S', lessons: [evil] }] }] };
    sanitize.mockClear();
    sanitize.mockReturnValueOnce('<p>clean</p>');
    await mount(player({ course }).ui);
    expect(sanitize).toHaveBeenCalledWith(raw);
    const html = need(q('[data-lesson-body]'), 'body').innerHTML;
    expect(html).toContain('clean');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
  });

  it('says so, rather than showing a blank page, when a lesson has no content', async () => {
    const empty = textLesson('a', 'Empty', '<p></p>');
    const course = { ...COURSE, levels: [{ id: 'lv', title: 'C', sections: [{ id: 's', title: 'S', lessons: [empty] }] }] };
    await mount(player({ course }).ui);
    expect(q('[data-lesson-blank]')).not.toBeNull();
  });
});

describe('CoursePlayer — a video lesson', () => {
  it('puts the video above the reading column', async () => {
    await mount(player({ lessonId: 'c' }).ui);
    expect(need(q('[data-testid="react-player"]'), 'player').getAttribute('data-url')).toContain('dQw4w9WgXcQ');
    expect(need(q('[data-reading-column]'), 'column').getAttribute('data-lesson-kind')).toBe('video');
  });
});

describe('CoursePlayer — legacy lessons (text in summary and outline)', () => {
  const legacyLesson = (over: Record<string, unknown> = {}) =>
    ({ id: 'L', title: 'Old lesson', duration: '', authorId: '', summary: '', ...over }) as unknown as Lesson;
  const only = (lesson: Lesson) => ({
    ...COURSE, levels: [{ id: 'lv', title: 'C', sections: [{ id: 's', title: 'S', lessons: [lesson] }] }],
  });

  it('shows the summary and outline of a legacy text lesson instead of "no content yet"', async () => {
    const lesson = legacyLesson({ summary: 'Grace is a gift.', outline: [{ id: 'o', title: 'Point one', text: 'Pray daily.' }] });
    await mount(player({ course: only(lesson), lessonId: 'L' }).ui);
    const body = need(q('[data-lesson-body]'), 'legacy body');
    expect(body.textContent).toContain('Grace is a gift.');
    expect(body.querySelector('h3')?.textContent).toBe('Point one');
    expect(body.textContent).toContain('Pray daily.');
    expect(q('[data-lesson-blank]')).toBeNull();
  });

  it('shows notes under the video for a legacy lesson that has both', async () => {
    const lesson = legacyLesson({ youtubeId: 'dQw4w9WgXcQ', summary: 'Watch, then reflect.' });
    await mount(player({ course: only(lesson), lessonId: 'L' }).ui);
    const column = need(q('[data-reading-column]'), 'column');
    expect(column.getAttribute('data-lesson-kind')).toBe('video-text');
    expect(need(q('[data-testid="react-player"]'), 'video').getAttribute('data-url')).toContain('dQw4w9WgXcQ');
    expect(need(q('[data-lesson-body]'), 'notes').textContent).toBe('Watch, then reflect.');
  });

  it('shows the body under the video for an untyped lesson that has both', async () => {
    const lesson = legacyLesson({ youtubeId: 'dQw4w9WgXcQ', body: '<p>Body notes</p>' });
    await mount(player({ course: only(lesson), lessonId: 'L' }).ui);
    expect(q('[data-testid="react-player"]')).not.toBeNull();
    expect(q('[data-lesson-body]')?.textContent).toBe('Body notes');
  });

  it('escapes legacy text and still routes it through the sanitiser', async () => {
    sanitize.mockClear();
    const lesson = legacyLesson({ summary: '<img src=x onerror=steal()>' });
    await mount(player({ course: only(lesson), lessonId: 'L' }).ui);
    expect(sanitize).toHaveBeenCalledWith('<p>&lt;img src=x onerror=steal()&gt;</p>');
    expect(q('[data-lesson-body] img')).toBeNull();
  });

  it('still says "no content yet" for a legacy lesson with nothing written', async () => {
    await mount(player({ course: only(legacyLesson()), lessonId: 'L' }).ui);
    expect(q('[data-lesson-blank]')).not.toBeNull();
  });

  it('a video-text lesson shows its video and its body', async () => {
    const lesson = { ...emptyLesson('video-text'), id: 'L', title: 'Both', youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', body: '<p>Notes here</p>' } as Lesson;
    await mount(player({ course: only(lesson), lessonId: 'L' }).ui);
    expect(q('[data-testid="react-player"]')).not.toBeNull();
    expect(q('[data-lesson-body]')?.textContent).toBe('Notes here');
  });
});

describe('CoursePlayer — the rail', () => {
  it('numbers the sections, counts progress, and offers Continue on the first unfinished lesson', async () => {
    await mount(player({ lessonId: 'b', completed: new Set(['a']) }).ui);
    const sections = all('[data-rail-section]');
    expect(sections.map((s) => s.getAttribute('data-rail-section'))).toEqual(['s1', 's2']);
    expect(sections[0].textContent).toContain('1 of 1 done');
    expect(sections[1].textContent).toContain('0 of 2 done');
    expect(need(q('[data-rail-progress]'), 'progress').textContent).toContain('1 of 3 lessons done');
    expect(need(q('[data-rail-progress]'), 'progress').textContent).toContain('33%');
    expect(need(q('[data-continue]'), 'continue').textContent).toContain('Morning prayer');
    expect(need(q('[data-rail-lesson="b"]'), 'row').getAttribute('aria-current')).toBe('true');
    expect(need(q('[data-rail-lesson="a"]'), 'done row').textContent).toContain('(done)');
  });

  it('selects a lesson from the rail and from Continue', async () => {
    const { ui, props } = player({ completed: new Set(['a']) });
    await mount(ui);
    await click(need(q('[data-rail-lesson="c"]'), 'row'));
    expect(props.onSelectLesson).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c' }));
    await click(need(q('[data-continue]'), 'continue'));
    expect(props.onSelectLesson).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('has Lessons and Notes tabs and no Chats section or Chat button', async () => {
    await mount(player().ui);
    expect(all('[data-rail-tab]').map((t) => t.getAttribute('data-rail-tab'))).toEqual(['lessons', 'notes']);
    expect(q('[data-rail-tab="chats"]')).toBeNull();
    expect(q('[data-chats-empty]')).toBeNull();
    expect(q('button[title="Chats are coming soon"]')).toBeNull();
    expect(text()).not.toMatch(/\bChats?\b/);
  });

  it('puts a New note button at the top of the Notes sidebar, before the notes themselves', async () => {
    await mount(player({ lessonNotes: { b: 'Remember to pray at dawn' } }).ui);
    await click(need(q('[data-rail-tab="notes"]'), 'notes'));
    const panel = need(q('[data-notes-panel]'), 'notes panel');
    const button = need(panel.querySelector<HTMLElement>('[data-new-note]'), 'new note');
    expect(button.textContent).toContain('New note');
    expect(panel.firstElementChild).toBe(button);
    expect(q('[data-notes-sheet]')).toBeNull();
    await click(button);
    expect(q('[data-notes-sheet]')).not.toBeNull();
  });

  it('lists the lessons that have notes under Notes, and says so when there are none', async () => {
    await mount(player().ui);
    await click(need(q('[data-rail-tab="notes"]'), 'notes'));
    expect(q('[data-notes-empty]')).not.toBeNull();
    await unmount();
    await mount(player({ lessonNotes: { b: 'Remember to pray at dawn' } }).ui);
    await click(need(q('[data-rail-tab="notes"]'), 'notes'));
    expect(need(q('[data-note-item="b"]'), 'note').textContent).toContain('Remember to pray at dawn');
  });
});

describe('CoursePlayer — moving through the course', () => {
  it('"Mark done and next" completes this lesson and opens the next one', async () => {
    const { ui, props } = player();
    await mount(ui);
    await click(need(q('[data-mark-next]'), 'mark'));
    expect(props.onToggleComplete).toHaveBeenCalledWith('a');
    expect(props.onSelectLesson).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('never un-completes a lesson that is already done when moving on', async () => {
    const { ui, props } = player({ completed: new Set(['a']) });
    await mount(ui);
    await click(need(q('[data-mark-next]'), 'mark'));
    expect(props.onToggleComplete).not.toHaveBeenCalled();
    expect(props.onSelectLesson).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('Previous steps back and is absent on the first lesson; Done toggles', async () => {
    const first = player();
    await mount(first.ui);
    expect(q('[data-previous]')).toBeNull();
    await click(need(q('[data-done-toggle]'), 'done'));
    expect(first.props.onToggleComplete).toHaveBeenCalledWith('a');
    await unmount();
    const second = player({ lessonId: 'b' });
    await mount(second.ui);
    await click(need(q('[data-previous]'), 'previous'));
    expect(second.props.onSelectLesson).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('the last lesson finishes and leaves instead of offering a next', async () => {
    const { ui, props } = player({ lessonId: 'c' });
    await mount(ui);
    expect(need(q('[data-mark-next]'), 'mark').textContent).toContain('Mark done and finish');
    await click(need(q('[data-mark-next]'), 'mark'));
    expect(props.onToggleComplete).toHaveBeenCalledWith('c');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('holds a lesson back until its quiz is passed when the course requires it', async () => {
    const quizzed = {
      ...textLesson('a', 'Quizzed', '<p>Read.</p>'),
      quiz: [{ id: 'q1', q: 'Who listens?', options: [{ id: 'o1', text: 'He does', correct: true }, { id: 'o2', text: 'No one', correct: false }] }],
    } as Lesson;
    const course = { ...COURSE, requireQuiz: true, levels: [{ id: 'lv', title: 'C', sections: [{ id: 's', title: 'S', lessons: [quizzed, textLesson('b', 'Next', '<p>x</p>')] }] }] };
    const { ui, props } = player({ course });
    await mount(ui);
    expect(need(q('[data-mark-next]'), 'mark').hasAttribute('disabled')).toBe(true);
    expect(q('[data-lesson-quiz]')).not.toBeNull();
    await click(need(q('[data-mark-next]'), 'mark'));
    expect(props.onToggleComplete).not.toHaveBeenCalled();
  });
});

describe('CoursePlayer — notes and certificate', () => {
  it('saves a note for the current lesson from the Notes sheet', async () => {
    const { ui, props } = player();
    await mount(ui);
    await click(need(q('[data-open-notes]'), 'notes'));
    await typeInto(need(q('[aria-label="Notes for this lesson"]'), 'textarea'), 'Pray at dawn');
    await click(need(q('[data-save-note]'), 'save'));
    expect(props.onSaveNote).toHaveBeenCalledWith('a', 'Pray at dawn');
    expect(text()).toContain('Saved');
  });

  it('offers the certificate only once every lesson is done and the course issues one', async () => {
    await mount(player({ completed: new Set(['a', 'b', 'c']) }).ui);
    expect(q('[data-certificate]')).not.toBeNull();
    await unmount();
    await mount(player({ completed: new Set(['a', 'b']) }).ui);
    expect(q('[data-certificate]')).toBeNull();
    await unmount();
    await mount(player({ course: { ...COURSE, issueCertificate: false }, completed: new Set(['a', 'b', 'c']) }).ui);
    expect(q('[data-certificate]')).toBeNull();
  });
});

describe('CourseLanding', () => {
  const landing = (props: Partial<Parameters<typeof CourseLanding>[0]> = {}) => (
    <CourseLanding course={{ ...COURSE, description: 'In four lessons you will learn to pray.', price: { mode: 'free' }, included: [] }} mode="member" access={{ allowed: true, reason: 'open' }} {...props} />
  );

  it('shows title, teacher, free price, included list, description and the curriculum', async () => {
    await mount(landing());
    expect(q('[data-landing-title]')?.textContent).toBe('Prayer basics');
    expect(text()).toContain('By Pastor Ana');
    expect(q('[data-landing-price]')?.textContent).toBe('Free');
    expect(text()).toContain("What's included");
    expect(text()).toContain('In four lessons you will learn to pray.');
    expect(q('[data-landing-curriculum]')?.textContent).toContain('3 lessons');
  });

  it('only labels the lessons that are video, so a text course reads as plain text', async () => {
    const textOnly = { ...COURSE, levels: [{ id: 'lv', title: 'C', sections: [{ id: 's', title: 'S', lessons: [textLesson('a', 'One', '<p>x</p>')] }] }] };
    await mount(<CourseLanding course={textOnly} mode="member" access={{ allowed: true, reason: 'open' }} />);
    expect(q('[data-landing-curriculum]')?.textContent?.toLowerCase()).not.toContain('video');
  });

  it('starts the course for a member who has access, and says Continue once begun', async () => {
    const onStart = vi.fn();
    await mount(landing({ onStart }));
    await click(need(q('[data-landing-cta]'), 'cta'));
    expect(onStart).toHaveBeenCalled();
    await unmount();
    await mount(landing({ doneCount: 1 }));
    expect(q('[data-landing-cta]')?.textContent).toBe('Continue');
  });

  it('shows a locked course honestly: not included, no start button, and why', async () => {
    await mount(landing({ access: { allowed: false, reason: 'none' } }));
    const cta = need(q('[data-landing-cta]'), 'cta');
    expect(cta.textContent).toBe('Not included');
    expect(cta.hasAttribute('disabled')).toBe(true);
    expect(need(q('[data-landing-locked]'), 'why').textContent).toContain('not included in your access');
  });

  it('in preview, the button is inert and a paid price carries the checkout-later note', async () => {
    await mount(<CourseLanding course={{ ...COURSE, price: { mode: 'one-time', amountUsd: 25 } }} mode="preview" />);
    expect(q('[data-landing-cta]')?.hasAttribute('disabled')).toBe(true);
    expect(q('[data-landing-price]')?.textContent).toBe('$25');
    expect(q('[data-landing-checkout-note]')?.textContent).toContain('Paid checkout is coming later');
  });

  it('routes a legacy HTML description through the sanitiser', async () => {
    const raw = '<p>Hello <script>window.__x=1</script><b onclick="x()">there</b></p>';
    sanitize.mockClear();
    sanitize.mockReturnValueOnce('<p>Hello there</p>');
    await mount(landing({ course: { ...COURSE, description: raw } as ProductCourse }));
    expect(sanitize).toHaveBeenCalledWith(raw);
    const html = document.body.innerHTML;
    expect(html).toContain('Hello there');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
  });
});

export type { ProductLesson };

describe('CoursePlayer — a lesson that is not in the course', () => {
  it.each(['gone', ''])('shows the empty state, never the first lesson, for lessonId %j', async (lessonId) => {
    await mount(player({ lessonId }).ui);
    expect(q('[data-player-empty]')).not.toBeNull();
    expect(q('[data-lesson-title]')).toBeNull();
    expect(q('[data-lesson-body]')).toBeNull();
  });
});
