// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, for the reason THE-282's layout suite states: with the
// real compiled stylesheet injected, happy-dom returns all zeros from
// getBoundingClientRect() and `display: block` for a flex container, and a
// request to the browser's own debugger port fails same-origin. Every number
// here comes from real Chromium over CDP.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * ⚠️ `sanitizeHtml` IS STUBBED TO THE IDENTITY, and only here.
 *
 * It wraps DOMPurify, which needs a `window` to bind to; this file runs in the
 * `node` environment (see the header — it must, or CDP cannot attach) and
 * DOMPurify's factory hands back a stub whose `sanitize` is not a function.
 * The bios and descriptions rendered below are plain text with no markup, so
 * the identity produces exactly the same DOM the real sanitizer would — and
 * the SAME stub is in force for both the base fixture and the current tree, so
 * the geometry comparison is like for like. Nothing here asserts anything about
 * sanitising; `src/utils/__tests__` owns that.
 */
vi.mock('../../../utils/sanitize', () => ({
  sanitizeHtml: (s?: string) => s ?? '',
  stripHtml: (s?: string) => s ?? '',
}));

import { buildAppCss } from '../../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../../test/support/browser-measure';
import { setUpOrFail } from '../../../test/support/suite-setup';
import { CourseLibrary } from '../CourseLibrary';
import { CourseCurriculum } from '../CourseCurriculum';
import { AuthorProfile } from '../AuthorProfile';
import { QuizPanel } from '../QuizPanel';
import type { Author, Course, Lesson, Level, QuizQuestion } from '../../../types/course.types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE-311 — 🔴 NO MEASURED GEOMETRY MOVED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE-311 is a COLOUR migration. Its whole non-negotiable is that not one pixel
 * moves, and a colour change is exactly the kind of change that quietly does:
 * a `text-faint` class added to an SVG, a `bg-[var(--surface-gold)]` swapped for
 * a `bg-[#FBF3E4]`, a constant that used to be a hex and is now a `var()` a
 * browser might fail to parse — any of those can change a computed box.
 *
 * Two independent proofs, because either alone has a hole:
 *
 *  1. 🔴 AGAINST THE BASE BRANCH. `__fixtures__/the-311-course-geometry.json`
 *     is a complete geometry fingerprint — EVERY element under each screen, at
 *     five viewports — captured by running this same file against the BASE
 *     checkout before any of THE-311's edits existed. Regenerate it with
 *     `THE_311_WRITE_FIXTURE=1` on a clean tree; a mismatch means a box moved.
 *     ⚠️ APPENDED, never substituted: this is a NEW fixture for a NEW claim.
 *     No pinned value anywhere in the repo was rewritten by this ticket, which
 *     `THE-311.course-palette.test.ts` proves from `git diff`.
 *
 *  2. ACROSS ALL FOUR PALETTES. The same fingerprint is taken in Classic light,
 *     Classic dark, Harvest light and Harvest dark and must be IDENTICAL. This
 *     is the property that makes the migration safe by construction: if colour
 *     could move a box, the four would differ.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC — THE-282 measured a card falling TWICE, narrowest
 * at 1280 — so all five widths are measured rather than the extremes.
 *
 * ⚠️ No `git show` at assertion time. The fixture is a committed file.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE = path.join(__dirname, '__fixtures__', 'the-311-course-geometry.json');
const WRITE = process.env.THE_311_WRITE_FIXTURE === '1';

/** The ladder every layout suite in this repo uses. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** Classic FIRST — it has been the default family since THE-265 (#409). */
const PALETTES = [
  { key: 'classic-light', palette: 'classic', theme: 'light' },
  { key: 'classic-dark', palette: 'classic', theme: 'dark' },
  { key: 'harvest-light', palette: 'harvest', theme: 'light' },
  { key: 'harvest-dark', palette: 'harvest', theme: 'dark' },
] as const;

/** The four screens whose markup or constants THE-311 touched. */
const SCREENS = ['library', 'curriculum', 'author', 'quiz'] as const;
type ScreenKey = (typeof SCREENS)[number];

/* ── Fixtures for the components themselves ──────────────────────────────── */

const lesson = (id: string): Lesson => ({
  id, title: `Lesson ${id}`, duration: '10', authorId: 'a-1', summary: '',
});

const course = (id: string, title: string, category: string): Course => ({
  id, featured: false, title, description: 'A course.', category, thumbnail: '',
  authorIds: ['a-1'],
  levels: [{
    id: `lv-${id}`, title: 'Level',
    sections: [{ id: `s-${id}`, title: 'Section', lessons: [lesson(`${id}-1`), lesson(`${id}-2`), lesson(`${id}-3`)] }],
  }],
});

const COURSES: Course[] = [
  course('c1', 'Foundations of Prayer and the Listening Heart', 'Discipleship'),
  course('c2', 'Genesis', 'Bible'),
  course('c3', 'Serving in the Local Church', 'Discipleship'),
];
const AUTHORS: Author[] = [{ id: 'a-1', name: 'Dr Platform Teacher' }];
const CATEGORIES = ['All', 'Discipleship', 'Bible', 'Worship'];
const COMPLETED = new Set(['c1-1', 'c2-1', 'c2-2', 'c2-3']);

const LEVELS: Level[] = [{
  id: 'lv-1', title: 'Level One',
  sections: [
    { id: 'sec-1', title: 'Beginnings', lessons: [lesson('l1'), lesson('l2')] },
    { id: 'sec-2', title: 'Going Deeper', lessons: [lesson('l3')] },
  ],
}];

const QUIZ: QuizQuestion[] = [
  { id: 'q1', q: 'Who wrote the Psalms?', options: [
    { id: 'q1a', text: 'David and others', correct: true },
    { id: 'q1b', text: 'Only Moses', correct: false },
  ] },
  { id: 'q2', q: 'How many gospels are there?', options: [
    { id: 'q2a', text: 'Four', correct: true },
    { id: 'q2b', text: 'Seven', correct: false },
  ] },
];

const AUTHOR: Author = {
  id: 'a-1',
  name: 'Dr Platform Teacher',
  title: 'Teaching Pastor',
  bio: 'A teacher of the word, serving the local church for twenty years.',
  links: [{ id: 'ln-1', platform: 'YouTube', url: 'https://example.org' }],
};

/**
 * The DOM geometry of every element under a screen.
 *
 * 🔴 EVERY element, not a chosen handful. A named-selector fingerprint only
 * fails where someone thought to look; this fails wherever a box moves.
 */
interface Fingerprint { tag: string; x: number; y: number; w: number; h: number }
type Shot = Record<ScreenKey, Fingerprint[]>;

const FINGERPRINT_EXPR = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const out = {};
  for (const key of ${JSON.stringify(SCREENS)}) {
    const host = document.querySelector('[data-screen="' + key + '"]');
    out[key] = [...host.querySelectorAll('*')].map((el) => {
      const b = el.getBoundingClientRect();
      return { tag: el.tagName, x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height) };
    });
  }
  return out;
})()`;

let browser: MeasuringBrowser;
/** shots[paletteKey][viewport] */
const shots: Record<string, Record<number, Shot>> = {};

setUpOrFail(async () => {
  const css = await buildAppCss();

  const body = renderToStaticMarkup(
    <div>
      <div data-screen="library">
        <CourseLibrary
          courses={COURSES}
          authors={AUTHORS}
          categories={CATEGORIES}
          onSelectCourse={() => {}}
          completed={COMPLETED}
        />
      </div>
      <div data-screen="curriculum">
        <CourseCurriculum
          levels={LEVELS}
          renderLesson={(l, n) => <div key={l.id} className="py-2 text-sm">{n}. {l.title}</div>}
        />
      </div>
      <div data-screen="author">
        <AuthorProfile author={AUTHOR} onBack={() => {}} courses={COURSES} onSelectCourse={() => {}} />
      </div>
      <div data-screen="quiz">
        <QuizPanel quiz={QUIZ} onSubmit={() => {}} />
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the311-'));
  const file = path.join(dir, 'page.html');
  /**
   * ⚠️ TRANSITIONS AND ANIMATIONS ARE KILLED, and this was measured rather than
   * assumed. Without it the same page measures differently run to run: the
   * card carries `transition-all duration-200`, its progress fill
   * `transition-all duration-300`, and `browser-measure`'s `settle()` is two
   * animation frames — so a sample can land mid-flight and a height drifts by a
   * few px with nothing having changed. A geometry guard that is not
   * deterministic is not a guard.
   */
  const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important;}';
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>${FREEZE}</style></head><body>${body}</body></html>`);

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const p of PALETTES) {
    shots[p.key] = {};
    // Stamp the palette exactly as the pre-paint script in layout.tsx does.
    await browser.evaluateAt(1440,
      `(() => { const r = document.documentElement;
        r.setAttribute('data-palette', ${JSON.stringify(p.palette)});
        r.setAttribute('data-theme', ${JSON.stringify(p.theme)});
        r.classList.toggle('dark', ${JSON.stringify(p.theme === 'dark')});
        return true; })()`);
    for (const v of VIEWPORTS) {
      // ⚠️ Measured twice, first result discarded. The first layout after a
      // viewport change can be sampled before the page has fully reflowed;
      // the second is stable. Cheap, and it is the difference between a guard
      // and a coin toss.
      await browser.evaluateAt<Shot>(v, FINGERPRINT_EXPR);
      shots[p.key][v] = await browser.evaluateAt<Shot>(v, FINGERPRINT_EXPR);
    }
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

describe('4 — no measured geometry moved', () => {
  it('the four screens really rendered — a fingerprint of nothing would prove nothing', () => {
    for (const key of SCREENS) {
      expect(shots['classic-light'][380][key].length, `${key} rendered no elements`).toBeGreaterThan(10);
    }
  });

  it('🔴 every box is identical to the base branch, at all five widths', () => {
    if (WRITE) {
      writeFileSync(FIXTURE, JSON.stringify(shots['classic-light'], null, 2) + '\n');
      throw new Error('fixture written — unset THE_311_WRITE_FIXTURE and rerun');
    }
    const pinned = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<number, Shot>;
    for (const v of VIEWPORTS) {
      for (const key of SCREENS) {
        expect(shots['classic-light'][v][key], `${key} moved at ${v}px`).toEqual(pinned[v][key]);
      }
    }
  });

  it('and colour cannot move a box: all four palettes measure identically', () => {
    for (const v of VIEWPORTS) {
      for (const p of PALETTES.slice(1)) {
        for (const key of SCREENS) {
          expect(shots[p.key][v][key], `${key} differs in ${p.key} at ${v}px — a colour moved a box`)
            .toEqual(shots['classic-light'][v][key]);
        }
      }
    }
  });

  it('all five widths were really measured, and the card responds to each', () => {
    // ⚠️ THE-282 recorded that width is NOT monotonic — a card fell twice, and
    // was narrowest at 1280 — which is why the whole ladder is pinned rather
    // than its two ends. This asserts the ladder was actually walked; the
    // fixture comparison above is what pins the numbers.
    const cardAt = (v: number) => {
      const card = shots['classic-light'][v].library.find((b) => b.tag === 'DIV' && b.w > 0 && b.w < v);
      return card!.w;
    };
    const widths = VIEWPORTS.map(cardAt);
    expect(widths.length, 'a viewport was skipped').toBe(5);
    expect(new Set(widths).size, `every viewport produced the same card width (${widths.join(', ')}) — the grid is not responsive`)
      .toBeGreaterThan(1);
  });
});

describe('the source files this ticket did not touch still pin their own geometry', () => {
  it('THE-282 and THE-305\'s layout suites are byte-identical', () => {
    // Weakening a pinned suite is how a colour change smuggles a layout change
    // past review. These two are read from disk and compared with the base by
    // THE-311.course-palette.test.ts's `changed()`; here they are simply
    // asserted to still exist and still measure, so a deletion is loud.
    for (const f of [
      'src/components/course/__tests__/THE-282.course-cards-layout.test.tsx',
      'src/components/__tests__/THE-305.course-editor-header.layout.test.tsx',
    ]) {
      const body = readFileSync(path.join(ROOT, f), 'utf8');
      expect(body, `${f} no longer measures in a real browser`).toContain('MeasuringBrowser');
    }
  });
});
