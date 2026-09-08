// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing. Nothing here needs a DOM —
// the page is rendered to a string and every measurement happens inside a real
// browser. Under this repo's default happy-dom environment the globals are
// replaced with browser-semantics ones and a request to the browser's own
// debugger port fails same-origin ("Cross-Origin Request Blocked"), so the
// browser can never be attached to. `renderToStaticMarkup` and `buildAppCss`
// are both server-side and unaffected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Heading1, Heading2, List, ListOrdered, Quote, Code, Minus, Bold, Italic,
  Link as LinkIcon, Image as ImageIcon, Type, Strikethrough,
  Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight, AlignJustify,
} from 'lucide-react';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import RichTextToolbar, {
  TAP_TARGET_PX, TOOLBAR_GROUPS, type ToolbarItem,
} from '../editor/RichTextToolbar';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-279 — WHERE the toolbar lands, and how big its buttons really are
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── Why this file exists separately ─────────────────────────────────────────
 *
 * 🔴 EVERY QUESTION HERE IS A LAYOUT QUESTION, and happy-dom cannot answer one.
 * With 22KB of the real compiled stylesheet injected, `getBoundingClientRect()`
 * returns all zeros and `getComputedStyle(el).display` answers `block` for a
 * flex container — measured, not assumed, in THE-276's post-mortem. So "is this
 * button 44px", "is this one row", "does the page scroll sideways" and "does
 * this clear the bottom nav" are asked HERE, over CDP, in real Chromium.
 * `THE-279.editor-toolbar.test.tsx` owns everything that is not geometry.
 *
 * ⚠️ THE REM TRAP IS THE WHOLE REASON THE NUMBERS ARE IN PX. globals.css trims
 * the rem base to 14.5px above 1024px, so `h-11` — named 44px — renders
 * 39.875px on a desktop. Section 1 measures `h-[44px]` at all five widths
 * precisely so that regression cannot come back silently, and section 1's last
 * test measures what `h-11` WOULD have done, so the trap is documented by
 * evidence rather than by a comment.
 *
 * ─── What is approximated, and why that is safe ──────────────────────────────
 *
 * The real `RichTextEditor` cannot be server-rendered: `useEditor` builds a
 * ProseMirror view against `document`, and the toolbar is mounted behind
 * `{editor && …}`, so SSR yields no bar at all. What is rendered instead is the
 * REAL `RichTextToolbar` with eighteen real items, inside the REAL card markup
 * (`bg-surface-raised rounded-xl overflow-hidden`, copied from the editor's own
 * return and asserted against it below), inside an approximated admin shell.
 *
 * 🔴 The shell's bottom nav is not hand-typed either: its class string is READ
 * OUT OF `AdminDashboard.tsx` at build time, so this file cannot measure
 * against a stale copy of a nav that has since moved. That file is out of scope
 * for this ticket and is only read, never written.
 */

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The ladder every layout suite in this repo uses. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/**
 * A phone's height, for the questions about the BOTTOM of the viewport.
 *
 * The harness defaults to 1200px, which is no phone — and "does the toolbar
 * collide with a `fixed bottom-0` nav" is meaningless at a height where
 * everything clears everything. 844 is the iPhone 14/15 logical height.
 */
const PHONE_HEIGHT = 844;

/** The eighteen items, in the order RichTextEditor hands them over. */
const ICONS: Record<string, React.ReactNode> = {
  Paragraph: <Type size={18} />, 'Heading 1': <Heading1 size={18} />,
  'Heading 2': <Heading2 size={18} />, Bold: <Bold size={18} />,
  Italic: <Italic size={18} />, Underline: <UnderlineIcon size={18} />,
  Strikethrough: <Strikethrough size={18} />, 'Bullet List': <List size={18} />,
  'Numbered List': <ListOrdered size={18} />, Quote: <Quote size={18} />,
  'Code Block': <Code size={18} />, Divider: <Minus size={18} />,
  Link: <LinkIcon size={18} />, Image: <ImageIcon size={18} />,
  'Align Left': <AlignLeft size={18} />, 'Align Center': <AlignCenter size={18} />,
  'Align Right': <AlignRight size={18} />, Justify: <AlignJustify size={18} />,
};

const ITEMS: ToolbarItem[] = TOOLBAR_GROUPS.flat().map((title) => ({
  title,
  description: 'x',
  icon: ICONS[title],
  run: () => {},
  active: false,
}));

/**
 * The editor card's own wrapper, class for class.
 *
 * Asserted against `RichTextEditor.tsx` below rather than trusted, because the
 * `overflow-hidden` on it is exactly what the sticky measurement in section 5
 * turns on.
 */
const CARD_CLASS = 'bg-surface-raised rounded-xl overflow-hidden';

/** The admin shell's bottom nav classes, read from the shell itself. */
function navClass(): string {
  const shell = src('src/components/AdminDashboard.tsx');
  /* ⚠️ THE-332 — WIDENED, NOT LOOSENED. This looked for `className={`…`}`
     exactly: a template literal, with nothing between `<div` and `className`.
     Both of those were implementation details of a nav that has since changed
     shape — the desktop half became a rail, so the collapsed/expanded width
     interpolation that MADE it a template literal is gone and the class list is
     now a plain string, and the element carries a `data-nav-shell` marker. The
     pattern matched neither, so `navClass()` threw and this whole suite was
     SKIPPED rather than failed, which says nothing about its assertions and is
     the worst way for a guard to go quiet.
     What it still refuses to do is measure a stale hand-typed copy: the
     `bg-surface-raised border-t lg:border-t-0` anchor and the four required
     tokens asserted below are unchanged, so a nav that stops being
     bottom-anchored still fails here. It also still matches the template-literal
     form, because CI runs `refs/pull/N/merge` and a merge ref cut before
     THE-332 landed legitimately carries it. */
  const match = /<div[^>]*?className=\{?[`"](bg-surface-raised border-t lg:border-t-0[^`"]*)[`"]\}?>/.exec(shell);
  if (!match) {
    throw new Error(
      'the admin shell\'s bottom nav could not be located in AdminDashboard.tsx, so this ' +
      'file would be measuring a hand-typed copy of a nav that may have moved.',
    );
  }
  // The live string carries a template hole for the collapsed-sidebar width.
  const cls = match[1].replace(/\$\{[^}]*\}/g, 'lg:w-64');
  // 🔴 The four properties every assertion here depends on. If the nav stops
  // being bottom-anchored, this fails rather than silently measuring nothing.
  for (const required of ['fixed', 'bottom-0', 'z-[100]', 'pb-safe']) {
    expect(cls, `the bottom nav no longer carries ${required}`).toContain(required);
  }
  return cls;
}

interface Box {
  x: number; y: number; width: number; height: number; right: number; bottom: number;
}

let browser: MeasuringBrowser;

beforeAll(async () => {
  const css = await buildAppCss();

  // The card markup this suite measures is the editor's own.
  expect(src('src/components/RichTextEditor.tsx'), 'the editor card was restyled')
    .toContain(`<div className="${CARD_CLASS}">`);

  const body = renderToStaticMarkup(
    <div>
      {/*
        The admin shell, approximated: a sidebar spacer that only exists from
        `lg` up (where the shell becomes desktop and the nav stops being a
        bottom bar), and the page's own per-tab padding.
      */}
      <div className="flex">
        <div className="hidden lg:block w-[232px] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="p-4 lg:p-0">
            {/* ── The subject: the real toolbar in the real card ── */}
            <div data-card className={CARD_CLASS}>
              <RichTextToolbar items={ITEMS} />
              {/*
                The editable area, standing in for <EditorContent>. Carries the
                prose ramp and AdminDocs' own minHeight, which is the tallest
                any surface asks for and therefore the one most likely to push
                content past the fold.
              */}
              <div
                data-editable
                className="prose prose-sm mx-auto p-4 max-w-none"
                style={{ minHeight: 'calc(100vh - 320px)' }}
              >
                <p>Sermon notes.</p>
              </div>
            </div>

            {/*
              ── A control card WITHOUT the toolbar ──
              So "how much did the toolbar cost" is a measurement rather than
              arithmetic. Identical in every other respect.
            */}
            <div data-card-notoolbar className={CARD_CLASS}>
              <div
                data-editable-notoolbar
                className="prose prose-sm mx-auto p-4 max-w-none"
                style={{ minHeight: 'calc(100vh - 320px)' }}
              >
                <p>Sermon notes.</p>
              </div>
            </div>

            {/*
              ── The sticky probe ──
              A `sticky top-0` bar inside the SAME card, so section 5 can
              measure what a sticky toolbar would actually have done here
              rather than asserting it in a comment.
            */}
            <div data-sticky-card className={CARD_CLASS} style={{ height: '300px' }}>
              <div data-sticky-probe className="sticky top-0 h-[44px]" />
              <div style={{ height: '2000px' }} />
            </div>

            {/*
              ── The fade edge, with the class string READ FROM THE SOURCE ──
              The component only paints a fade once it has measured overflow,
              which needs a client-side effect that static markup does not run.
              Extracting the real class string keeps this a measurement of the
              shipped fade rather than of a copy of it.
            */}
            <div className="relative w-[200px]">
              <div data-fade-probe className={fadeClass()} />
            </div>
          </div>
        </div>
      </div>

      <div data-nav className={navClass()}>
        <span style={{ display: 'inline-block', height: '44px' }} />
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the279-'));
  const file = path.join(dir, 'toolbar.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>${css}</style></head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
}, 180_000);

afterAll(async () => { await browser?.close(); });

/** The trailing fade's class string, as the component actually spells it. */
function fadeClass(): string {
  const code = src('src/components/editor/RichTextToolbar.tsx');
  const match = /data-editor-toolbar-fade="end"\s*\n\s*className="([^"]+)"/.exec(code);
  if (!match) throw new Error('the trailing fade could not be located in RichTextToolbar.tsx');
  return match[1];
}

/* ── measurement helpers ───────────────────────────────────────────────── */

/** The buttons' boxes, plus the scroller's and the bar's, at one viewport. */
async function readToolbar(viewport: number, height?: number) {
  return browser.evaluateAt<{
    buttons: (Box & { title: string; pointerEvents: string })[];
    scroller: Box & {
      scrollWidth: number; clientWidth: number; scrollHeight: number;
      clientHeight: number; scrollLeft: number; touchAction: string;
      overflowX: string; overflowY: string; overscrollX: string; flexWrap: string;
    };
    bar: Box & { position: string };
    editable: Box;
    editableNoToolbar: Box;
    card: Box;
    cardNoToolbar: Box;
    nav: Box & { position: string; zIndex: string };
    pageScrollWidth: number;
    bodyScrollWidth: number;
    viewport: number;
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
    const sc = q('[data-editor-toolbar-scroller]');
    const scs = getComputedStyle(sc);
    const bar = q('[data-editor-toolbar]');
    const nav = q('[data-nav]');
    const navCs = getComputedStyle(nav);
    return {
      buttons: [...sc.querySelectorAll('[data-editor-toolbar-button]')].map((el) => ({
        ...box(el), title: el.dataset.command, pointerEvents: getComputedStyle(el).pointerEvents,
      })),
      scroller: {
        ...box(sc), scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth,
        scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, scrollLeft: sc.scrollLeft,
        touchAction: scs.touchAction, overflowX: scs.overflowX, overflowY: scs.overflowY,
        overscrollX: scs.overscrollBehaviorX, flexWrap: scs.flexWrap,
      },
      bar: { ...box(bar), position: getComputedStyle(bar).position },
      editable: box(q('[data-editable]')),
      editableNoToolbar: box(q('[data-editable-notoolbar]')),
      card: box(q('[data-card]')),
      cardNoToolbar: box(q('[data-card-notoolbar]')),
      nav: { ...box(nav), position: navCs.position, zIndex: navCs.zIndex },
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewport: window.innerWidth,
    };
  })()`, height);
}

const measured = new Map<number, Awaited<ReturnType<typeof readToolbar>>>();
const at = async (viewport: number) => {
  if (!measured.has(viewport)) measured.set(viewport, await readToolbar(viewport));
  return measured.get(viewport)!;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 Every button is ≥44px tappable at 380 / 768 / 1024 / 1280 / 1440.
// ═══════════════════════════════════════════════════════════════════════════
describe('7 — every button is ≥44px tappable at every width', () => {
  it.each(VIEWPORTS)('at %ipx, on BOTH axes', async (viewport) => {
    const m = await at(viewport);
    expect(m.viewport, 'the viewport override did not take').toBe(viewport);
    expect(m.buttons.length, 'a command is missing from the bar').toBe(18);
    for (const b of m.buttons) {
      expect(b.width, `${b.title} is ${b.width}px wide at ${viewport}px`)
        .toBeGreaterThanOrEqual(TAP_TARGET_PX);
      expect(b.height, `${b.title} is ${b.height}px tall at ${viewport}px`)
        .toBeGreaterThanOrEqual(TAP_TARGET_PX);
      // A fade over a button must not make it untappable.
      expect(b.pointerEvents, `${b.title} is not tappable`).not.toBe('none');
    }
  });

  it('🔴 the desktop widths really are on the 14.5px rem base, so the px are doing work', async () => {
    // Guards the guard. If the rem trim ever stopped applying, `h-11` would be
    // 44px everywhere and the tests above would pass for a reason that is not
    // the reason — so the trim is measured, at the viewport where it starts.
    const remAt = (viewport: number) =>
      browser.evaluateAt<number>(viewport,
        'parseFloat(getComputedStyle(document.documentElement).fontSize)');
    expect(await remAt(768), 'mobile should keep the 16px base').toBe(16);
    expect(await remAt(1024), 'the desktop rem trim is gone').toBe(14.5);
    expect(await remAt(1440)).toBe(14.5);
  });

  it('🔴 the tap-target rule is emitted by the toolbar\'s CODE, not by a comment or another file', async () => {
    // ⚠️ TWO REGRESSIONS SLIPPED PAST BEFORE THIS TEST EXISTED, and both are
    // the same trap wearing different clothes: Tailwind generates utilities by
    // scanning source TEXT, so anything that merely mentions a class name emits
    // its rule.
    //
    //  1. Tailwind's content globs are `./src/**/*`, which includes this suite.
    //     Both THE-279 test files spell `h-[44px]` literally — in an assertion
    //     and in the sticky probe — so rewriting the component's class as
    //     `h-[${'${TAP_TARGET_PX}'}px]` still left the rule emitted and every button
    //     still measured 44px. Green over a component that sizes nothing in
    //     production, where no test file is in the content set.
    //  2. Scoping the build to the component alone did not fix it either: this
    //     file's own header explains the decision and NAMES `h-[44px]` while
    //     doing so, and the scanner does not know a comment from code.
    //
    // So the assertion is made against the comment-STRIPPED component. Nothing
    // but the class attribute can satisfy it.
    const { buildCssForFiles } = await import('../../test/support/tailwind-build');
    const stripped = src('src/components/editor/RichTextToolbar.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // The stripper must not have eaten the class attribute itself.
    expect(stripped, 'comment stripping removed the button classes').toContain('min-w-[44px]');

    const dir = mkdtempSync(path.join(os.tmpdir(), 'the279-cls-'));
    const file = path.join(dir, 'RichTextToolbar.tsx');
    writeFileSync(file, stripped, 'utf8');
    const css = await buildCssForFiles([file]);

    for (const px of [TAP_TARGET_PX]) {
      expect(
        css,
        `the toolbar's code does not produce a .h-[${px}px] rule — the class is built ` +
        'at run time and Tailwind never saw it',
      ).toContain(`.h-\\[${px}px\\]`);
      expect(css).toContain(`.min-w-\\[${px}px\\]`);
    }
    // And the emitted rule really is 44 px of height, not 44 of something else.
    expect(css).toMatch(/\.h-\\\[44px\\\]\s*\{[^}]*height:\s*44px/);
  });

  it('🔴 measures what `h-11` WOULD have been, so the trap is evidence and not folklore', async () => {
    // 2.75rem against a 14.5px base. This is the 39.875px the header claims,
    // measured rather than computed — and it is 4.125px under the floor, which
    // is why every load-bearing dimension on the bar is in px.
    const height = await browser.evaluateAt<number>(1440, `(() => {
      const el = document.createElement('div');
      el.className = 'h-11';
      document.body.appendChild(el);
      const h = el.getBoundingClientRect().height;
      el.remove();
      return h;
    })()`);
    expect(height).toBeCloseTo(39.875, 2);
    expect(height, 'h-11 would clear the touch floor — the px are then redundant')
      .toBeLessThan(TAP_TARGET_PX);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 🔴 ONE row at every width, and it never wraps — asserted by ROW COUNT.
// ═══════════════════════════════════════════════════════════════════════════
describe('9 — the toolbar is ONE row at every width and never wraps', () => {
  it.each(VIEWPORTS)('at %ipx, every button shares one row', async (viewport) => {
    const m = await at(viewport);
    // 🔴 ROW COUNT, not "no overflow". A wrapped bar overflows nothing — it
    // just gets taller — which is exactly why the ticket asks for this and not
    // for an overflow check. Rounded to the pixel: sub-pixel baseline
    // differences are not a second row.
    const rows = new Set(m.buttons.map((b) => Math.round(b.y)));
    expect(
      rows.size,
      `${rows.size} rows at ${viewport}px (tops: ${[...rows].sort((a, b) => a - b).join(', ')})`,
    ).toBe(1);
    expect(m.scroller.flexWrap, 'the row is allowed to wrap').toBe('nowrap');

    // And the bar is one button tall plus its own padding — a second row would
    // roughly double this even where the tops happened to align.
    expect(m.scroller.height).toBeLessThan(TAP_TARGET_PX * 2);
  });

  it('🔴 at 380px the full set genuinely does NOT fit, which is what makes the row a scroller', async () => {
    // Guards the guard again: if eighteen 44px buttons ever fitted a 380px
    // phone, "it scrolls" would be untestable and the row-count assertions
    // above would be vacuous.
    const m = await at(380);
    const total = m.buttons.reduce((n, b) => n + b.width, 0);
    expect(total, 'eighteen tap targets should not fit a phone').toBeGreaterThan(380);
    expect(m.scroller.scrollWidth).toBeGreaterThan(m.scroller.clientWidth);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 🔴 It scrolls horizontally at 380px and EVERY command is reachable.
// ═══════════════════════════════════════════════════════════════════════════
describe('10 — the toolbar scrolls horizontally at 380px and every command is reachable', () => {
  it('🔴 scrolls sideways, and scrolling to the end brings the last command fully into view', async () => {
    const reach = await browser.evaluateAt<{
      before: { first: string; lastVisible: boolean };
      after: { scrollLeft: number; lastVisible: boolean; firstVisible: boolean };
      unreachable: string[];
    }>(380, `(() => {
      const sc = document.querySelector('[data-editor-toolbar-scroller]');
      const all = [...sc.querySelectorAll('[data-editor-toolbar-button]')];
      const fullyInside = (el) => {
        const b = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
        return b.left >= s.left - 0.5 && b.right <= s.right + 0.5;
      };
      const before = { first: all[0].dataset.command, lastVisible: fullyInside(all[all.length - 1]) };

      // 🔴 The real question: can a swipe reach EVERY command? Each button is
      // scrolled into view in turn and checked, which is what "every command
      // reachable at every width" actually means.
      const unreachable = [];
      for (const el of all) {
        el.scrollIntoView({ block: 'nearest', inline: 'center' });
        if (!fullyInside(el)) unreachable.push(el.dataset.command);
      }

      sc.scrollLeft = sc.scrollWidth;
      const after = {
        scrollLeft: sc.scrollLeft,
        lastVisible: fullyInside(all[all.length - 1]),
        firstVisible: fullyInside(all[0]),
      };
      return { before, after, unreachable };
    })()`);

    // Before scrolling, the tail is off-screen — otherwise nothing is being tested.
    expect(reach.before.lastVisible, 'the last command is already visible at 380px').toBe(false);
    // 🔴 And every one of the eighteen can be brought fully into view.
    expect(reach.unreachable, 'these commands cannot be reached by scrolling at 380px').toEqual([]);
    // Scrolled to the end, the last is in and the first has left — a real scroll.
    expect(reach.after.scrollLeft).toBeGreaterThan(0);
    expect(reach.after.lastVisible, 'scrolling to the end does not reveal the last command').toBe(true);
    expect(reach.after.firstVisible, 'the row did not actually move').toBe(false);
  });

  it('🔴 has NO vertical scroll range, so a vertical swipe reaches the page', async () => {
    // ⚠️ The subtle half. CSS computes an `overflow: visible` axis to `auto`
    // when the other axis is not visible, so `overflow-x-auto` alone would give
    // this row vertical scroll range — and a box with vertical range SWALLOWS
    // the swipe that should scroll the page. `overflow-y-hidden` is what leaves
    // it zero, and this is the assertion that proves it rather than reading the
    // class back.
    for (const viewport of VIEWPORTS) {
      const m = await at(viewport);
      expect(m.scroller.overflowX, `overflow-x at ${viewport}px`).toBe('auto');
      expect(m.scroller.overflowY, `overflow-y at ${viewport}px`).toBe('hidden');
      expect(
        m.scroller.scrollHeight - m.scroller.clientHeight,
        `the row has ${m.scroller.scrollHeight - m.scroller.clientHeight}px of vertical scroll at ` +
        `${viewport}px, which would eat the page's vertical swipe`,
      ).toBeLessThanOrEqual(0);
    }
  });

  it('🔴 leaves touch-action at `auto`, so the browser picks the axis per gesture', async () => {
    // A `touch-action: pan-x` here would have looked like the fix and been the
    // opposite: it BLOCKS the vertical pan instead of letting it through. The
    // gesture split is the platform's job, and `auto` is how you ask for it.
    for (const viewport of [380, 768]) {
      const m = await at(viewport);
      expect(m.scroller.touchAction, `touch-action at ${viewport}px`).toBe('auto');
    }
    // Horizontal over-scroll is contained so it cannot become a back-swipe,
    // and the y axis is deliberately NOT named, so it still chains to the page.
    const m = await at(380);
    expect(m.scroller.overscrollX).toBe('contain');
  });

  it('the overflow cue is decorative and steals none of the 44px it covers', async () => {
    const fade = await browser.evaluateAt<{ pointerEvents: string; width: number; position: string }>(
      380, `(() => {
        const el = document.querySelector('[data-fade-probe]');
        const cs = getComputedStyle(el);
        return { pointerEvents: cs.pointerEvents, width: el.getBoundingClientRect().width, position: cs.position };
      })()`);
    // 🔴 `pointer-events: none` is what keeps the partially covered button
    // fully tappable — the fade is a cue, not a control.
    expect(fade.pointerEvents).toBe('none');
    expect(fade.position).toBe('absolute');
    // Narrower than a tap target, so it can never obscure a whole button.
    expect(fade.width).toBeGreaterThan(0);
    expect(fade.width, 'the fade is wide enough to hide a whole button').toBeLessThan(TAP_TARGET_PX);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 The PAGE never scrolls horizontally — the scroller clips internally.
// ═══════════════════════════════════════════════════════════════════════════
describe('11 — the PAGE does not scroll horizontally at any of the five widths', () => {
  it.each(VIEWPORTS)('at %ipx', async (viewport) => {
    const m = await at(viewport);
    // #422 measured exactly this: a wide thing scrolls inside its own card
    // while the document never moves sideways. Same pattern, same assertion.
    expect(
      m.pageScrollWidth,
      `the document scrolls ${m.pageScrollWidth - viewport}px sideways at ${viewport}px`,
    ).toBeLessThanOrEqual(viewport);
    expect(m.bodyScrollWidth).toBeLessThanOrEqual(viewport);
    // The bar itself stays inside its card, and the card inside the viewport.
    expect(m.bar.right).toBeLessThanOrEqual(m.card.right + 0.5);
    expect(m.card.right).toBeLessThanOrEqual(viewport + 0.5);
  });

  it('🔴 the row is genuinely wider than its box — so the clipping is doing the work', async () => {
    // Without this the test above passes on a bar that simply fits, and the
    // "no page overflow" claim would be untested rather than true.
    const m = await at(380);
    expect(m.scroller.scrollWidth).toBeGreaterThan(m.scroller.clientWidth);
    expect(m.scroller.scrollWidth).toBeGreaterThan(380);
    expect(m.pageScrollWidth).toBeLessThanOrEqual(380);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · 🔴 It does not overlap the bottom nav, and it is not sticky.
// ═══════════════════════════════════════════════════════════════════════════
describe('8 — the toolbar does not overlap the bottom nav at 380px', () => {
  it('🔴 at 380px on a phone-height viewport, the bar sits clear above the nav', async () => {
    const m = await readToolbar(380, PHONE_HEIGHT);
    expect(m.nav.position, 'the nav is not fixed any more').toBe('fixed');
    expect(m.nav.zIndex).toBe('100');
    // 🔴 By CONSTRUCTION, not by luck: the bar is at the TOP of the editor card
    // and the nav is anchored to the BOTTOM of the viewport, so there is no
    // width at which they can meet. A bottom-anchored toolbar — the iOS
    // keyboard-accessory pattern — is the one that would have had to fight for
    // this space, and that is why this one is not.
    expect(
      m.bar.bottom,
      `the toolbar's bottom edge (${m.bar.bottom}) is not above the nav's top (${m.nav.y})`,
    ).toBeLessThan(m.nav.y);
    expect(m.bar.y).toBeGreaterThanOrEqual(0);
  });

  it('🔴 is IN FLOW — not fixed, not sticky, not absolute — so it can never be pinned near the nav', async () => {
    for (const viewport of VIEWPORTS) {
      const m = await at(viewport);
      expect(m.bar.position, `the bar is ${m.bar.position} at ${viewport}px`).toBe('relative');
    }
  });

  it('🔴 pushes the editable area DOWN inside the card, not under the nav', async () => {
    // The other half of the requirement. The bar occupies its own space above
    // the text rather than overlaying it, so nothing is hidden behind it.
    const m = await readToolbar(380, PHONE_HEIGHT);
    expect(m.editable.y, 'the editable area starts above the toolbar').toBeGreaterThanOrEqual(m.bar.bottom - 0.5);
    expect(m.bar.height).toBeGreaterThanOrEqual(TAP_TARGET_PX);

    // And the cost is exactly the bar's own height — measured against the
    // control card that has no toolbar, so this is a difference and not a guess.
    const added = m.card.height - m.cardNoToolbar.height;
    expect(added).toBeCloseTo(m.bar.height, 0);

    // 🔴 The editable area's own bottom still clears the nav on a phone, so the
    // toolbar's height did not push the writing surface under it. AdminDocs'
    // `calc(100vh - 320px)` is the tallest minHeight any of the three surfaces
    // asks for, which is the case most likely to fail this.
    expect(
      m.editable.bottom,
      `the editable area ends ${m.editable.bottom - m.nav.y}px below the nav's top edge`,
    ).toBeLessThan(m.nav.y);
  });

  it('🔴 a `sticky top-0` bar in this card would NOT stick — measured, and the reason it is static', async () => {
    // This is the measurement the static decision rests on. The card carries
    // `overflow-hidden` to clip its `rounded-xl`, and `overflow: hidden` makes
    // the card its own scroll container — so `top-0` resolves against a box
    // that never scrolls. A sticky bar here declares a behaviour it cannot
    // deliver, which is markup that lies; making it real means removing the
    // card's clipping on three surfaces, which is not this ticket's change.
    const probe = await browser.evaluateAt<{ before: number; after: number; overflow: string }>(
      380, `(() => {
        const card = document.querySelector('[data-sticky-card]');
        const bar = document.querySelector('[data-sticky-probe]');
        const overflow = getComputedStyle(card).overflow;
        const before = bar.getBoundingClientRect().y;
        window.scrollTo(0, 0);
        card.scrollTop = 400;
        document.documentElement.scrollTop = 0;
        const after = bar.getBoundingClientRect().y - card.getBoundingClientRect().y;
        return { before, after, overflow };
      })()`);
    // The card really is a clipping container — otherwise this proves nothing.
    expect(probe.overflow).toBe('hidden');
    // The bar's offset from the card's top does not move: it is not sticking to
    // a viewport, it is simply sitting at the top of a box that cannot scroll.
    expect(probe.after).toBeCloseTo(0, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · 🔴 No command is hidden or dropped on a small viewport.
// ═══════════════════════════════════════════════════════════════════════════
describe('12 — no command is hidden or dropped on small viewports', () => {
  it.each(VIEWPORTS)('at %ipx, all eighteen render and none is display:none', async (viewport) => {
    const seen = await browser.evaluateAt<{ title: string; display: string; visibility: string }[]>(
      viewport, `[...document.querySelectorAll('[data-editor-toolbar-button]')].map((el) => {
        const cs = getComputedStyle(el);
        return { title: el.dataset.command, display: cs.display, visibility: cs.visibility };
      })`);
    expect(seen.length, `only ${seen.length} commands at ${viewport}px`).toBe(18);
    for (const s of seen) {
      expect(s.display, `${s.title} is display:${s.display} at ${viewport}px`).not.toBe('none');
      expect(s.visibility, `${s.title} is ${s.visibility} at ${viewport}px`).toBe('visible');
    }
    expect(seen.map((s) => s.title)).toEqual(TOOLBAR_GROUPS.flat());
  });

  it('🔴 renders the SAME eighteen at 380px as at 1440px, in the same order', async () => {
    // Parity with desktop, stated as an equality rather than as two counts.
    const titlesAt = async (v: number) => (await at(v)).buttons.map((b) => b.title);
    expect(await titlesAt(380)).toEqual(await titlesAt(1440));
  });
});
