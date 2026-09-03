import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * 🔴 THE RIG THAT PROVES THERE IS ONE DEFINITION OF COMPLETE.
 *
 * `getCourseStatus` is replaced by a passthrough that a test can force to a
 * chosen answer. A card that asks the shared helper follows the forced answer;
 * a card carrying its OWN completeness rule ignores it and keeps saying `done`.
 *
 * ⚠️ This exists because the obvious guard does not work. A regex hunting for
 * the SHAPE of a second definition (`allLessons.every(l => completed.has(l.id))`)
 * was written first and a mutation walked straight past it — the same rule
 * spelled `(completed ?? new Set()).has(l.id)` matches nothing the pattern
 * looks for, and there are unbounded ways to spell it. Forcing the answer and
 * watching what the card does is not evadable that way.
 *
 * `rig` is null for every other test in this file, so they all exercise the
 * real helper.
 */
const rig = vi.hoisted(() => ({ status: null as string | null }));
vi.mock('../../../utils/course.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/course.utils')>();
  return {
    ...actual,
    getCourseStatus: (...args: Parameters<typeof actual.getCourseStatus>) =>
      rig.status ?? actual.getCourseStatus(...args),
  };
});

import { CourseCard } from '../CourseCard';
import { CourseLibrary } from '../CourseLibrary';
import type { Author, Course, Lesson } from '../../../types/course.types';
import {
  getCourseStatus,
  verifyCourseCompletion,
  COURSE_STATUS_LABEL,
  COURSE_STATUS_CTA,
  type CourseStatus,
} from '../../../utils/course.utils';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE-282 — the status badge, the status-aware CTA, and the category filter
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything here is about WHAT the card says. `THE-282.course-cards-layout`
 * owns every question about where it lands and how big it is, because those
 * cannot be answered under happy-dom at all.
 *
 * ── The one thing this file exists to prevent ────────────────────────────────
 * 🔴 A SECOND DEFINITION OF "COMPLETE". Certificates are issued by
 * `/api/certificate` recomputing `verifyCourseCompletion` from the user's own
 * Firestore data, and `isAtCourseLimit` counts against the same idea. A card
 * that decided "finished" its own way would badge a course Done that the
 * server refuses to certify — a real bug, not a cosmetic one. Section 3 pins
 * the card to that one function by construction and by source.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');


/**
 * The base commit this branch's changes are measured against.
 *
 * ⚠️ NOT hardcoded to `origin/main`, and that is a CI concern rather than a
 * stylistic one. Locally the remote-tracking ref is always there; on a
 * `pull_request` run the tree checked out is `refs/pull/N/merge` and the
 * available refs depend on what `actions/checkout` fetched. A test that
 * resolves `origin/main` on the machine that wrote it and dies with
 * `fatal: bad revision` on CI is the exact failure mode `.github/workflows/
 * test.yml` calls "the worst version of this bug".
 *
 * So: try the remote-tracking ref, then a local `main`, then — for a merge-ref
 * checkout — the merge commit's FIRST PARENT, which is the base branch as it
 * stood when the run started. 🔴 If none resolve this throws rather than
 * skipping: a pinned-file check that quietly measures nothing is worse than no
 * check at all.
 */
function baseRef(): string {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return git(['rev-parse', '--verify', `${ref}^{commit}`]); } catch { /* try the next */ }
  }
  try {
    // `a b c` — the commit and its two parents — means HEAD is the PR merge.
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through to the throw */ }

  throw new Error(
    'the base commit could not be resolved, so "byte-identical to main" would be ' +
    'measuring nothing. Tried origin/main, refs/remotes/origin/main, main, and ' +
    "HEAD's first parent.",
  );
}

/** Which of `paths` differ from the base. Empty means untouched. */
function changedSince(...paths: string[]): string[] {
  return execFileSync('git', ['diff', '--name-only', baseRef(), '--', ...paths],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

const CARD = 'src/components/course/CourseCard.tsx';
const LIBRARY = 'src/components/course/CourseLibrary.tsx';

const lesson = (id: string, withQuiz = false): Lesson => ({
  id, title: `Lesson ${id}`, duration: '10', authorId: 'a-1', summary: '',
  ...(withQuiz
    ? { quiz: [{ id: `${id}-q`, q: 'Q?', options: [{ id: 'o', text: 'A', correct: true }] }] }
    : {}),
});

function makeCourse(over: Partial<Course> = {}): Course {
  return {
    id: 'c-1', featured: false, title: 'Foundations of Prayer', description: 'About.',
    category: 'Discipleship', thumbnail: '', authorIds: ['a-1'],
    levels: [{
      id: 'lv', title: 'L',
      sections: [{ id: 's', title: 'S', lessons: [lesson('l1'), lesson('l2'), lesson('l3'), lesson('l4')] }],
    }],
    ...over,
  };
}

const AUTHORS: Author[] = [{ id: 'a-1', name: 'Dr Platform Teacher' }];
const NONE = new Set<string>();
const SOME = new Set(['l1']);
const ALL = new Set(['l1', 'l2', 'l3', 'l4']);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  rig.status = null;
});

function renderCard(props: Partial<React.ComponentProps<typeof CourseCard>> = {}) {
  act(() => {
    root = createRoot(container);
    root.render(
      <CourseCard course={makeCourse()} authors={AUTHORS} onClick={() => {}} {...props} />,
    );
  });
  return container;
}

function renderLibrary(props: Partial<React.ComponentProps<typeof CourseLibrary>> = {}) {
  act(() => {
    root = createRoot(container);
    root.render(
      <CourseLibrary
        courses={[]}
        authors={AUTHORS}
        categories={['All']}
        onSelectCourse={() => {}}
        {...props}
      />,
    );
  });
  return container;
}

const badge = (c: HTMLElement) => c.querySelector('[data-course-status-badge]');
const cta = (c: HTMLElement) => c.querySelector('[data-course-cta]');
const cards = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-course-card]'));
const pill = (c: HTMLElement, cat: string) =>
  c.querySelector<HTMLButtonElement>(`[data-category-pill="${cat}"]`)!;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · The status badge
// ═══════════════════════════════════════════════════════════════════════════
describe('1 — the status badge', () => {
  it('a course with some lessons complete shows Ongoing', () => {
    const c = renderCard({ completed: SOME });
    expect(badge(c)!.getAttribute('data-course-status-badge')).toBe('ongoing');
    expect(badge(c)!.textContent).toBe('Ongoing');
  });

  it('🔴 a course with every lesson complete shows Done — by course.utils.ts\'s definition', () => {
    const course = makeCourse();
    // The definition, stated by the shared helper rather than by this test.
    expect(verifyCourseCompletion(course, ALL, {}).complete).toBe(true);

    const c = renderCard({ course, completed: ALL });
    expect(badge(c)!.getAttribute('data-course-status-badge')).toBe('done');
    expect(badge(c)!.textContent).toBe('Done');
  });

  it('🔴 a course with no progress does NOT show Paused', () => {
    const c = renderCard({ completed: NONE });
    const text = c.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('paused');
    expect(badge(c)!.getAttribute('data-course-status-badge')).toBe('not-started');
  });

  it('🔴 "paused" appears nowhere in the status vocabulary, the card or the library', () => {
    // The invented state stays out of the type, the labels, the CTAs and both
    // components — asserted over the shipped values, not over a copy of them.
    const vocabulary = [
      ...Object.keys(COURSE_STATUS_LABEL),
      ...Object.values(COURSE_STATUS_LABEL),
      ...Object.values(COURSE_STATUS_CTA),
    ].join(' ').toLowerCase();
    expect(vocabulary).not.toContain('paus');

    // The three statuses are exactly the three the data can answer.
    expect(Object.keys(COURSE_STATUS_LABEL).sort())
      .toEqual(['done', 'not-started', 'ongoing']);

    for (const file of [CARD, LIBRARY, 'src/utils/course.utils.ts']) {
      // Comments included deliberately: the note explaining why there is no
      // `paused` says the word, so only a *value* may not.
      const code = src(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(code.toLowerCase(), `${file} mentions a paused state`).not.toContain('paus');
    }
  });

  it('🔴 no status is derived from a field the data does not carry', () => {
    // The distinction a `paused` badge would need. `getCourseStatus` takes only
    // the course, the completed ids and the quiz attempts, so a "when did they
    // last look" input has nowhere to enter — and neither component reaches for
    // one either.
    expect(getCourseStatus.length).toBeLessThanOrEqual(3);
    for (const file of [CARD, LIBRARY, 'src/utils/course.utils.ts']) {
      // Comments stripped: the note explaining why there is no `lastOpenedAt`
      // names it, and an explanation must not fail the rule it documents.
      const code = src(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      for (const invented of ['lastOpenedAt', 'lastViewedAt', 'watchTime', 'watchedSeconds']) {
        expect(code, `${file} reaches for ${invented}`).not.toContain(invented);
      }
    }
    // And the type it would have to be declared on does not have one.
    const types = src('src/types/course.types.ts');
    expect(types).not.toContain('lastOpenedAt');
  });

  it('a zero-lesson course is not-started, never done — there is nothing to finish', () => {
    const empty = makeCourse({ levels: [] });
    expect(verifyCourseCompletion(empty, [], {}).complete).toBe(false);
    const c = renderCard({ course: empty, completed: NONE });
    expect(badge(c)!.getAttribute('data-course-status-badge')).toBe('not-started');
  });

  it('the quiz gate reaches the badge — requireQuiz holds a full course at Ongoing', () => {
    // Not a second rule: `verifyCourseCompletion` owns the gate and the badge
    // simply inherits it, so the card can never promise a certificate the
    // server would refuse.
    const quizzed = makeCourse({
      requireQuiz: true,
      levels: [{
        id: 'lv', title: 'L',
        sections: [{ id: 's', title: 'S', lessons: [lesson('l1'), lesson('l2', true)] }],
      }],
    });
    const all = new Set(['l1', 'l2']);
    expect(getCourseStatus(quizzed, all, {})).toBe('ongoing');
    expect(getCourseStatus(quizzed, all, {
      l2: { score: 1, total: 1, passed: true, answeredAt: 'x' },
    })).toBe('done');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · The CTA follows the status
// ═══════════════════════════════════════════════════════════════════════════
describe('2 — the CTA text follows the status', () => {
  const CASES: [CourseStatus, Set<string>, string][] = [
    ['not-started', NONE, 'Start course'],
    ['ongoing', SOME, 'Continue'],
    ['done', ALL, 'Review'],
  ];

  for (const [status, completed, label] of CASES) {
    it(`${status} → "${label}"`, () => {
      const c = renderCard({ completed });
      expect(cta(c)!.getAttribute('data-course-cta')).toBe(status);
      expect(cta(c)!.textContent).toBe(label);
      expect(COURSE_STATUS_CTA[status]).toBe(label);
    });
  }

  it('🔴 the three labels are distinct — a CTA that never changes follows nothing', () => {
    expect(new Set(Object.values(COURSE_STATUS_CTA)).size).toBe(3);
  });

  it('the CTA opens the course exactly once, not twice through the card', () => {
    let opened = 0;
    const c = renderCard({ completed: SOME, onClick: () => { opened += 1; } });
    click(cta(c)!);
    expect(opened, 'the click bubbled to the card as well as firing the button').toBe(1);
  });

  it('the card itself still opens the course', () => {
    let opened = 0;
    const c = renderCard({ completed: SOME, onClick: () => { opened += 1; } });
    click(c.querySelector('[data-course-card]')!);
    expect(opened).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · ONE definition of complete
// ═══════════════════════════════════════════════════════════════════════════
describe('3 — there is only ONE definition of complete', () => {
  it('🔴 the card reaches completeness through course.utils.ts and nowhere else', () => {
    const code = src(CARD);
    expect(code, 'the card does not import the shared status helper')
      .toMatch(/getCourseStatus[\s\S]*?from "\.\.\/\.\.\/utils\/course\.utils"/);
  });

  it('🔴 getCourseStatus is a read of verifyCourseCompletion, not a rule of its own', () => {
    const utils = src('src/utils/course.utils.ts');
    const body = /export const getCourseStatus[\s\S]*?\n};/.exec(utils)?.[0] ?? '';
    expect(body, 'getCourseStatus was found but has no body').not.toBe('');
    expect(body).toContain('verifyCourseCompletion(');
    // No independent notion of "all done" living beside the one that counts.
    expect(body).not.toMatch(/\.every\(|\.length === total|=== totalLessons\b/);
  });

  it('🔴 the card FOLLOWS the shared helper — force it, and the badge moves', () => {
    // Every lesson complete, so an independent rule inside the card would say
    // `done` on its own. The shared helper is forced to disagree.
    rig.status = 'not-started';
    const c = renderCard({ completed: ALL });
    expect(badge(c)!.getAttribute('data-course-status-badge'),
      'the card ignored the shared helper, so it has a completeness rule of its own')
      .toBe('not-started');
    expect(cta(c)!.textContent, 'the CTA is driven by something other than the shared status')
      .toBe('Start course');
    expect(c.querySelector('[data-course-card]')!.getAttribute('data-course-status'))
      .toBe('not-started');
  });

  it('🔴 forcing the helper the other way moves it back — the rig is really wired', () => {
    // Guards the guard: a card that ignored the rig in BOTH directions would
    // pass the test above by accident if the rig were a no-op.
    rig.status = 'done';
    const c = renderCard({ completed: NONE });
    expect(badge(c)!.getAttribute('data-course-status-badge')).toBe('done');
    expect(cta(c)!.textContent).toBe('Review');
  });

  it('neither component spells a completeness rule of its own', () => {
    // A secondary, source-level check. Deliberately NOT the primary one — see
    // the note on the rig above for why a pattern like this is not sufficient.
    for (const file of [CARD, LIBRARY]) {
      const code = src(file).replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/[^\n]*/g, '');
      expect(code, `${file} spells its own "every lesson is done" check`)
        .not.toMatch(/\.every\([^)]*\)?\s*=>[\s\S]{0,60}?\.has\(/);
      expect(code, `${file} compares a done count against a total`)
        .not.toMatch(/(?:done|completedCount)\s*===\s*\w*(?:[Ll]essons?)?\.?length|completedCount\s*===\s*totalLessons/);
    }
  });

  it('🔴 the card agrees with verifyCourseCompletion across every progress point', () => {
    const course = makeCourse();
    const ids = ['l1', 'l2', 'l3', 'l4'];
    for (let n = 0; n <= ids.length; n++) {
      const done = new Set(ids.slice(0, n));
      const expected = verifyCourseCompletion(course, done, {}).complete;
      const c = renderCard({ course, completed: done });
      const isDone = badge(c)!.getAttribute('data-course-status-badge') === 'done';
      expect(isDone, `${n}/4 lessons: the badge and the shared helper disagree`).toBe(expected);
      act(() => root.unmount());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Progress — unchanged from what the card computed before
// ═══════════════════════════════════════════════════════════════════════════
describe('4 — progress % is unchanged from what CourseCard computed before', () => {
  /**
   * 🔴 The formula as it stood at 7f8455e, restated here rather than imported,
   * so a change to the shipped one fails instead of being followed. Not read
   * out of git at assertion time: a test that shells out to `git show` measures
   * the checkout, not the code.
   */
  const BASELINE = (course: Course, completed?: Set<string>) => {
    const all = course.levels.flatMap((lv) => lv.sections.flatMap((s) => s.lessons));
    const total = all.length;
    const done = completed ? all.filter((l) => completed.has(l.id)).length : 0;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  };

  it('🔴 every progress point matches the pre-change formula exactly', () => {
    /**
     * ⚠️ Ranged over SEVERAL lesson counts, not just four.
     *
     * With 4 lessons every ratio lands on 0/25/50/75/100, where `Math.floor`
     * and `Math.round` agree — a mutation from one to the other walked past an
     * earlier version of this test that used 4 alone. 3 and 7 are where the two
     * disagree, so they are what the no-regression guard actually rests on.
     */
    for (const count of [1, 2, 3, 4, 6, 7]) {
      const ids = Array.from({ length: count }, (_, i) => `l${i + 1}`);
      const course = makeCourse({
        levels: [{
          id: 'lv', title: 'L',
          sections: [{ id: 's', title: 'S', lessons: ids.map((id) => lesson(id)) }],
        }],
      });
      for (let n = 0; n <= count; n++) {
        const done = new Set(ids.slice(0, n));
        const c = renderCard({ course, completed: done });
        const shown = c.querySelector('[data-course-progress]')!.getAttribute('data-course-progress');
        expect(Number(shown), `${n}/${count} lessons`).toBe(BASELINE(course, done));
        expect(c.textContent).toContain(`${BASELINE(course, done)}%`);
        act(() => root.unmount());
      }
    }
  });

  it('🔴 the guard rests on ratios where rounding is decidable', () => {
    // Guards the guard: if every count above ever landed on exact multiples,
    // `Math.floor` and `Math.round` would agree everywhere and the test above
    // would prove nothing. 2/3 and 2/7 are the cases that make it bite — note
    // 1/3 does NOT (33.33 floors and rounds to 33 alike), which is exactly the
    // kind of near-miss that makes a rounding guard quietly vacuous.
    expect(Math.round((2 / 3) * 100)).not.toBe(Math.floor((2 / 3) * 100));
    expect(Math.round((2 / 7) * 100)).not.toBe(Math.floor((2 / 7) * 100));
    expect(Math.round((1 / 3) * 100)).toBe(Math.floor((1 / 3) * 100));
  });

  it('the rounding is Math.round on the same ratio — 1/3 is 33%, 2/3 is 67%', () => {
    const three = makeCourse({
      levels: [{
        id: 'lv', title: 'L',
        sections: [{ id: 's', title: 'S', lessons: [lesson('l1'), lesson('l2'), lesson('l3')] }],
      }],
    });
    for (const [done, pct] of [[['l1'], 33], [['l1', 'l2'], 67]] as [string[], number][]) {
      const c = renderCard({ course: three, completed: new Set(done) });
      expect(c.querySelector('[data-course-progress]')!.getAttribute('data-course-progress'))
        .toBe(String(pct));
      act(() => root.unmount());
    }
  });

  it('a course with no lessons is 0%, not NaN', () => {
    const c = renderCard({ course: makeCourse({ levels: [] }), completed: NONE });
    expect(c.querySelector('[data-course-progress]')!.getAttribute('data-course-progress')).toBe('0');
  });

  it('no watch-time tracking was added — progress is lesson completion', () => {
    for (const file of [CARD, LIBRARY]) {
      const code = src(file);
      for (const banned of ['currentTime', 'onProgress', 'watched', 'playerRef', 'YT.Player']) {
        expect(code, `${file} tracks ${banned}`).not.toContain(banned);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The category filter
// ═══════════════════════════════════════════════════════════════════════════
describe('5 — the category filter narrows the list', () => {
  const COURSES: Course[] = [
    makeCourse({ id: 'c-1', title: 'Prayer', category: 'Discipleship' }),
    makeCourse({ id: 'c-2', title: 'Genesis', category: 'Bible' }),
    makeCourse({ id: 'c-3', title: 'Serving', category: 'Discipleship' }),
  ];
  const CATEGORIES = ['All', 'Discipleship', 'Bible', 'Worship'];

  it('All shows every course', () => {
    const c = renderLibrary({ courses: COURSES, categories: CATEGORIES });
    expect(cards(c)).toHaveLength(3);
  });

  it('picking a category narrows the list to it', () => {
    const c = renderLibrary({ courses: COURSES, categories: CATEGORIES });
    click(pill(c, 'Discipleship'));
    expect(cards(c)).toHaveLength(2);
    expect(c.textContent).toContain('Prayer');
    expect(c.textContent).not.toContain('Genesis');

    click(pill(c, 'Bible'));
    expect(cards(c)).toHaveLength(1);
    expect(c.textContent).toContain('Genesis');
  });

  it('going back to All restores the full list', () => {
    const c = renderLibrary({ courses: COURSES, categories: CATEGORIES });
    click(pill(c, 'Bible'));
    expect(cards(c)).toHaveLength(1);
    click(pill(c, 'All'));
    expect(cards(c)).toHaveLength(3);
  });

  it('🔴 a category matching nothing shows the `empty` component', () => {
    const c = renderLibrary({ courses: COURSES, categories: CATEGORIES });
    click(pill(c, 'Worship'));
    expect(cards(c)).toHaveLength(0);
    const empty = c.querySelector('[data-courses-empty]');
    expect(empty, 'no empty state rendered for a category with no courses').not.toBeNull();
    expect(empty!.getAttribute('data-slot')).toBe('empty');
    expect(empty!.textContent).toContain('No courses found');
    expect(empty!.textContent).toContain('Worship');
  });

  it('🔴 the empty state does not appear beside a populated Continue Learning list', () => {
    // The bug the `filtered` condition fixes: Continue Learning takes its share
    // out of `allCourses`, so a category holding only part-finished courses
    // emptied that array and printed "No courses found" under a full list.
    const c = renderLibrary({
      courses: [COURSES[0]], categories: CATEGORIES, completed: new Set(['l1']),
    });
    expect(c.textContent).toContain('Continue Learning');
    expect(cards(c)).toHaveLength(1);
    expect(c.querySelector('[data-courses-empty]'), 'an empty state under a populated list')
      .toBeNull();
    expect(c.textContent).not.toContain('No courses found');
  });

  it('the active pill is marked for assistive tech, not by colour alone', () => {
    const c = renderLibrary({ courses: COURSES, categories: CATEGORIES });
    expect(pill(c, 'All').getAttribute('aria-pressed')).toBe('true');
    click(pill(c, 'Bible'));
    expect(pill(c, 'Bible').getAttribute('aria-pressed')).toBe('true');
    expect(pill(c, 'All').getAttribute('aria-pressed')).toBe('false');
  });

  it('every filtered card carries its own status', () => {
    const c = renderLibrary({
      courses: COURSES, categories: CATEGORIES, completed: ALL,
    });
    for (const card of cards(c)) {
      expect(card.getAttribute('data-course-status')).toBe('done');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Colour — nothing hardcoded, all four palettes resolve, Classic first
// ═══════════════════════════════════════════════════════════════════════════
describe('6 — no colour is hardcoded and all four palettes resolve', () => {
  /**
   * ⚠️ Widths, sizes and shadows are NOT colours, and the naive `border-[a-z]`
   * / `ring-[a-z]` spellings flag every one of them. They are excluded by name
   * so the check keeps meaning what it says.
   */
  const NOT_A_COLOUR = /^(?:border(?:-(?:[btlrxy]|\d+|solid|dashed|dotted|none))?$|ring-\d|shadow-(?:xs|sm|md|lg|xl|2xl|none)$|text-(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify)$|bg-clip-\w+$|outline-(?:none|hidden|dashed|dotted|solid|double|\d+)$|\w+-\[[\d.]+(?:px|rem|em|%)\]$|to-transparent$)/;
  const COLOURED = /^(?:bg|text|border|from|via|to|ring|fill|stroke|divide|placeholder|shadow|accent|caret|decoration|outline)-[a-z[]/;

  /** The Harvest semantic ramp — what this card's own markup spells. */
  const HARVEST = /-(surface(-\w+)?|line(-\w+)?|strong|muted|faint|body|gold|danger|white|transparent|current|inherit)$/;

  /**
   * The shadcn bridge layer, emitted by `Badge` and `Button` from inside the
   * primitives rather than by this card.
   *
   * 🔴 Allowed, but not on trust: the test below asserts each of these names is
   * declared as a custom property in globals.css, so "the bridge held with zero
   * additions" is evidence rather than an exemption.
   */
  const BRIDGE = ['primary', 'primary-foreground', 'secondary', 'secondary-foreground',
    'muted', 'muted-foreground', 'foreground', 'background', 'border', 'input',
    'ring', 'destructive', 'accent', 'accent-foreground', 'card', 'popover'];

  /** `hover:`, `focus-visible:`, `aria-invalid:`, `[a]:hover:`, `/80`, `!`. */
  const bare = (t: string) => t
    .replace(/^(?:\[[^\]]+\]:|(?:hover|focus|focus-visible|active|disabled|dark|group-hover|in|not|aria-\w+|data-\[[^\]]+\]|has-data-\[[^\]]+\]|peer-\w+):)+/g, '')
    .replace(/\/\d+$/, '')
    .replace(/!$/, '');

  it('🔴 the card spells no raw colour literal — no hex, no rgb(), no hsl()', () => {
    const code = src(CARD).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], 'a hex literal is in the card').toEqual([]);
    expect(code.match(/\b(?:rgba?|hsla?|oklch|lab)\(/g) ?? [], 'a raw colour function is in the card')
      .toEqual([]);
  });

  it('🔴 every colour the card spells is a theme token or a CSS variable', () => {
    const tokens = new Set<string>();
    // Every status, so the Ongoing and Done grounds are inspected too.
    for (const completed of [NONE, SOME, ALL]) {
      const c = renderCard({ completed });
      for (const el of Array.from(c.querySelectorAll('*'))) {
        for (const t of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) tokens.add(t);
      }
      for (const t of (c.firstElementChild?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
        tokens.add(t);
      }
      act(() => root.unmount());
    }
    expect(tokens.size, 'nothing was collected — the card did not render').toBeGreaterThan(20);

    const offenders = [...tokens]
      .map(bare)
      .filter((u) => COLOURED.test(u) && !NOT_A_COLOUR.test(u))
      .map((u) => {
        // An arbitrary value is fine when it resolves through a CSS variable —
        // color-mix(in srgb, var(--brand-color) …) is the app's own accent.
        if (/^\w+-\[/.test(u)) return u.includes('var(--') ? null : u;
        if (HARVEST.test(u)) return null;
        const name = u.replace(/^(?:bg|text|border|ring|fill|stroke|from|via|to|outline|accent|caret|decoration|divide|placeholder|shadow)-/, '');
        return BRIDGE.includes(name) ? null : u;
      })
      .filter((u): u is string => u !== null);
    expect(offenders, 'these colours are not expressed through a theme token').toEqual([]);
  });

  it('🔴 the inline styles the card keeps are var-backed, not hexes', () => {
    /**
     * ⚠️ ASSERTED FROM THE SOURCE, and that is not a shortcut.
     *
     * happy-dom's CSSStyleDeclaration silently DROPS a declaration whose value
     * is `var(…)` — measured here: the card renders `color: var(--brand-color,
     * #C9963A)` and `background: var(--brand-color, #C9963A)`, and the only
     * thing left in any `style` attribute afterwards is the progress bar's
     * `width: 100%`. A DOM-side assertion about themed inline colour under this
     * environment would pass over an empty set and prove nothing.
     */
    const code = src(CARD);
    const styles = [...code.matchAll(/style=\{\{([^}]*)\}\}/g)].map((m) => m[1]);
    expect(styles.length, 'the card no longer carries an inline style').toBeGreaterThan(0);
    for (const s of styles) {
      // Only the colour-bearing ones; `width` is the progress value.
      if (!/color|background/.test(s)) continue;
      expect(s, `an inline colour that is not the GOLD token: ${s}`).toMatch(/\bGOLD\b/);
    }
    // And GOLD is var-backed, so those two really do follow the tenant accent.
    expect(src('src/utils/course.constants.ts'))
      .toMatch(/export const GOLD = 'var\(--brand-color, #C9963A\)'/);
  });

  it('🔴 the card does NOT import the hex-bearing constants', () => {
    // GOLD is `var(--brand-color, #C9963A)` and is fine. GOLD_BTN, BORDER and
    // the rest of course.constants.ts are raw hexes that cannot follow a
    // palette — see the note on `ProgressBar` in the card.
    const importLine = /import \{([^}]*)\} from "\.\.\/\.\.\/utils\/course\.constants"/.exec(src(CARD));
    expect(importLine, 'the constants import moved').not.toBeNull();
    const imported = importLine![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(imported).toEqual(['GOLD']);
  });

  it('Classic is the default palette these tokens are read in first', () => {
    const globals = src('src/app/globals.css');
    expect(globals).toMatch(/--brand-color:\s*#C9963A;/);
    /**
     * All four = two families × two themes. Harvest is the BASE pair and has no
     * `[data-palette]` selector of its own — it is `:root` and
     * `[data-theme="dark"]`; Classic is additive on top. So the four are
     * asserted as the two base selectors plus Classic's two overrides.
     */
    expect(globals).toContain('[data-theme="dark"]');
    expect(globals).toContain('[data-palette="classic"][data-theme="light"]');
    expect(globals).toContain('[data-palette="classic"][data-theme="dark"]');
    // Every neutral token the card leans on is redeclared by Classic, so the
    // card follows the family rather than staying on Harvest's warm ramp.
    const classicLight = /\[data-palette="classic"\]\[data-theme="light"\] \{([\s\S]*?)\}/.exec(globals)![1];
    for (const token of ['--surface-raised', '--surface-sunken', '--surface-chip', '--text-muted', '--border-default']) {
      expect(classicLight, `Classic does not redeclare ${token}`).toContain(token);
    }
    // Classic is what the pre-paint script stamps when nothing is stored.
    expect(src('src/app/layout.tsx')).toContain("'harvest':'classic'");
  });

  it('🔴 the token bridge needed no addition — every name the card resolves already existed', () => {
    const globals = src('src/app/globals.css');
    // The shadcn layer the primitives emit. Each must already be a declared
    // custom property, or allowing it above would be rubber-stamping.
    for (const name of BRIDGE) {
      expect(globals, `--${name} is not declared — the bridge would need an addition`)
        .toMatch(new RegExp(`--${name}:`));
    }
    // The Harvest semantic names this card's own markup spells.
    const config = src('tailwind.config.ts') + globals;
    for (const token of ['surface-sunken', 'surface-chip', 'brand-color', 'text-muted', 'text-faint']) {
      expect(config, `${token} is not defined — this change would be minting a token`)
        .toContain(token);
    }
    // And globals.css itself is untouched by this ticket.
    expect(changedSince('src/app/globals.css', 'tailwind.config.ts'),
      'a token was defined for this ticket').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · The pinned files
// ═══════════════════════════════════════════════════════════════════════════
describe('7 — the progress model, the editor and the adoption gate are untouched', () => {
  const PINNED = [
    'src/components/CoursePage.tsx',
    'src/components/AdminCourseEditor.tsx',
    'src/utils/course-adoption.ts',
    'firestore.rules',
  ];

  it('🔴 every pinned file is byte-identical to the base branch', () => {
    // ⚠️ One `git diff` over the set, at collection time — not a `git show` per
    // assertion. A name printed here is a file this ticket had no business in.
    expect(changedSince(...PINNED, 'functions/'), 'these pinned files were modified').toEqual([]);
  });

  it('🔴 the completedLessons read and write are exactly where they were', () => {
    const page = src('src/components/CoursePage.tsx');
    expect(page).toContain('setCompleted(new Set(data.completedLessons));');
    expect(page).toContain('completedLessons: Array.from(newCompleted),');
  });

  it('the adoption gate still counts own + adopted against maxCourses', () => {
    expect(src('src/utils/course-adoption.ts')).toContain('isAtCourseLimit');
  });

  it('no new dependency was added', () => {
    expect(changedSince('package.json', 'package-lock.json'), 'a dependency was added').toEqual([]);
  });

  it('no new ui component was installed — all of them predate this ticket', () => {
    expect(changedSince('src/components/ui/'), 'a ui primitive was added or edited').toEqual([]);
  });
});
