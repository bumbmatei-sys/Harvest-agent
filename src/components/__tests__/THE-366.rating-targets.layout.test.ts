// @vitest-environment node
//
// 🔴 THE `node` PRAGMA IS LOAD-BEARING. `happy-dom` has NO LAYOUT ENGINE —
// `getBoundingClientRect()` answers zeroes — so every number below is measured
// inside a real Chromium over CDP. With happy-dom selected `MeasuringBrowser`
// never attaches and the suite times out.
//
// ONE `MeasuringBrowser` PER PROCESS: two instances in one process collide.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCssForMarkup } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';

/**
 * THE-366 · 🔴 A FIVE-STAR ROW IS FIVE TAP TARGETS, AND EVERY ONE OF THEM IS
 * BIG ENOUGH — MEASURED.
 *
 * A row of five stars is the easiest thing in the product to ship too small:
 * one control, five separate targets, each one the size of a glyph unless
 * something makes it bigger. A 1-10 scale is ten of them. So the floor is
 * measured rather than read off the class string — `ui/button`'s intrinsic
 * sizes are 24 / 28 / 32 / 36px and EVERY one is below both floors (#500),
 * which is exactly how a control ends up looking fine and measuring 24px.
 *
 * 🔴 THE CLASS STRING IS DISCOVERED FROM THE SHIPPED SOURCE, NOT RETYPED.
 * THE-346 found this by mutation: a replica whose classes are hand-written in
 * the guard measures a fiction the moment the component drifts. `discover()`
 * pulls the exact literal out of `rating-scale.ts` and THROWS if it moved.
 *
 * 🔴 ANIMATION IS SUPPRESSED BEFORE MEASURING. #490 measured a `min-h-[44px]`
 * at 7.7469px mid-transition and the suite passed.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const LOGIC = 'src/components/forms/rating-scale.ts';
const CONTROL = 'src/components/forms/RatingScaleInput.tsx';
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** 380px is the narrow phone this repo measures at; 640px is Tailwind's `sm`
 *  breakpoint, where the floor steps down to rule 4's 38px. */
const BELOW_SM = [320, 380, 430] as const;
const SM_AND_UP = [640, 768, 1280] as const;
const VIEWPORTS = [...BELOW_SM, ...SM_AND_UP];

/** The floors, read from the shipped module rather than retyped here. */
const discoverFloors = (): { belowSm: number; smAndUp: number } => {
  const m = read(LOGIC).match(/export const TAP_TARGET = \{ belowSm: (\d+), smAndUp: (\d+) \}/);
  if (!m) throw new Error('TAP_TARGET moved in rating-scale.ts — this suite measures nothing');
  return { belowSm: Number(m[1]), smAndUp: Number(m[2]) };
};

/** The point's size classes, as the shipped module spells them. */
const discoverPointClasses = (): string => {
  const m = read(LOGIC).match(/export const POINT_SIZE_CLASSES =\s*\n?\s*'([^']+)';/);
  if (!m) throw new Error('POINT_SIZE_CLASSES moved in rating-scale.ts — this suite measures nothing');
  return m[1];
};

/** The rest of the point's className, as the shipped CONTROL spells it, so the
 *  replica cannot quietly diverge from what a respondent taps. */
const discoverPointShell = (): string => {
  const src = read(CONTROL);
  const m = src.match(/'(inline-flex items-center justify-center[^']*)' \+/);
  if (!m) throw new Error('the point className moved in RatingScaleInput.tsx');
  return m[1].trim();
};

const FLOORS = discoverFloors();
const POINT_CLASSES = discoverPointClasses();
const POINT_SHELL = discoverPointShell();

interface Box { w: number; h: number; x: number; right: number }
interface Reading {
  viewport: number;
  scrollWidth: number;
  rating: Box[];
  scale: Box[];
}

/** A replica of ONE point, wearing the discovered classes. */
const point = (group: string, label: string) =>
  `<button type="button" data-point="${group}" class="${POINT_SHELL} ${POINT_CLASSES} border-line text-muted">${label}</button>`;

/** The five-star row and the ten-point scale row, as the control lays them out
 *  — same `flex flex-wrap items-center gap-1` wrapper the component renders. */
const page = () =>
  `<div class="min-h-screen bg-surface-tint p-4">
     <div class="max-w-xl mx-auto space-y-5">
       <div>
         <label class="block text-sm font-medium text-body mb-1.5">How was the conference</label>
         <div class="flex flex-wrap items-center gap-1">
           ${[1, 2, 3, 4, 5].map((n) => point('rating', String(n))).join('')}
         </div>
       </div>
       <div>
         <label class="block text-sm font-medium text-body mb-1.5">How strongly do you agree</label>
         <div class="flex flex-wrap items-center gap-1">
           ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => point('scale', String(n))).join('')}
         </div>
       </div>
     </div>
   </div>`;

let browser: MeasuringBrowser | null = null;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const markup = page();
  const css = await buildCssForMarkup(markup);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the366-'));
  const file = path.join(dir, 'rating-targets.html');
  writeFileSync(
    file,
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">'
      + `<style>${css}</style>`
      // 🔴 SUPPRESS ANIMATION BEFORE MEASURING. See the header.
      + '<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>'
      + `</head><body>${markup}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const r = await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 10000) / 10000;
        const boxes = (group) => Array.from(document.querySelectorAll('[data-point="' + group + '"]'))
          .map((el) => {
            const b = el.getBoundingClientRect();
            return { w: round(b.width), h: round(b.height), x: round(b.x), right: round(b.right) };
          });
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          rating: boxes('rating'),
          scale: boxes('scale'),
        };
      })()`,
    );
    readings.set(viewport, r);
  }
}, 120_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v} — the browser did not measure it`);
  return r;
};

describe('the measured surface is the shipped one', () => {
  it('🔴 the classes came out of the shipped module, not out of this file', () => {
    expect(read(LOGIC), 'POINT_SIZE_CLASSES drifted away from the measured copy')
      .toContain(POINT_CLASSES);
    expect(read(CONTROL), 'the point shell drifted away from the measured copy')
      .toContain(POINT_SHELL);
    expect(read(CONTROL), 'the control stopped wearing the discovered size classes')
      .toContain('const POINT_SIZE = POINT_SIZE_CLASSES;');
  });

  it('and the row is measured as five and ten real targets', () => {
    expect(at(380).rating, 'the star row is not five targets').toHaveLength(5);
    expect(at(380).scale, 'the scale row is not ten targets').toHaveLength(10);
  });

  it('🔴 nothing here is pinned to a line number', () => {
    const self = read('src/components/__tests__/THE-366.rating-targets.layout.test.ts');
    expect(self.match(/\.tsx?:\d+/g) ?? [], 'a line number was pinned').toEqual([]);
  });
});

describe('🔴 a five-star row is >= 44px per target below sm — measured', () => {
  it.each(BELOW_SM)('at %ipx every star is at least the below-sm floor', (v) => {
    for (const [i, b] of at(v).rating.entries()) {
      expect(b.w, `star ${i + 1} is ${b.w}px wide at ${v}px`).toBeGreaterThanOrEqual(FLOORS.belowSm);
      expect(b.h, `star ${i + 1} is ${b.h}px tall at ${v}px`).toBeGreaterThanOrEqual(FLOORS.belowSm);
    }
  });

  it.each(BELOW_SM)('at %ipx every scale point is at least the below-sm floor too', (v) => {
    for (const [i, b] of at(v).scale.entries()) {
      expect(b.w, `point ${i + 1} is ${b.w}px wide at ${v}px`).toBeGreaterThanOrEqual(FLOORS.belowSm);
      expect(b.h, `point ${i + 1} is ${b.h}px tall at ${v}px`).toBeGreaterThanOrEqual(FLOORS.belowSm);
    }
  });

  it.each(SM_AND_UP)("at %ipx every target still clears rule 4's floor", (v) => {
    for (const group of ['rating', 'scale'] as const) {
      for (const [i, b] of at(v)[group].entries()) {
        expect(b.w, `${group} ${i + 1} is ${b.w}px wide at ${v}px`).toBeGreaterThanOrEqual(FLOORS.smAndUp);
        expect(b.h, `${group} ${i + 1} is ${b.h}px tall at ${v}px`).toBeGreaterThanOrEqual(FLOORS.smAndUp);
      }
    }
  });

  it('🔴 the measurement is real — a target reports a size, not a zero', () => {
    // The mutation this survives: happy-dom answers 0 for every box, so a
    // `>= 44` assertion over zeroes would fail, but a `<= ` one would pass. This
    // says the numbers are positive and finite before anything is concluded.
    for (const v of VIEWPORTS) {
      for (const b of [...at(v).rating, ...at(v).scale]) {
        expect(Number.isFinite(b.w) && b.w > 0, `a box measured ${b.w} at ${v}px`).toBe(true);
      }
    }
  });
});

describe('neither row pushes the page sideways', () => {
  it.each(VIEWPORTS)('at %ipx the document does not scroll horizontally', (v) => {
    const r = at(v);
    expect(r.scrollWidth, `the page overflows by ${r.scrollWidth - r.viewport}px at ${v}px`)
      .toBeLessThanOrEqual(r.viewport);
  });

  it('🔴 a ten-point row WRAPS on a narrow phone rather than overflowing', () => {
    // Ten 44px targets plus gaps cannot fit 320px on one line, so the row must
    // wrap. If it did not, the assertion above would be the one that fired.
    const rows = new Set(at(320).scale.map((b) => Math.round(b.x)));
    expect(rows.size, 'every point sits at the same x — the row did not lay out').toBeGreaterThan(1);
    const lines = new Set(at(320).scale.map((b) => Math.round(b.right - b.w)));
    expect(lines.size).toBeGreaterThan(1);
  });
});
