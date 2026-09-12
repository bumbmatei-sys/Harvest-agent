// @vitest-environment node
//
// NODE, NOT happy-dom — the reason THE-356, THE-346, THE-331 and THE-320 each
// record: with a DOM environment selected, `MeasuringBrowser` never attaches
// (its CDP request is cross-origin under browser fetch semantics) and the suite
// times out. Nothing here needs a DOM: the rows are rendered to a string and
// every number is read out of a real Chromium over CDP.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * THE-358 — every row of the account menu, MEASURED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 WHY THIS IS MEASURED AND NOT READ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `happy-dom` has NO LAYOUT ENGINE: with the real compiled stylesheet injected,
 * `getBoundingClientRect()` answers zero on every element. So a source-only
 * version of this file would pass on a menu whose rows are too small to hit.
 *
 * It found a real defect. Before THE-358 every row in this menu measured:
 *
 *     380px: 40px     768px: 40px     1024 / 1280 / 1440px: 36.25px
 *
 * — under the 44px touch floor below `sm`, AND under Rule 4's 38px control
 * floor above it. `px-4 py-2.5` around `text-sm` is 40px, and globals.css trims
 * the rem base to 14.5px above 1024px, which takes the same row to 36.25px.
 * A dropdown row is a tap target, so the menu was brought to the floor in the
 * same change that added a row to it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 TRANSITIONS AND ANIMATIONS ARE SUPPRESSED IN THE MEASURED PAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `MeasuringBrowser.settle()` waits two animation frames (~32ms), well inside a
 * 150ms transition, so an un-suppressed page reports a value MID-FLIGHT.
 * THE-346 measured 7.7469px for a `min-h-[44px]` element, and #490 measured a
 * menu row at 41.79998779296875px — exactly 44 x 0.95, the first frame of
 * `zoom-in-95`, because `getBoundingClientRect()` reports the SCALED box. The
 * resting layout is the one a person sees.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE CLASS STRINGS ARE DISCOVERED, NOT RETYPED, AND NOT PINNED TO A LINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every row's class string is PARSED OUT of the shipped `MyAccountMenu.tsx` at
 * run time, by its `role="menuitem"`. THE-331's first draft named
 * `AdminCommunity.tsx:491`; a deletion moved that surface to `:311` and the
 * suite would have measured whatever landed there. A discovery that finds
 * fewer rows than the menu has THROWS here rather than measuring a default —
 * which is what stops this file going quietly green if the rows are renamed.
 */

const ROOT = path.resolve(__dirname, '../../..');
const MENU = 'src/components/MyAccountMenu.tsx';

/** The founder's phone, and the four widths above it. Width is NOT monotonic. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** Tailwind's `sm`. Below it the 44px touch floor applies; at and above, Rule 4. */
const SM_PX = 640;

/** The two floors, DIFFERENT NUMBERS ON PURPOSE — a desktop control is not a
 *  touch target, and `form-layout.ts` asserts `DENSITY_PX.control < 44`
 *  deliberately. A guard demanding 44px everywhere would contradict Rule 4. */
const TOUCH_FLOOR_PX = 44;
const DESKTOP_FLOOR_PX = 38;

/**
 * Every menu row's resolved class string, read out of the shipped source.
 *
 * The file builds its rows from shared `ROW` / `ROW_HOVER` constants, so the
 * `className` on each row is a template rather than a literal. Both are
 * resolved here from their own declarations — so shrinking either constant is
 * measured, which is the mutation this file exists to catch.
 */
function rowClassesFromSource(): { label: string; cls: string }[] {
  /* 🔴 COMMENTS OUT FIRST, through the PARSER-BASED stripper (#496), IMPORTED
     rather than copied — the regex stripper it replaced ate 154 lines of one
     file, 85 of them code. It is load-bearing here and not hygiene: the shared
     ROW constant's own docblock quotes `[role="menuitem"]` while explaining why
     `w-full` matters, and a raw scan matched that prose first and came back
     with no className at all. */
  const src = stripComments(readFileSync(path.join(ROOT, MENU), 'utf8'));

  const constant = (name: string): string => {
    const m = new RegExp(`const ${name} = \`?'?([^\`';]+)`).exec(src);
    expect(m, `${MENU} no longer declares ${name}`).not.toBeNull();
    return m![1].replace(/\$\{ROW\}/g, '').trim();
  };
  const ROW = constant('ROW');
  const ROW_HOVER = `${ROW} ${constant('ROW_HOVER')}`.replace(/\s+/g, ' ').trim();

  const out: { label: string; cls: string }[] = [];
  const re = /role="menuitem"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const after = src.slice(m.index, m.index + 1200);
    /* The whole of the `className=` LINE, then the wrapper stripped — each row
       writes its className on its own line, and a template literal like
       `{`${ROW} opacity-60`}` contains a `}` of its own, so a lazy match up to
       the first brace reads half of it and a greedy one runs past the element. */
    const cm = /className=([^\n]+)/.exec(after);
    expect(cm, 'a menu row has no className at all').not.toBeNull();
    const raw = cm![1].trim().replace(/^\{/, '').replace(/\}$/, '').trim();
    const cls = raw
      .replace(/`|"/g, '')
      .replace(/\$\{ROW_HOVER\}/g, ROW_HOVER)
      .replace(/\$\{ROW\}/g, ROW)
      .replace(/^ROW_HOVER$/, ROW_HOVER)
      .replace(/^ROW$/, ROW)
      .replace(/\s+/g, ' ')
      .trim();
    const lm = /<span[^>]*>([^<]+)<\/span>/.exec(after);
    out.push({ label: (lm?.[1] ?? `row ${out.length}`).replace(/&amp;/g, '&'), cls });
  }
  return out;
}

type Reading = { i: number; label: string; h: number }[];

/** Tailwind's `lg`. The "Go to User App" row is `lg:hidden` — the branded top
 *  bar carries an "Open member app" pill from here up, so showing the row too
 *  would double the entry point. A row that is not rendered is not a tap
 *  target, so the floors below govern the VISIBLE rows; that the hidden set is
 *  exactly this one row, at exactly these widths, is asserted separately rather
 *  than assumed — otherwise "filter out the zeroes" would silently excuse a row
 *  that collapsed by accident. */
const LG_PX = 1024;
const HIDDEN_ABOVE_LG = 'Go to User App';

const visibleAt = (v: number) => readings[v].filter((r) => r.h > 0);

let browser: MeasuringBrowser;
const rows = rowClassesFromSource();
const readings: Record<number, Reading> = {};

setUpOrFail(async () => {
  /* 🔴 A DISCOVERY THAT FINDS NOTHING MUST THROW, not measure a default. The
     menu has six rows; fewer means the parse broke or rows were deleted, and
     either way every number below would be about something else. */
  expect(rows.length, 'the row discovery found nothing to measure').toBeGreaterThanOrEqual(6);
  for (const r of rows) {
    expect(r.cls, `a row resolved to an empty class string: ${r.label}`).not.toBe('');
    expect(r.cls, `a row lost w-full: ${r.label}`).toMatch(/\bw-full\b/);
  }

  const css = await buildAppCss();
  /* The rows inside the real panel box — `w-60` and the panel's own chrome —
     so each row is measured at the width it actually gets. */
  const body =
    `<div class="w-60 bg-surface-raised rounded-2xl border border-line overflow-hidden">` +
    `<div class="py-1">` +
    rows.map((r, i) =>
      `<div data-row="${i}" class="${r.cls}">` +
      `<span class="text-sm font-medium text-body">${r.label}</span>` +
      `</div>`).join('') +
    `</div></div>`;

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the358-'));
  const file = path.join(dir, 'the-358.html');
  writeFileSync(
    file,
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8">` +
      `<style>${css}</style>` +
      // See the header: a transition animates min-height and `zoom-in-95`
      // scales the box, and getBoundingClientRect() reports the SCALED box.
      `<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>` +
      `</head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const v of VIEWPORTS) {
    readings[v] = await browser.evaluateAt<Reading>(v, `(() => Array.from(
      document.querySelectorAll('[data-row]')
    ).map((el) => ({
      i: Number(el.getAttribute('data-row')),
      label: el.textContent.trim(),
      h: el.getBoundingClientRect().height,
    })))()`);
  }
}, 240_000);

afterAll(async () => { await browser?.close(); });

/* ═══ 14 ═════════════════════════════════════════════════════════════════ */

describe('14 · every menu row clears the floor for its width', () => {
  it('\u{1F534} below sm, every row is at least 44px', () => {
    for (const v of VIEWPORTS.filter((w) => w < SM_PX)) {
      for (const row of visibleAt(v)) {
        expect(row.h, `"${row.label}" is ${row.h}px at ${v}px, under the ${TOUCH_FLOOR_PX}px touch floor`)
          .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      }
    }
  });

  it('\u{1F534} at and above sm, every row clears Rule 4’s 38px', () => {
    /* 38 rather than 44 above `sm` is what makes a legitimate control pass:
       `min-h-11` is 2.75rem, and globals.css trims the rem base to 14.5px above
       1024px, so a 44px phone row computes to 39.875px on a desktop. That is
       the token working, not a failure — the same figure THE-334 measured for
       this component's rail trigger. */
    for (const v of VIEWPORTS.filter((w) => w >= SM_PX)) {
      for (const row of visibleAt(v)) {
        expect(row.h, `"${row.label}" is ${row.h}px at ${v}px, under Rule 4's ${DESKTOP_FLOOR_PX}px floor`)
          .toBeGreaterThanOrEqual(DESKTOP_FLOOR_PX);
      }
    }
  });

  it('the Documentation row specifically, at every width', () => {
    // Named, because it is the row this ticket adds and the one a reader will
    // look for. It must be no shorter than its neighbours at any width.
    for (const v of VIEWPORTS) {
      const docs = readings[v].find((r) => r.label === 'Documentation');
      expect(docs, `no Documentation row was measured at ${v}px`).toBeDefined();
      const floor = v < SM_PX ? TOUCH_FLOOR_PX : DESKTOP_FLOOR_PX;
      expect(docs!.h, `Documentation is ${docs!.h}px at ${v}px`).toBeGreaterThanOrEqual(floor);
      const shortest = Math.min(...visibleAt(v).map((r) => r.h));
      expect(docs!.h, `Documentation is shorter than another row at ${v}px`).toBe(shortest);
    }
  });

  it('\u{1F534} the measurement is not vacuous — real boxes, and animation really is off', () => {
    /* Zero would pass none of the assertions above, but a page that failed to
       load its stylesheet could report a plausible-looking intrinsic height, and
       #490's 41.79998779296875px shows what an un-suppressed frame looks like.
       Both are excluded here: every row is a real box, and no row sits at the
       95% scale of the floor, which is the `zoom-in-95` signature. */
    for (const v of VIEWPORTS) {
      expect(readings[v].length, `nothing was measured at ${v}px`).toBe(rows.length);
      for (const row of visibleAt(v)) {
        expect(row.h, `"${row.label}" is at the zoom-in-95 first frame at ${v}px`)
          .not.toBeCloseTo(TOUCH_FLOOR_PX * 0.95, 2);
      }
      expect(visibleAt(v).length, `nothing laid out at ${v}px — the stylesheet did not load`)
        .toBeGreaterThanOrEqual(rows.length - 1);
    }
  });

  it('\u{1F534} the only row that is ever invisible is the one that means to be', () => {
    /* What makes `visibleAt` honest. Filtering zero-height rows out of a floor
       check would otherwise excuse ANY row that collapsed — so the hidden set is
       pinned: nothing is hidden below `lg`, and above it exactly the one
       `lg:hidden` row is, by name. */
    for (const v of VIEWPORTS) {
      const hidden = readings[v].filter((r) => r.h === 0).map((r) => r.label);
      if (v < LG_PX) {
        expect(hidden, `a row collapsed to zero at ${v}px, where none should`).toEqual([]);
      } else {
        expect(hidden, `the hidden set at ${v}px is not exactly the lg:hidden row`)
          .toEqual([HIDDEN_ABOVE_LG]);
      }
    }
  });

  it('every row is the SAME height at a given width, so none was left behind', () => {
    /* The floor was applied to a shared class string rather than row by row.
       This is what proves it: a row that opted out would be a different height
       and would fail here even if it happened to clear its own floor. */
    for (const v of VIEWPORTS) {
      const heights = [...new Set(visibleAt(v).map((r) => r.h))];
      expect(heights, `rows disagree on height at ${v}px: ${JSON.stringify(readings[v])}`)
        .toHaveLength(1);
    }
  });
});
