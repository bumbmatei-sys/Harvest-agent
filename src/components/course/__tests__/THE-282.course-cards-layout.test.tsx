// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing. Nothing here needs a DOM —
// the grid is rendered to a string and every measurement happens inside real
// Chromium over CDP. Under this repo's default happy-dom environment a request
// to the browser's own debugger port fails same-origin, so the browser can
// never be attached to.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../../test/support/browser-measure';
import { setUpOrFail } from '../../../test/support/suite-setup';
import { CourseLibrary } from '../CourseLibrary';
import { TAP_TARGET_PX } from '../CourseCard';
import type { Author, Course, Lesson } from '../../../types/course.types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE-282 — WHERE the course grid lands, and how big its controls really are
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 EVERY QUESTION HERE IS A LAYOUT QUESTION, and happy-dom cannot answer one:
 * with the real compiled stylesheet injected it returns all zeros from
 * `getBoundingClientRect()` and `display: block` for a flex container. So "is
 * this pill 44px", "does the page scroll sideways" and "does the last card
 * clear the bottom nav" are asked HERE, over CDP, in real Chromium.
 * `THE-282.course-status.test.tsx` owns everything that is not geometry.
 *
 * ⚠️ THE REM TRAP IS WHY THE NUMBERS ARE IN PX. globals.css trims the rem base
 * to 14.5px above 1024px, so a class NAMED 44px (`h-11`) renders 39.875px on a
 * desktop. Section 1 measures the literal `h-[44px]` at all five widths, and
 * measures the trim itself, so that regression cannot come back silently.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC. Section 2 measures whether the content box at
 * 1024px is narrower than at 768px — at 1024 the member shell takes a sidebar
 * AND the rem base drops, so the grid can get less room from a wider window.
 * The suite records the answer rather than assuming it.
 *
 * ── What is approximated, and why that is safe ──────────────────────────────
 * The REAL `CourseLibrary` is server-rendered with real courses, inside an
 * approximated member shell. 🔴 The shell's bottom nav is not hand-typed: its
 * class string is READ OUT OF `MainApp.tsx` at build time, so this file cannot
 * measure against a stale copy of a nav that has since moved. That file is out
 * of scope here and is only ever read.
 */

const ROOT = path.resolve(__dirname, '../../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The ladder every layout suite in this repo uses. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** iPhone 14/15 logical height — the harness's 1200px default is no phone, and
 *  "does the last card clear a `fixed bottom-0` nav" is meaningless at a height
 *  where everything clears everything. */
const PHONE_HEIGHT = 844;

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

/** Long enough to fill a phone screen past the fold, so the LAST card is a real
 *  question about the bottom of the viewport. */
const COURSES: Course[] = [
  course('c1', 'Foundations of Prayer and the Listening Heart', 'Discipleship'),
  course('c2', 'Genesis', 'Bible'),
  course('c3', 'Serving in the Local Church', 'Discipleship'),
  course('c4', 'Worship and the Psalms', 'Worship'),
  course('c5', 'The Gospel of John', 'Bible'),
  course('c6', 'Hospitality', 'Discipleship'),
];

const AUTHORS: Author[] = [{ id: 'a-1', name: 'Dr Platform Teacher' }];
const CATEGORIES = ['All', 'Discipleship', 'Bible', 'Worship', 'Leadership', 'Marriage & Family'];
/** One card ongoing, one done, the rest not started — all three badges on screen. */
const COMPLETED = new Set(['c1-1', 'c2-1', 'c2-2', 'c2-3']);

/**
 * The member shell's bottom nav classes, read from the shell itself.
 *
 * 🔴 Read, never copied: a hand-typed nav that has since moved would let every
 * clearance assertion below pass against nothing.
 */
function navClass(): string {
  const shell = src('src/components/MainApp.tsx');
  const match = /<div className=\{`(bg-surface-raised border-t lg:border-t-0[^`]*)`\}>/.exec(shell);
  if (!match) {
    throw new Error(
      "the member shell's bottom nav could not be located in MainApp.tsx, so this file " +
      'would be measuring a hand-typed copy of a nav that may have moved.',
    );
  }
  // The live string carries template holes for the collapsed-sidebar width and
  // the hide-on-scroll transform; the visible, expanded state is what a card
  // has to clear.
  const cls = match[1]
    .replace(/\$\{isSidebarCollapsed \? '[^']*' : '([^']*)'\}/g, '$1')
    .replace(/\$\{[^}]*\}/g, 'max-lg:translate-y-0');
  // 🔴 The four properties every assertion here depends on.
  //
  // The fourth used to be spelled `pb-safe`. THE-295 established that class
  // emitted NO CSS against this repo's real config — it is not a utility
  // defined in tailwind.config.ts or globals.css — so the nav reserved no
  // safe-area inset at all, and a sentinel spelled `pb-safe` was pinning an
  // inert string. It is now the arbitrary form that actually compiles, so this
  // sentinel fails if the nav loses the inset rather than passing on a no-op.
  for (const required of ['fixed', 'bottom-0', 'z-[100]', 'env(safe-area-inset-bottom)']) {
    expect(cls, `the member bottom nav no longer carries ${required}`).toContain(required);
  }
  return cls;
}

interface Box {
  x: number; y: number; width: number; height: number; right: number; bottom: number;
}

let browser: MeasuringBrowser;

setUpOrFail(async () => {
  const css = await buildAppCss();

  const body = renderToStaticMarkup(
    <div>
      {/*
        The member shell, approximated: a sidebar spacer that only exists from
        `lg` up — which is exactly where the nav stops being a bottom bar and
        becomes that sidebar (MainApp's `lg:w-[224px]`).
      */}
      <div className="flex">
        <div className="hidden lg:block w-[224px] shrink-0" />
        <div className="min-w-0 flex-1">
          <div data-content-box>
            <CourseLibrary
              courses={COURSES}
              authors={AUTHORS}
              categories={CATEGORIES}
              onSelectCourse={() => {}}
              completed={COMPLETED}
            />
          </div>
        </div>
      </div>

      <div data-nav className={navClass()}>
        <span style={{ display: 'inline-block', height: '44px' }} />
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the282-'));
  const file = path.join(dir, 'courses.html');
  writeFileSync(
    file,
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>${css}</style></head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
}, 180_000);

afterAll(async () => { await browser?.close(); });

/* ── measurement helpers ───────────────────────────────────────────────── */

/** Every control, every card, the nav and the page's scroll width, at one viewport. */
async function read(viewport: number, height?: number) {
  return browser.evaluateAt<{
    viewport: number;
    rem: number;
    pageScrollWidth: number;
    bodyScrollWidth: number;
    contentBox: Box;
    controls: (Box & { kind: string; pointerEvents: string })[];
    cards: (Box & { status: string })[];
    badges: (Box & { status: string; bg: string; color: string })[];
    ctas: (Box & { status: string; label: string })[];
    nav: Box & { position: string; zIndex: string };
    pills: { scrollWidth: number; clientWidth: number; overflowX: string };
  }>(viewport, `(() => {
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
    };
    const q = (s) => {
      const el = document.querySelector(s);
      if (!el) throw new Error(s + ' did not render');
      return el;
    };
    const nav = q('[data-nav]');
    const navCs = getComputedStyle(nav);
    const scroller = q('[data-category-pill]').parentElement;
    const scs = getComputedStyle(scroller);

    // Every TAPPABLE thing on this screen: the search box, the category pills
    // and each card's CTA. The card itself is a target too and is measured
    // with the cards below.
    const controls = [
      ...[...document.querySelectorAll('input[type=text]')].map((el) => ({ el, kind: 'search' })),
      ...[...document.querySelectorAll('[data-category-pill]')].map((el) => ({ el, kind: 'pill:' + el.dataset.categoryPill })),
      ...[...document.querySelectorAll('[data-course-cta]')].map((el) => ({ el, kind: 'cta:' + el.dataset.courseCta })),
    ].map(({ el, kind }) => ({ ...box(el), kind, pointerEvents: getComputedStyle(el).pointerEvents }));

    return {
      viewport: window.innerWidth,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      contentBox: box(q('[data-content-box]')),
      controls,
      cards: [...document.querySelectorAll('[data-course-card]')]
        .map((el) => ({ ...box(el), status: el.dataset.courseStatus })),
      badges: [...document.querySelectorAll('[data-course-status-badge]')].map((el) => {
        const cs = getComputedStyle(el);
        return { ...box(el), status: el.dataset.courseStatusBadge,
                 bg: cs.backgroundColor, color: cs.color };
      }),
      ctas: [...document.querySelectorAll('[data-course-cta]')]
        .map((el) => ({ ...box(el), status: el.dataset.courseCta, label: el.textContent.trim() })),
      nav: { ...box(nav), position: navCs.position, zIndex: navCs.zIndex },
      pills: { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth,
               overflowX: scs.overflowX },
    };
  })()`, height);
}

const measured = new Map<string, Awaited<ReturnType<typeof read>>>();
const at = async (viewport: number, height?: number) => {
  const key = `${viewport}x${height ?? 1200}`;
  if (!measured.has(key)) measured.set(key, await read(viewport, height));
  return measured.get(key)!;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 Every control is ≥44px at 380 / 768 / 1024 / 1280 / 1440
// ═══════════════════════════════════════════════════════════════════════════
describe('8 — every control is ≥44px at every width', () => {
  it.each(VIEWPORTS)('at %ipx, on both axes', async (viewport) => {
    const m = await at(viewport);
    expect(m.viewport, 'the viewport override did not take').toBe(viewport);
    expect(m.controls.length, 'no controls were collected').toBeGreaterThan(6);

    for (const c of m.controls) {
      expect(c.height, `${c.kind} is ${c.height}px tall at ${viewport}px`)
        .toBeGreaterThanOrEqual(TAP_TARGET_PX);
      expect(c.width, `${c.kind} is ${c.width}px wide at ${viewport}px`)
        .toBeGreaterThanOrEqual(TAP_TARGET_PX);
      expect(c.pointerEvents, `${c.kind} is not tappable`).not.toBe('none');
    }
  });

  it.each(VIEWPORTS)('the card itself is a tappable target at %ipx', async (viewport) => {
    const m = await at(viewport);
    expect(m.cards.length, 'no cards rendered').toBe(COURSES.length);
    for (const c of m.cards) {
      expect(c.height, `a ${c.status} card is ${c.height}px tall at ${viewport}px`)
        .toBeGreaterThanOrEqual(TAP_TARGET_PX);
    }
  });

  it('🔴 the desktop rem trim really is on, so the px in the classes are doing work', async () => {
    // Guards the guard. If the trim ever stopped applying, `h-11` would be 44px
    // everywhere and the tests above would pass for a reason that is not the
    // reason — so the trim is measured at the viewport where it starts.
    expect((await at(768)).rem, 'mobile should keep the 16px base').toBe(16);
    expect((await at(1024)).rem, 'the desktop rem trim is gone').toBe(14.5);
    expect((await at(1440)).rem).toBe(14.5);
  });

  it('🔴 a rem-named 44 would MISS on the desktop — which is why these are px', async () => {
    // `h-11` is 2.75rem. At the 14.5px desktop base that is 39.875px, under the
    // target. Measured rather than asserted in a comment.
    const remNamed = await browser.evaluateAt<number>(1440, `(() => {
      const el = document.createElement('div');
      el.style.height = '2.75rem';
      document.body.appendChild(el);
      const h = el.getBoundingClientRect().height;
      el.remove();
      return h;
    })()`);
    expect(remNamed).toBeLessThan(TAP_TARGET_PX);
    expect(remNamed).toBeCloseTo(39.875, 2);
  });

  it('🔴 the 44 is spelled literally in the source, not interpolated', async () => {
    // ⚠️ Tailwind scans source TEXT. `h-[${TAP_TARGET_PX}px]` emits no rule at
    // all and the control silently collapses to its variant default — which the
    // measurements above would then catch, but only after the fact. Pin it.
    expect(TAP_TARGET_PX).toBe(44);
    expect(src('src/components/course/CourseCard.tsx')).toContain('h-[44px] min-w-[44px]');
    expect(src('src/components/course/CourseLibrary.tsx')).toContain('h-[44px] min-w-[44px]');
    expect(src('src/components/course/CourseLibrary.tsx')).toContain('w-full h-[44px]');
    for (const file of ['src/components/course/CourseCard.tsx', 'src/components/course/CourseLibrary.tsx']) {
      // Comments stripped: the note warning about `h-[${…}px]` spells the trap
      // it warns about, and the warning must not fail the rule it documents.
      const code = src(file).replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|\/\/[^\n]*/g, '');
      expect(code, `${file} interpolates the tap target into a class`)
        .not.toMatch(/h-\[\$\{/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 No horizontal overflow at any of the five widths
// ═══════════════════════════════════════════════════════════════════════════
describe('9 — no horizontal overflow at any of the five widths', () => {
  it.each(VIEWPORTS)('at %ipx the page does not scroll sideways', async (viewport) => {
    const m = await at(viewport);
    expect(m.pageScrollWidth, `the document overflows by ${m.pageScrollWidth - viewport}px at ${viewport}px`)
      .toBeLessThanOrEqual(viewport);
    expect(m.bodyScrollWidth, `the body overflows at ${viewport}px`)
      .toBeLessThanOrEqual(viewport);
  });

  it.each(VIEWPORTS)('at %ipx no card, badge or CTA crosses the content box', async (viewport) => {
    const m = await at(viewport);
    const limit = m.contentBox.right + 0.5; // sub-pixel rounding
    for (const c of m.cards) {
      expect(c.right, `a ${c.status} card ends at ${c.right} past ${limit} at ${viewport}px`)
        .toBeLessThanOrEqual(limit);
      expect(c.x, `a ${c.status} card starts left of the content box at ${viewport}px`)
        .toBeGreaterThanOrEqual(m.contentBox.x - 0.5);
    }
    for (const b of [...m.badges, ...m.ctas]) {
      expect(b.right, `a ${b.status} chip ends at ${b.right} past ${limit} at ${viewport}px`)
        .toBeLessThanOrEqual(limit);
    }
  });

  it('the category row scrolls WITHIN itself rather than widening the page', async () => {
    // Six categories, one of them long, on a 380px phone: the row is meant to
    // overflow — inside its own scroller, which is why the page above does not.
    const m = await at(380);
    expect(m.pills.overflowX).toBe('auto');
    expect(m.pills.scrollWidth, 'the pill row no longer overflows, so this proves nothing')
      .toBeGreaterThan(m.pills.clientWidth);
    expect(m.pageScrollWidth).toBeLessThanOrEqual(380);
  });

  it('🔴 width is NOT monotonic — measured at all five, and it falls TWICE', async () => {
    const boxes: Record<number, number> = {};
    const cards: Record<number, number> = {};
    for (const v of VIEWPORTS) {
      const m = await at(v);
      boxes[v] = m.contentBox.width;
      cards[v] = m.cards[0].width;
    }

    /**
     * 🔴 THE RECORDED MEASUREMENT. The shell's content box grows monotonically;
     * the CARD does not, and it is the card that has to hold a 44px button.
     *
     *   viewport   content box   card
     *      380px       380.00    348.00
     *      768px       768.00    448.00   ← the widest card of the five
     *     1024px       800.00    361.94   ← `lg`: sidebar + 2 columns + rem trim
     *     1280px      1056.00    320.58   ← `xl`: 3 columns. The NARROWEST.
     *     1440px      1216.00    373.91
     *
     * Two cliffs, not one. At `lg` the shell takes a 224px sidebar, the grid
     * becomes `lg:grid-cols-2` and the rem base drops to 14.5px, so 1024px hands
     * a card 86px LESS than 768px does — the trap the ticket names. At `xl` the
     * grid becomes `lg:grid-cols-2 xl:grid-cols-3` and it falls again, which is
     * why the narrowest card of all five is at 1280px and not at 1024px.
     *
     * Recorded rather than corrected: every 44px and overflow assertion in this
     * file runs at all five widths, so the narrowest case is already proven to
     * hold. These numbers exist so a later change that narrows it further fails
     * here, with the arithmetic, instead of shipping.
     */
    expect(boxes[768]).toBe(768);
    expect(boxes[1024], 'the shell no longer takes a 224px sidebar at lg').toBe(800);
    expect(boxes[1024], 'the content box itself is monotonic').toBeGreaterThan(boxes[768]);

    // Cliff 1 — the one the ticket predicted: 1024 IS narrower than 768.
    expect(cards[1024], `1024 gives a card ${cards[1024]}px against 768's ${cards[768]}px`)
      .toBeLessThan(cards[768]);
    // Cliff 2 — the xl three-column step, narrower still.
    expect(cards[1280], 'the xl three-column step is gone').toBeLessThan(cards[1024]);
    // And then it recovers.
    expect(cards[1440]).toBeGreaterThan(cards[1280]);

    // The narrowest card of the five is at 1280px — including against the phone.
    const narrowest = Math.min(...VIEWPORTS.map((v) => cards[v]));
    expect(narrowest).toBe(cards[1280]);
    expect(cards[1280], 'a desktop card is now narrower than a 380px phone card')
      .toBeLessThan(cards[380]);
    // A floor, so "narrower still" fails loudly rather than silently.
    expect(cards[1280]).toBeGreaterThan(300);
  });

  it.each(VIEWPORTS)('at %ipx the CTA and the progress row fit inside their own card', async (viewport) => {
    /**
     * The inner question the page-level overflow check cannot ask: at 1280 the
     * card is only ~320px wide, and a 44px button beside a progress bar has to
     * fit within its own padding.
     *
     * ⚠️ Ownership is resolved with `closest()` IN THE PAGE, not by comparing
     * boxes here — in a two- and three-column grid several cards share a row, so
     * a geometric guess picks the wrong card and the check passes on the wrong
     * pair.
     */
    const rows = await browser.evaluateAt<{
      status: string; ctaLeft: number; ctaRight: number;
      cardLeft: number; cardRight: number; padLeft: number; padRight: number;
    }[]>(viewport, `[...document.querySelectorAll('[data-course-cta]')].map((cta) => {
      const card = cta.closest('[data-course-card]');
      if (!card) throw new Error('a CTA is not inside a card');
      const c = cta.getBoundingClientRect();
      const k = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      return { status: cta.dataset.courseCta, ctaLeft: c.left, ctaRight: c.right,
               cardLeft: k.left, cardRight: k.right,
               padLeft: parseFloat(cs.paddingLeft), padRight: parseFloat(cs.paddingRight) };
    })`);

    expect(rows.length, 'no CTAs were found').toBe(COURSES.length);
    for (const r of rows) {
      expect(r.ctaRight, `a ${r.status} CTA spills past its card's padding at ${viewport}px`)
        .toBeLessThanOrEqual(r.cardRight - r.padRight + 0.5);
      expect(r.ctaLeft).toBeGreaterThanOrEqual(r.cardLeft + r.padLeft - 0.5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 🔴 The last card clears the bottom nav at 380px
// ═══════════════════════════════════════════════════════════════════════════
describe('10 — the last card clears the bottom nav at 380px', () => {
  it('🔴 the nav is where the shell says it is', async () => {
    const m = await at(380, PHONE_HEIGHT);
    expect(m.nav.position).toBe('fixed');
    expect(m.nav.zIndex).toBe('100');
    expect(Math.round(m.nav.bottom), 'the nav is not anchored to the viewport bottom')
      .toBe(PHONE_HEIGHT);
    expect(m.nav.height, 'the nav has no height, so clearing it proves nothing')
      .toBeGreaterThan(0);
  });

  it('🔴 the last card ends above the nav, at a real phone height', async () => {
    const m = await at(380, PHONE_HEIGHT);
    const last = m.cards[m.cards.length - 1];
    // The page is scrolled to the very bottom, which is where a `fixed` nav can
    // actually cover content.
    const bottom = await browser.evaluateAt<{ cardBottom: number; navTop: number; scrolled: number }>(
      380,
      `(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const cards = [...document.querySelectorAll('[data-course-card]')];
        const card = cards[cards.length - 1].getBoundingClientRect();
        const nav = document.querySelector('[data-nav]').getBoundingClientRect();
        return { cardBottom: card.bottom, navTop: nav.top, scrolled: window.scrollY };
      })()`,
      PHONE_HEIGHT,
    );
    expect(bottom.scrolled, 'the page did not scroll, so the nav cannot be covering anything')
      .toBeGreaterThan(0);
    expect(bottom.cardBottom,
      `the last card ends at ${bottom.cardBottom}px, under a nav whose top is ${bottom.navTop}px`)
      .toBeLessThanOrEqual(bottom.navTop);
    expect(last.height).toBeGreaterThan(0);
  });

  it('the clearance comes from the container\'s own bottom padding', async () => {
    // `pb-24` on CourseLibrary's container. Named here so a later change that
    // removes it fails with the reason rather than with a bare number.
    expect(src('src/components/course/CourseLibrary.tsx')).toContain('pb-24');
    const pad = await browser.evaluateAt<number>(380, `(() => {
      const el = document.querySelector('[data-course-card]').closest('.pb-24');
      return el ? parseFloat(getComputedStyle(el).paddingBottom) : -1;
    })()`, PHONE_HEIGHT);
    const navHeight = (await at(380, PHONE_HEIGHT)).nav.height;
    expect(pad, 'the bottom padding is smaller than the nav it has to clear')
      .toBeGreaterThanOrEqual(navHeight);
  });

  it('at 768px — still a bottom bar — the last card clears it too', async () => {
    const bottom = await browser.evaluateAt<{ cardBottom: number; navTop: number }>(
      768,
      `(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const cards = [...document.querySelectorAll('[data-course-card]')];
        const card = cards[cards.length - 1].getBoundingClientRect();
        const nav = document.querySelector('[data-nav]').getBoundingClientRect();
        return { cardBottom: card.bottom, navTop: nav.top };
      })()`,
      PHONE_HEIGHT,
    );
    expect(bottom.cardBottom).toBeLessThanOrEqual(bottom.navTop);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · The badges and CTAs actually paint, and differ per status
// ═══════════════════════════════════════════════════════════════════════════
describe('11 — the three statuses are visually distinct in a real browser', () => {
  it('all three statuses are on screen at once', async () => {
    const m = await at(380);
    const statuses = new Set(m.badges.map((b) => b.status));
    expect([...statuses].sort()).toEqual(['done', 'not-started', 'ongoing']);
  });

  it('🔴 each status paints a different ground — the badge is not decoration only', async () => {
    const m = await at(380);
    const byStatus = new Map(m.badges.map((b) => [b.status, b.bg]));
    expect(byStatus.size).toBe(3);
    expect(new Set(byStatus.values()).size, 'two statuses paint the same ground').toBe(3);
    // And every one of them resolved — an unresolved token computes to
    // `rgba(0, 0, 0, 0)` and would be invisible.
    for (const [status, bg] of byStatus) {
      expect(bg, `the ${status} badge has no ground`).not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  it('the CTA label differs per status, in the rendered page', async () => {
    const m = await at(380);
    const labels = new Map(m.ctas.map((c) => [c.status, c.label]));
    expect(labels.get('not-started')).toBe('Start course');
    expect(labels.get('ongoing')).toBe('Continue');
    expect(labels.get('done')).toBe('Review');
  });
});
