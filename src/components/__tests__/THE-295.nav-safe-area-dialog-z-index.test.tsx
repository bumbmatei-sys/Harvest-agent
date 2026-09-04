// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing. Every question below is a
// LAYOUT or a CASCADE question, and happy-dom can answer neither: with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns all zeros and
// `getComputedStyle(el).display` answers `block` for a flex container (measured
// in THE-276's post-mortem, not assumed). Under the repo's default happy-dom
// environment the globals are also replaced with browser-semantics ones, and a
// request to the measuring browser's own debugger port then fails same-origin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAppCss, buildCssForMarkup } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-295 — the nav's safe-area inset, and the layer dialogs open on
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── Defect 1: `pb-safe` was not a utility this repo defines ────────────────
 *
 * The member bottom nav carried `pb-safe lg:pb-0`. 🔴 `pb-safe` COMPILES TO NO
 * CSS AT ALL — it is not defined in tailwind.config.ts, not defined in
 * globals.css, and Tailwind mints no rule for it. THE-286 found this while
 * measuring a settings slice and reported it rather than fixing it, because
 * raising the app shell from a settings diff would have made that diff
 * unreviewable. So the nav reserved NO home-indicator inset, and on a notched
 * phone its bottom row of icons sat inside the gesture area.
 *
 * ⚠️ THE METHOD MATTERS MORE THAN THE FINDING. A class that emits nothing is
 * the whole bug, so a test asserting the CLASS NAME is present proves exactly
 * nothing — it is what let the defect live this long. Every assertion here goes
 * through the COMPILED STYLESHEET, and the geometric ones go through a real
 * Chromium over CDP.
 *
 * ─── How a notch is simulated ───────────────────────────────────────────────
 *
 * `env(safe-area-inset-bottom)` is 0 in a headless browser: there is no notch,
 * and no CDP command mints one. So the app's real stylesheet is compiled ONCE
 * and then rendered into TWO pages — one as-is (a flat phone, inset 0) and one
 * with every `env(safe-area-inset-bottom)` textually replaced by 34px (an
 * iPhone 14/15 home indicator). The difference between the two IS the reserved
 * inset, measured rather than asserted.
 *
 * 🔴 This is what makes the guard mutation-proof. Put `pb-safe` back and the
 * substitution has nothing to bite on: the notched page measures identical to
 * the flat one, the reserved inset is 0, and test 1 fails. A guard that only
 * looked for the string `pb-safe` would pass on the bug.
 *
 * ─── Defect 2: the primitives shipped below the nav ─────────────────────────
 *
 * `ui/dialog.tsx` and `ui/sheet.tsx` shipped at the shadcn default `z-50`, for
 * scrim AND panel. The nav is `z-[100]`. Nothing mounted one, so nothing was
 * visibly broken — but the next screen to open one on a phone would have got a
 * navigation bar painted through its dialog. Raised to #427's existing
 * layering: scrim `z-[101]`, panel `z-[102]`.
 *
 * ─── The rem trap, and why every number here is in px ───────────────────────
 *
 * globals.css trims the rem base to 14.5px from 1024px up, so a rem-named size
 * renders 9.4% smaller than its name on a desktop — `h-11` is 44 by name and
 * 39.875px on a monitor. Every load-bearing dimension below is therefore in px
 * and measured at all five widths rather than reasoned about: width is NOT
 * monotonic in this shell (#429 measured it FALLING at 1024; #426 measured a
 * card falling twice, narrowest at 1280).
 */

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** ⚠️ Width is not monotonic in this shell — every one of these is measured. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** iPhone 14/15 logical height. The questions here are about the viewport's
 *  BOTTOM, and the harness's 1200px default is no phone. */
const PHONE_HEIGHT = 844;

/** An iPhone 14/15 home indicator, in CSS px. */
const SAFE_INSET_PX = 34;

/** The touch floor. Not negotiable below `sm`. */
const TOUCH_TARGET_MIN_PX = 44;

/** The layer the bottom nav paints on. */
const NAV_Z = 100;

/**
 * The member shell's bottom nav classes, READ FROM THE SHELL — never a
 * hand-typed copy of a nav that may since have moved.
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
  return match[1];
}

/** The nav class with its template holes filled for a given state. */
function navClassIn(state: 'visible' | 'hidden'): string {
  return navClass()
    .replace(/\$\{isSidebarCollapsed \? '[^']*' : '([^']*)'\}/g, '$1')
    .replace(/\$\{[^}]*\}/g, state === 'visible' ? 'max-lg:translate-y-0' : 'max-lg:translate-y-full');
}

/** The `padding-bottom` utility the nav actually carries, whatever it is
 *  spelled. Read off the live class list rather than assumed, so this keeps
 *  working if the exact arbitrary value is ever retuned. */
function navPaddingBottomClass(): string {
  const cls = navClassIn('visible').split(/\s+/);
  const pb = cls.filter((c) => /^pb-/.test(c) && !c.includes(':'));
  expect(pb, 'the nav carries no unprefixed padding-bottom utility at all').toHaveLength(1);
  return pb[0];
}

/** A string literal out of a primitive's `cn(...)` call, by a marker it holds. */
function primitiveClass(rel: string, marker: string): string {
  const text = src(rel);
  const found = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1])
    .filter((s) => s.includes(marker) && s.includes('fixed'));
  if (found.length !== 1) {
    throw new Error(`${rel}: ${found.length} class literals carry ${marker}, expected exactly 1`);
  }
  return found[0];
}

interface Box { x: number; y: number; width: number; height: number; top: number; bottom: number }

/**
 * 🔴 ONE BROWSER AT A TIME, and this is load-bearing.
 *
 * `MeasuringBrowser` derives its debugger port from the PID
 * (`9222 + process.pid % 900`), so two instances alive in the same process
 * collide on it: the second either fails to bind or attaches to the first, and
 * every cross-page comparison then silently compares a page with itself. So the
 * FLAT profile is measured up front into a plain snapshot and its browser is
 * closed before the NOTCHED one opens. The comparisons below are then data
 * against data, which is also why they cannot accidentally compare like with
 * like.
 */
let notched: MeasuringBrowser;
let appCss = '';

/** Every flat-profile box this file compares against, keyed `sel@viewport`. */
const FLAT = new Map<string, Box>();

/** The nav, with `count` 44px tab buttons in it — the real class, real markup. */
function navMarkup(state: 'visible' | 'hidden', count: number, id: string): string {
  const buttons = Array.from({ length: count }, (_, i) =>
    `<button data-tab class="flex flex-col items-center justify-center min-h-[44px] min-w-[44px] px-2">` +
    `<span class="w-6 h-6"></span><span class="text-[10px]">T${i}</span></button>`).join('');
  return (
    `<div data-nav="${id}" class="${navClassIn(state)}">` +
    `<div class="flex lg:flex-col justify-around lg:justify-start items-center w-full">${buttons}</div>` +
    `</div>`
  );
}

function page(css: string): string {
  // Every nav state and tab count this file asks about, on one page, each in
  // its own stacking-context-free wrapper so `fixed` really is viewport-fixed.
  const navs = [
    navMarkup('visible', 5, 'visible-5'),
    navMarkup('hidden', 5, 'hidden-5'),
    navMarkup('visible', 2, 'visible-2'),
    navMarkup('visible', 3, 'visible-3'),
    navMarkup('visible', 4, 'visible-4'),
  ].join('');

  // A scrolling page whose LAST element has to remain reachable above the nav.
  const content =
    `<div data-content class="min-h-screen">` +
    `<div style="height:2400px"></div>` +
    `<div data-last class="h-[44px]">last row</div>` +
    `</div>`;

  // The two primitives, at the class strings they really ship, plus the two
  // surfaces that already layered correctly.
  const layers =
    `<div data-dialog-overlay class="${primitiveClass('src/components/ui/dialog.tsx', 'inset-0')}"></div>` +
    `<div data-dialog-content class="${primitiveClass('src/components/ui/dialog.tsx', 'top-1/2')}">d</div>` +
    `<div data-sheet-overlay class="${primitiveClass('src/components/ui/sheet.tsx', 'inset-0')}"></div>` +
    `<div data-sheet-content class="${primitiveClass('src/components/ui/sheet.tsx', 'flex flex-col')}" data-side="bottom">s</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>` +
         `<body>${content}${navs}${layers}</body></html>`;
}

/** The app stylesheet with a real notch substituted in for the env() query. */
function withNotch(css: string): string {
  const out = css.replace(/env\(safe-area-inset-bottom(?:,\s*[^)]*)?\)/g, `${SAFE_INSET_PX}px`);
  // 🔴 If the substitution finds nothing, the notched page IS the flat page and
  // every "reserves the inset" assertion below would compare a number with
  // itself and pass. Fail here instead, loudly.
  if (out === css) {
    throw new Error(
      'no env(safe-area-inset-bottom) survives in the compiled stylesheet — the notched ' +
      'profile would be identical to the flat one and this whole file would measure nothing.',
    );
  }
  return out;
}

async function launch(css: string, name: string): Promise<MeasuringBrowser> {
  const dir = mkdtempSync(path.join(os.tmpdir(), `the295-${name}-`));
  const file = path.join(dir, 'shell.html');
  writeFileSync(file, page(css));
  const b = new MeasuringBrowser();
  await b.open(`file://${file}`);
  return b;
}

/** The selectors and viewports the flat profile is snapshotted at. */
const FLAT_SELECTORS = [
  '[data-nav="visible-5"]',
  '[data-nav="visible-2"]',
  '[data-nav="visible-3"]',
  '[data-nav="visible-4"]',
  '[data-nav="visible-5"] [data-tab]',
] as const;

const key = (sel: string, vw: number) => `${sel}@${vw}`;

beforeAll(async () => {
  appCss = await buildAppCss();

  const flat = await launch(appCss, 'flat');
  try {
    for (const vw of VIEWPORTS) {
      const h = vw >= 1024 ? 900 : PHONE_HEIGHT;
      for (const sel of FLAT_SELECTORS) {
        FLAT.set(key(sel, vw), await boxOf(flat, sel, vw, h));
      }
    }
  } finally {
    await flat.close();
  }

  notched = await launch(withNotch(appCss), 'notched');
}, 600_000);

afterAll(async () => {
  await notched?.close();
});

/** The flat-profile box for a selector, or a failure naming what was missed. */
function flatBox(sel: string, vw: number): Box {
  const box = FLAT.get(key(sel, vw));
  if (!box) throw new Error(`no flat snapshot for ${sel} at ${vw}px — add it to FLAT_SELECTORS`);
  return box;
}

/**
 * 🔴 THE NAV ANIMATES, AND A MEASUREMENT TAKEN TOO EARLY IS A LIE.
 *
 * The nav carries `transition-all duration-300`, so every property this file
 * measures — width, height, the translate that hides it — is mid-flight for
 * 300ms after a viewport change. Measured, not assumed: at 1024px the rail
 * reads 1018.23px immediately after the resize and 224px once the transition
 * lands. The early number is not noise, it is the START of the animation, and
 * it is stable enough to have been mistaken for a layout fact.
 *
 * So every evaluation here waits the transition out first. `evaluateAt` passes
 * `awaitPromise`, so an async IIFE is awaited properly.
 */
const SETTLE_MS = 450;
const settled = (body: string) => `(async () => {
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, ${SETTLE_MS})));
  ${body}
})()`;

const boxOf = (b: MeasuringBrowser, sel: string, vw: number, h = PHONE_HEIGHT) =>
  b.evaluateAt<Box>(vw, settled(`
    const r = document.querySelector('${sel}').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom };
  `), h);

/** Long enough for the transition wait above, at every viewport a test visits. */
const MEASURE_TIMEOUT = 60_000;

// ═════════════════════════════════════════════════════════════════════════════
// 1. The bottom nav reserves the safe-area inset.
// ═════════════════════════════════════════════════════════════════════════════
describe('1 · the bottom nav reserves the safe-area inset', () => {
  it('🔴 the nav\'s padding-bottom class emits a real rule, against the COMPILED stylesheet', async () => {
    // ⚠️ THE-286's method, and the whole point of this ticket. `pb-safe` was
    // present in the class list for months and emitted nothing; asserting the
    // class name would have passed throughout. So the class is compiled and
    // the RULE is read back.
    const cls = navPaddingBottomClass();
    const css = await buildCssForMarkup(`<div class="${cls}"></div>`);
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`\\.${escaped.replace(/([:[\]()+])/g, '\\\\$1')}\\s*\\{([^}]*)\\}`);
    const match = rule.exec(css);
    expect(
      match,
      `${cls} emits NO CSS at all — this is exactly the pb-safe defect, in a new spelling`,
    ).not.toBeNull();
    expect(match![1], `${cls} emits a rule that is not a padding-bottom`).toContain('padding-bottom');
    expect(
      match![1],
      `${cls} sets a padding-bottom that does not consult the safe-area inset`,
    ).toContain('env(safe-area-inset-bottom)');
  }, MEASURE_TIMEOUT);

  it('🔴 and the nav is MEASURABLY taller on a notched profile — the fix, in pixels', async () => {
    const before = flatBox('[data-nav="visible-5"]', 380);
    const after = await boxOf(notched, '[data-nav="visible-5"]', 380);
    expect(
      after.height - before.height,
      'the nav reserved NO safe-area inset — it is the same height with a notch as without',
    ).toBeCloseTo(SAFE_INSET_PX, 1);
    // And it grows UPWARD: a `bottom-0` bar still ends at the viewport bottom.
    expect(after.bottom).toBeCloseTo(before.bottom, 1);
    expect(after.top).toBeCloseTo(before.top - SAFE_INSET_PX, 1);
  }, MEASURE_TIMEOUT);

  it('keeps the 8px of `py-2` it already painted, on top of the inset', async () => {
    // The inset REPLACES nothing. A nav that reserved the notch by giving up
    // its own padding would put the icons flush against the home indicator.
    const nav = await boxOf(notched, '[data-nav="visible-5"]', 380);
    const tab = await boxOf(notched, '[data-nav="visible-5"] [data-tab]', 380);
    expect(
      nav.bottom - tab.bottom,
      'the nav stopped clearing its own 8px above the home indicator',
    ).toBeCloseTo(8 + SAFE_INSET_PX, 0);
  }, MEASURE_TIMEOUT);

  it('and desktop is untouched — `lg:pb-0` still wins from 1024px up', async () => {
    for (const vw of [1024, 1280, 1440] as const) {
      // ⚠️ The SAME harness height the flat snapshot was taken at. The rail is
      // `lg:h-screen`, so a different viewport height is a different nav height
      // and the comparison would report a notch that is really a harness
      // mismatch.
      const before = flatBox('[data-nav="visible-5"]', vw);
      const after = await boxOf(notched, '[data-nav="visible-5"]', vw, 900);
      expect(after.height, `the sidebar gained a safe-area inset at ${vw}px`)
        .toBeCloseTo(before.height, 1);
    }
  }, MEASURE_TIMEOUT);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. The sweep.
// ═════════════════════════════════════════════════════════════════════════════
describe('2 · every use of pb-safe is accounted for', () => {
  /** Every file under src/ that spells the inert class, excluding this one. */
  function usesPbSafe(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css|json)$/.test(p) && readFileSync(p, 'utf8').includes('pb-safe')) {
          out.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    return out.filter((f) => !f.endsWith('THE-295.nav-safe-area-dialog-z-index.test.tsx')).sort();
  }

  it('🔴 the class is gone from the member shell, which is what this ticket owns', () => {
    expect(
      src('src/components/MainApp.tsx'),
      'MainApp went back to the inert pb-safe',
    ).not.toContain('pb-safe');
  });

  it('names every remaining use, and each is a surface THIS ticket deliberately did not widen into', () => {
    // 🔴 ENUMERATED, not counted. The sweep is the deliverable: `pb-safe` is
    // inert everywhere it appears, and this ticket fixed the ONE surface it
    // owns. Each entry below is named with what it is, so the next ticket to
    // touch that surface inherits the finding rather than rediscovering it.
    //
    //   · AdminDashboard.tsx  — the ADMIN shell's bottom nav. The same defect,
    //     one shell over. Not fixed here: it is a different shell with its own
    //     screens to re-measure, it sits under THE-290's byte-identity guard,
    //     and widening this diff into it is what THE-286 correctly refused to
    //     do one level down. THE-279's and THE-286's clearance budgets both add
    //     the inset THEMSELVES and say in as many words that they are correct
    //     whether or not `pb-safe` ever resolves, so nothing there is broken by
    //     leaving it — it simply is not yet fixed.
    //   · GivingShareSheet.tsx — a share sheet that reaches for the same inert
    //     class. THE-281 owns it and its test asserts the string directly.
    //   · the tests and the fixture below record one of those two.
    expect(usesPbSafe()).toEqual([
      // ── The two LIVE surfaces that still carry the inert class ──────────
      // · AdminDashboard.tsx — the ADMIN shell's bottom nav. The same defect,
      //   one shell over. Not fixed here: it is a different shell with its own
      //   screens to re-measure, it sits under THE-290's byte-identity guard,
      //   and widening this diff into it is exactly what THE-286 correctly
      //   refused to do one level down. Nothing there is BROKEN by leaving it —
      //   THE-279's and THE-286's clearance budgets both add the inset
      //   themselves and say in as many words that they hold whether or not
      //   `pb-safe` ever resolves — it simply is not yet fixed.
      // · GivingShareSheet.tsx — a share sheet reaching for the same inert
      //   class. THE-281 owns it and its guard asserts the string directly.
      'src/components/AdminDashboard.tsx',
      // ── Guards, fixtures and prose that NAME it: the paper trail, not a use ──
      // ⚠️ None of these applies the class to anything. They describe it —
      // several of them describing it as broken, which is the point: THE-286,
      // THE-294, THE-296 and THE-298 each rediscovered independently that
      // `pb-safe` compiles to nothing, and each worked around it locally rather
      // than fixing the shell. THE-296's guard even asserts its own sections do
      // NOT depend on the class. That is four tickets paying the same tax, and
      // it is the argument for fixing the nav itself rather than once more per
      // screen.
      // ⚠️ dashboard/GivingTab and dashboard/PledgeFulfilment only mention it in
      // a comment describing the admin nav they sit under. THE-294 owns those
      // two files and this ticket does not open them.
      'src/components/__tests__/MemberScreens.desktop-layout.test.tsx',
      'src/components/__tests__/THE-279.toolbar-layout.test.tsx',
      'src/components/__tests__/THE-286.settings-chrome-autosave.layout.test.tsx',
      'src/components/__tests__/THE-296.settings-sections.layout.test.tsx',
      'src/components/__tests__/THE-296.settings-sections.test.tsx',
      'src/components/__tests__/THE-298.form-answers-layout.test.tsx',
      'src/components/__tests__/__fixtures__/member-screens-mobile.json',
      'src/components/__tests__/the-281-giving-share.test.tsx',
      'src/components/__tests__/the-290-giving-layout.test.tsx',
      'src/components/__tests__/the-294-engagement-layout.test.tsx',
      'src/components/course/__tests__/THE-282.course-cards-layout.test.tsx',
      'src/components/dashboard/GivingTab.tsx',
      'src/components/dashboard/PledgeFulfilment.tsx',
      'src/components/donations/GivingShareSheet.tsx',
      'src/components/settings/GivingStatementsSection.tsx',
    ]);
  });

  it('🔴 and pb-safe STILL compiles to nothing, so every remaining use is still inert', async () => {
    // The alternative fix shape was to DEFINE `pb-safe` in the theme. It was
    // not taken — see the report — and this pins that it was not taken
    // accidentally-halfway: if a later ticket defines the utility, this fails
    // and the sweep above has to be re-read, because defining it would silently
    // change the height of the admin nav and the share sheet at the same time.
    const css = await buildCssForMarkup('<div class="pb-safe"></div>');
    expect(css, 'pb-safe now emits CSS — re-read the sweep above before shipping')
      .not.toMatch(/\.pb-safe\s*\{/);
  }, MEASURE_TIMEOUT);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Clearance, in both nav states.
// ═════════════════════════════════════════════════════════════════════════════
describe('3 · content clears the nav at 380px in BOTH nav states', () => {
  it('the nav is on screen when visible, and fully off it when hidden-on-scroll', async () => {
    const visible = await boxOf(notched, '[data-nav="visible-5"]', 380);
    const hidden = await boxOf(notched, '[data-nav="hidden-5"]', 380);
    expect(visible.bottom, 'the visible nav is not anchored to the viewport bottom')
      .toBeCloseTo(PHONE_HEIGHT, 0);
    // `max-lg:translate-y-full` moves it down by exactly its own height.
    expect(hidden.top, 'the hidden nav did not translate clear of the viewport')
      .toBeGreaterThanOrEqual(PHONE_HEIGHT - 1);
  }, MEASURE_TIMEOUT);

  it('🔴 the nav never eats the viewport bottom in either state', async () => {
    // The clearance question, asked of the thing that actually varies: the top
    // of the nav is where content has to stop. With the notch reserved that
    // line moves UP by the inset, and a screen that scrolls to its bottom has
    // to respect the new line, not the old one.
    const flatNav = flatBox('[data-nav="visible-5"]', 380);
    const notchedNav = await boxOf(notched, '[data-nav="visible-5"]', 380);
    expect(
      notchedNav.top,
      'the clearance line did not move up with the notch — content will sit under the nav',
    ).toBeLessThan(flatNav.top);
    expect(notchedNav.top).toBeCloseTo(flatNav.top - SAFE_INSET_PX, 1);
  }, MEASURE_TIMEOUT);

  it('and the hidden state gives the whole viewport back', async () => {
    const hidden = await boxOf(notched, '[data-nav="hidden-5"]', 380);
    expect(hidden.top).toBeGreaterThanOrEqual(PHONE_HEIGHT - 1);
  }, MEASURE_TIMEOUT);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Tab count is tenant-dependent.
// ═════════════════════════════════════════════════════════════════════════════
describe('4 · clearance holds with 2, 3 and 4 bottom tabs', () => {
  it('🔴 the reserved inset is the same whatever the tab count', async () => {
    // ⚠️ `chat` needs `features?.aiChat` and `map` needs `features?.map`, and
    // `aiChat` is false on all four tiers since THE-253 — add-on only. So the
    // count really does vary per tenant and a fixed number must not be assumed.
    for (const count of [2, 3, 4] as const) {
      const before = flatBox(`[data-nav="visible-${count}"]`, 380);
      const after = await boxOf(notched, `[data-nav="visible-${count}"]`, 380);
      expect(after.height - before.height, `${count} tabs: the inset was not reserved`)
        .toBeCloseTo(SAFE_INSET_PX, 1);
      expect(after.bottom, `${count} tabs: the nav left the viewport bottom`)
        .toBeCloseTo(PHONE_HEIGHT, 0);
    }
  }, MEASURE_TIMEOUT);

  it('and the nav is exactly as tall as its content plus the inset, at every count', async () => {
    const heights: number[] = [];
    for (const count of [2, 3, 4, 5] as const) {
      const nav = await boxOf(notched, `[data-nav="visible-${count}"]`, 380);
      heights.push(nav.height);
    }
    // A row of equal-height 44px targets: the count changes the WIDTH each tab
    // gets, never the bar's height. A height that moved with the count would
    // mean a tab wrapped, and the clearance budget below it would be wrong.
    expect(new Set(heights.map((h) => Math.round(h))).size,
      'the nav height changes with the tab count — a tab is wrapping').toBe(1);
  }, MEASURE_TIMEOUT);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. The primitives.
// ═════════════════════════════════════════════════════════════════════════════
describe('5 · dialog and sheet render above z-100', () => {
  const LAYERS = [
    ['[data-dialog-overlay]', 'the dialog scrim'],
    ['[data-dialog-content]', 'the dialog panel'],
    ['[data-sheet-overlay]', 'the sheet scrim'],
    ['[data-sheet-content]', 'the sheet panel'],
  ] as const;

  it('🔴 every one of the four paints strictly above the nav — MEASURED, not read', async () => {
    const z = await notched.evaluateAt<Record<string, number>>(380, settled(`
      const out = {};
      for (const sel of ${JSON.stringify(LAYERS.map(([s]) => s))}) {
        out[sel] = Number(getComputedStyle(document.querySelector(sel)).zIndex);
      }
      out.nav = Number(getComputedStyle(document.querySelector('[data-nav="visible-5"]')).zIndex);
      return out;
    `), PHONE_HEIGHT);

    expect(z.nav, 'the bottom nav left z-100').toBe(NAV_Z);
    for (const [sel, label] of LAYERS) {
      expect(z[sel], `${label} did not resolve a numeric z-index at all`).not.toBeNaN();
      // 🔴 Strictly above. A dialog at or under the nav's layer is a dialog
      // with a navigation bar painted through it.
      expect(z[sel], `${label} no longer clears the bottom nav`).toBeGreaterThan(NAV_Z);
    }
  }, MEASURE_TIMEOUT);

  it('and the panel sits above its own scrim, so the scrim never veils the dialog', async () => {
    const z = await notched.evaluateAt<Record<string, number>>(380, settled(`
      const n = (s) => Number(getComputedStyle(document.querySelector(s)).zIndex);
      return { do: n('[data-dialog-overlay]'), dc: n('[data-dialog-content]'),
               so: n('[data-sheet-overlay]'), sc: n('[data-sheet-content]') };
    `), PHONE_HEIGHT);
    expect(z.dc, 'the dialog panel fell to or below its scrim').toBeGreaterThan(z.do);
    expect(z.sc, 'the sheet panel fell to or below its scrim').toBeGreaterThan(z.so);
  }, MEASURE_TIMEOUT);

  it('the scrim covers the nav geometrically, not merely numerically', async () => {
    for (const sel of ['[data-dialog-overlay]', '[data-sheet-overlay]'] as const) {
      const covers = await notched.evaluateAt<boolean>(380, settled(`
        const nav = document.querySelector('[data-nav="visible-5"]').getBoundingClientRect();
        const s = document.querySelector('${sel}').getBoundingClientRect();
        return s.top <= nav.top && s.bottom >= nav.bottom && s.left <= nav.left && s.right >= nav.right;
      `), PHONE_HEIGHT);
      expect(covers, `${sel} does not span the nav it is supposed to sit over`).toBe(true);
    }
  }, MEASURE_TIMEOUT);

  it('🔴 neither primitive still ships the shadcn z-50 default', () => {
    // The source-level half of the same claim, so a regression that reinstates
    // z-50 fails HERE with a name rather than only as a number three tests up.
    for (const rel of ['src/components/ui/dialog.tsx', 'src/components/ui/sheet.tsx']) {
      expect(src(rel), `${rel} fell back to z-50, under the nav`).not.toContain('z-50');
      expect(src(rel), `${rel} lost its scrim layer`).toContain('z-[101]');
      expect(src(rel), `${rel} lost its panel layer`).toContain('z-[102]');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. No-regression on the surfaces that already layered correctly.
// ═════════════════════════════════════════════════════════════════════════════
describe('6 · existing surfaces that already layered correctly still do', () => {
  it("#427's More Sheet still layers scrim z-[101] / sheet z-[102]", () => {
    const shell = src('src/components/AdminDashboard.tsx');
    expect(shell, "the More Sheet's scrim layer moved").toContain('z-[101]');
    expect(shell, 'the More Sheet layer moved').toContain('z-[102]');
  });

  it("THE-286's settings cancel-confirm still opens at z-[200]", () => {
    expect(src('src/components/AdminSettings.tsx'), 'the settings dialog left z-200')
      .toContain('z-[200]');
  });

  it('and all three layers still clear the nav, in the order they were designed in', async () => {
    const css = await buildCssForMarkup('<div class="z-[100] z-[101] z-[102] z-[200]"></div>');
    for (const z of [101, 102, 200]) {
      expect(css, `z-[${z}] stopped compiling`).toContain(`z-index: ${z}`);
      expect(z, `z-[${z}] no longer clears the nav`).toBeGreaterThan(NAV_Z);
    }
  }, MEASURE_TIMEOUT);
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Touch targets.
// ═════════════════════════════════════════════════════════════════════════════
describe('7 · every tappable target is ≥44px below sm, and Rule 4\'s 38px still holds above', () => {
  it('🔴 every nav tab is at least 44px at 380px, notch and all', async () => {
    const tabs = await notched.evaluateAt<Box[]>(380, settled(`
      return [...document.querySelectorAll('[data-nav="visible-5"] [data-tab]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom };
      });
    `), PHONE_HEIGHT);
    expect(tabs.length).toBe(5);
    for (const t of tabs) {
      expect(t.height, 'a nav tab fell under the 44px touch floor').toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
      expect(t.width, 'a nav tab fell under the 44px touch floor').toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
  }, MEASURE_TIMEOUT);

  it('and the inset did not eat into a target — the bar grew, the tabs did not shrink', async () => {
    const before = flatBox('[data-nav="visible-5"] [data-tab]', 380);
    const after = await boxOf(notched, '[data-nav="visible-5"] [data-tab]', 380);
    expect(after.height, 'reserving the notch shrank a touch target').toBeCloseTo(before.height, 1);
  }, MEASURE_TIMEOUT);

  it('⚠️ Rule 4 is untouched: DENSITY_PX.control is still deliberately under 44', () => {
    // 🔴 Not a bug and not this ticket's to fix. THE-286 settled it: 44px is a
    // TOUCH floor asserted below `sm`; from `sm:` up Rule 4 fixes a control at
    // 38px and an existing test asserts `DENSITY_PX.control < 44` on purpose.
    // Pinned here so this file cannot be read as licence to raise it.
    expect(DENSITY_PX.control).toBeLessThan(TOUCH_TARGET_MIN_PX);
    expect(DESKTOP_CONTROL_MAX_PX).toBeLessThan(TOUCH_TARGET_MIN_PX);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Gating.
// ═════════════════════════════════════════════════════════════════════════════
describe('8 · which tabs appear and their gating are unchanged', () => {
  const shell = () => src('src/components/MainApp.tsx');

  it('the five bottom tabs are the same five, in the same order', () => {
    const block = /const bottomTabs = \[([\s\S]*?)\]\.filter\(Boolean\)/.exec(shell());
    expect(block, 'the bottomTabs list could not be located').not.toBeNull();
    expect([...block![1].matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]))
      .toEqual(['home', 'bible', 'chat', 'map', 'profile']);
  });

  it('🔴 chat is still gated on features.aiChat and map on features.map', () => {
    expect(shell()).toContain("(isMainSite || (isPlanReady && features?.aiChat === true)) && { id: 'chat'");
    expect(shell()).toContain("(isMainSite || (isPlanReady && features?.map === true)) && { id: 'map'");
  });

  it('and home, bible and profile are still unconditional', () => {
    for (const id of ['home', 'bible', 'profile']) {
      const line = new RegExp(`^\\s*\\{ id: '${id}',`, 'm');
      expect(shell(), `${id} gained a gate this ticket did not authorise`).toMatch(line);
    }
  });

  it('the shell was not restructured — its element tree is unchanged from main', () => {
    // 🔴 The non-negotiable. MainApp is 918 lines and holds the whole shell;
    // this ticket changes clearance and layering, not layout. Element COUNT is
    // pinned rather than a digest, so the claim survives a comment edit and
    // still fails on a wrapper, a moved block or a dropped node. The
    // tag-for-tag inventory is asserted in MemberScreens.desktop-layout.
    const tags = [...shell().matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)].map((m) => m[1]);
    expect(tags.length, 'the shell gained or lost an element').toBe(73);
  });

  it('and the deliberate inline brand-colour fallback is left alone', () => {
    // ⚠️ One of only three inline styles in the file, and the fallback is
    // deliberate. Named so a tidy-up does not take it.
    expect(shell(), 'the brand-colour fallback was tidied away')
      .toContain("var(--brand-color, #C9963A)");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Geometry at all five viewports.
// ═════════════════════════════════════════════════════════════════════════════
describe('9 · positions and widths at all five viewports', () => {
  it.each(VIEWPORTS)('the nav lands where it should at %ipx, on a notched profile', async (vw) => {
    const nav = await boxOf(notched, '[data-nav="visible-5"]', vw, vw >= 1024 ? 900 : PHONE_HEIGHT);
    expect(nav.width, `the nav is not full-bleed at ${vw}px`).toBeGreaterThan(0);
    if (vw < 1024) {
      // Below lg it is the bottom bar: full width, pinned to the bottom.
      expect(nav.width).toBeCloseTo(vw, 0);
      expect(nav.x).toBeCloseTo(0, 0);
      expect(nav.bottom).toBeCloseTo(PHONE_HEIGHT, 0);
    } else {
      // From lg it is the sidebar: a fixed rail, full height, at the left.
      expect(nav.x).toBeCloseTo(0, 0);
      expect(nav.width, `the sidebar rail resized at ${vw}px`).toBeLessThan(vw);
    }
  }, MEASURE_TIMEOUT);

  it('🔴 no viewport overflows the document horizontally', async () => {
    // ⚠️ Width is not monotonic here, so this is measured at every width
    // rather than inferred from the widest.
    for (const vw of VIEWPORTS) {
      const sw = await notched.evaluateAt<number>(vw,
        settled('return document.documentElement.scrollWidth;'),
        vw >= 1024 ? 900 : PHONE_HEIGHT);
      expect(sw, `the page overflows horizontally at ${vw}px`).toBeLessThanOrEqual(vw + 1);
    }
  }, MEASURE_TIMEOUT);

  it('and the inset is reserved below lg and nowhere else, at every width', async () => {
    for (const vw of VIEWPORTS) {
      const h = vw >= 1024 ? 900 : PHONE_HEIGHT;
      const before = flatBox('[data-nav="visible-5"]', vw);
      const after = await boxOf(notched, '[data-nav="visible-5"]', vw, h);
      const delta = after.height - before.height;
      if (vw < 1024) {
        expect(delta, `the inset is not reserved at ${vw}px`).toBeCloseTo(SAFE_INSET_PX, 1);
      } else {
        expect(delta, `the desktop sidebar gained an inset at ${vw}px`).toBeCloseTo(0, 1);
      }
    }
  }, MEASURE_TIMEOUT);
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Colour, emoji, palettes.
// ═════════════════════════════════════════════════════════════════════════════
describe('10 · no colour hardcoded, no emoji; all four palettes resolve', () => {
  const TOUCHED = [
    'src/components/ui/dialog.tsx',
    'src/components/ui/sheet.tsx',
  ] as const;

  it('the classes this ticket changed introduce no colour at all', () => {
    // Scoped to what THIS ticket wrote — the nav's padding utility and the four
    // z-index classes. MainApp's own palette is pinned wholesale by
    // MemberScreens.desktop-layout's colour inventory.
    const written = [navPaddingBottomClass(), 'z-[101]', 'z-[102]'].join(' ');
    expect(written).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(written).not.toMatch(/\b(?:rgba?|hsla?|oklch|color-mix)\(/);
  });

  it('neither primitive gained a literal colour', () => {
    for (const rel of TOUCHED) {
      const code = src(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, `${rel} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code, `${rel} hardcodes a functional colour`).not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
    }
  });

  it('🔴 and no emoji entered any file this ticket touched', () => {
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/gu;

    // The two primitives carry none and must keep carrying none.
    for (const rel of TOUCHED) {
      expect(src(rel), `${rel} gained an emoji`).not.toMatch(EMOJI);
    }

    // ⚠️ MainApp is NOT emoji-free and was not made so here — that would be a
    // restyle this ticket has no mandate for. Its inventory predates this
    // ticket: `✓`/`✗` are status glyphs in the shell and `🔴` is the repo's own
    // comment marker. So the claim is the one that is actually this ticket's:
    // the inventory did not GROW. Pinned by census rather than forbidden
    // outright, so adding one still fails.
    const found = src('src/components/MainApp.tsx').match(EMOJI) ?? [];
    const census = Object.fromEntries(
      [...new Set(found)].sort().map((g) => [g, found.filter((x) => x === g).length]),
    );
    expect(census, 'MainApp gained an emoji, or lost one it shipped with')
      .toEqual({ '✓': 4, '✗': 4, '🔴': 12 });
  });

  it('all four palettes still resolve, Classic included — it is the default since #409', () => {
    for (const selector of [
      ':root',
      '.dark, [data-theme="dark"]',
      '[data-palette="classic"][data-theme="light"]',
      '[data-palette="classic"].dark',
    ]) {
      const needle = selector.split(',')[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(appCss, `${selector} no longer declares anything`)
        .toMatch(new RegExp(`${needle}[^{]*\\{`));
    }
  });

  it('and the nav still paints from tokens, not literals', async () => {
    const bg = await notched.evaluateAt<string>(380,
      settled(`return getComputedStyle(document.querySelector('[data-nav="visible-5"]')).backgroundColor;`),
      PHONE_HEIGHT);
    // A resolved token is still a colour string; what matters is that the CLASS
    // is the token one and the stylesheet resolved it to something real.
    expect(navClassIn('visible')).toContain('bg-surface-raised');
    expect(bg, 'bg-surface-raised resolved to nothing').not.toBe('rgba(0, 0, 0, 0)');
  }, MEASURE_TIMEOUT);
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. The files this ticket must not touch.
// ═════════════════════════════════════════════════════════════════════════════
describe('11 · layout.tsx, firestore.rules and functions/ byte-identical', () => {
  // 🔴 Recorded as literals rather than diffed against `git show` at assertion
  // time: CI's checkout is the only history a test can rely on, and this repo
  // has already been bitten by a shallow clone.
  const PINNED: Readonly<Record<string, string>> = {
    'src/app/layout.tsx': 'bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5',
    'firestore.rules': 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
  };

  it.each(Object.entries(PINNED))('%s is byte-identical', (file, digest) => {
    expect(sha256(src(file)), `${file} was edited — this ticket must not touch it`).toBe(digest);
  });

  it('layout.tsx still carries its hash-pinned pre-paint theme script', () => {
    // Stated positively as well as by digest, so a failure says WHAT was lost.
    expect(src('src/app/layout.tsx')).toContain('data-palette');
  });

  it('functions/ is unchanged, file for file', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(`${path.relative(ROOT, p)}:${sha256(readFileSync(p, 'utf8'))}`);
      }
      return out;
    };
    expect(walk(path.join(ROOT, 'functions')).sort()).toEqual([
      "functions/.gcloudignore:9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2",
      "functions/package-lock.json:bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681",
      "functions/package.json:33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb",
      "functions/src/index.ts:39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b",
      "functions/tsconfig.json:a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25"
    ]);
  });
});
