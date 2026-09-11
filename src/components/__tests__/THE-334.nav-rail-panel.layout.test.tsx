// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-332's measured suite gives, and
// re-verified here: with happy-dom selected `MeasuringBrowser` never attaches
// and the file hangs in `browser.open()`. Nothing here needs a DOM. The markup
// is built as a STRING and every measurement happens in a real Chromium.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { RAIL_PANEL_INSET_TOP_PX, RAIL_PANEL_INSET_EDGE_PX } from '../layout/nav-rail';

/** What the panel's insets leave it: the viewport less the header clearance
 *  above and the float gap below. Derived from the SAME constants the component
 *  positions with, so a changed inset moves this with it instead of going
 *  stale. */
const PANEL_INSET_TOTAL = RAIL_PANEL_INSET_TOP_PX + RAIL_PANEL_INSET_EDGE_PX;

/**
 * THE-334 — the flyout panel, MEASURED. "Full height" is a number or it is a
 * hope.
 *
 * ── Why the panel is built here rather than opened in the shell ─────────────
 * ⚠️ THE-332's measured suite renders the shell with `renderToStaticMarkup` and
 * measures the result. That works for the RAIL, which is always in the markup —
 * but the flyout is a Base UI POPUP inside a PORTAL, and a portal has nothing to
 * attach to on the server: the panel simply is not in an SSR string, open or
 * closed. There is no React runtime in the measured page either, so it cannot be
 * clicked open. So this suite measures the panel's own geometry directly.
 *
 * 🔴 AND IT DOES NOT RETYPE THE CLASSES. The class string is READ OUT OF
 * `nav-rail.tsx` by pattern — never by line number, which is how THE-331's
 * guard came to measure whatever had shifted into `:362`. If the panel's height
 * rule changes, this suite measures the CHANGED rule and fails; if someone
 * sizes the panel to its content, the extracted string no longer resolves to
 * the viewport and every assertion below goes red. What it cannot prove is that
 * Base UI's positioner puts this box where the arrow points — that is asserted
 * behaviourally in THE-334's happy-dom suite, and the gap is stated here rather
 * than papered over.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** The six widths this repo measures at. Width is not monotonic. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440, 1920] as const;
/** A deliberately SHORT viewport: a nine-tab group has to survive a laptop. */
const SHORT_HEIGHT = 768;

/**
 * The panel's own class list, discovered from the source.
 *
 * 🔴 Anchored on `data-slot="popover-content"` and the `className=` that follows
 * it, so it survives the file moving, growing or being reformatted — the one
 * thing it cannot survive is the panel no longer being full height, which is the
 * point.
 */
function panelClassFromSource(): string {
  const src = read('src/components/layout/nav-rail.tsx');
  const at = src.indexOf('data-slot="popover-content"');
  expect(at, 'the flyout popup no longer carries data-slot="popover-content"').toBeGreaterThan(-1);
  const after = src.slice(at);
  const m = after.match(/className="([^"]+)"/);
  expect(m, 'the flyout popup has no static className to measure').toBeTruthy();
  return m![1];
}

/** The section list's class list, read the same way. */
function scrollerClassFromSource(): string {
  const src = read('src/components/layout/nav-rail.tsx');
  const at = src.indexOf('<ScrollArea');
  expect(at, 'the panel no longer uses the installed scroll-area').toBeGreaterThan(-1);
  const m = src.slice(at).match(/className="([^"]+)"/);
  expect(m, 'the ScrollArea has no className').toBeTruthy();
  return m![1];
}

let browser: MeasuringBrowser;

setUpOrFail(async () => {
  const css = await buildAppCss();
  const panelClass = panelClassFromSource();
  const scrollerClass = scrollerClassFromSource();

  /* Nine rows, because MINISTRY has nine tabs and a short viewport is where a
     content-sized popover used to clip them. */
  const rows = Array.from({ length: 9 })
    .map((_, i) => `<button class="w-full flex items-center gap-3 px-3 min-h-11 rounded-xl text-left"><span class="text-[13px] font-medium truncate">Section ${i + 1}</span></button>`)
    .join('');

  const body = `
    <div class="flex h-[100dvh]">
      <div data-rail class="w-[64px] shrink-0"></div>
      <div data-panel class="${panelClass}">
        <div class="flex items-center justify-between gap-2 px-3 pt-3 pb-2 shrink-0">
          <h2 data-title class="text-base font-semibold text-strong truncate">People</h2>
        </div>
        <div data-sep class="shrink-0 border-t border-line"></div>
        <div data-scroller class="${scrollerClass} overflow-y-auto">
          <div class="flex flex-col gap-0.5 p-2">${rows}</div>
        </div>
        <div class="shrink-0 border-t border-line"></div>
        <div data-footer class="shrink-0 p-2 pt-1.5">
          <div class="px-3 pb-1 text-[11px] font-semibold uppercase">Recent people</div>
          <button class="w-full flex items-center gap-3 px-3 min-h-11 rounded-xl text-left"><span class="text-[13px] truncate">A Person</span></button>
        </div>
      </div>
    </div>`;

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the334-'));
  const file = path.join(dir, 'panel.html');
  const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important;}';
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>${FREEZE}</style></head><body style="margin:0">${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
}, 600_000);

afterAll(async () => { await browser?.close?.(); });

type Probe = {
  viewportH: number;
  panelH: number;
  panelW: number;
  scrollH: number;
  clientH: number;
  lastRowBottom: number;
  panelBottom: number;
};

const probe = (v: number, height: number) =>
  browser.evaluateAt<Probe>(v, `(() => {
    const p = document.querySelector('[data-panel]');
    const s = document.querySelector('[data-scroller]');
    const rows = document.querySelectorAll('[data-scroller] button');
    const last = rows[rows.length - 1];
    return {
      viewportH: window.innerHeight,
      panelH: p.getBoundingClientRect().height,
      panelW: p.getBoundingClientRect().width,
      scrollH: s.scrollHeight,
      clientH: s.clientHeight,
      lastRowBottom: last.getBoundingClientRect().bottom,
      panelBottom: p.getBoundingClientRect().bottom,
    };
  })()`, height);

describe('THE-334 · the panel, measured', () => {
  it('🔴 13b · the flyout is FULL HEIGHT between its insets, at every width', async () => {
    for (const v of VIEWPORTS) {
      const m = await probe(v, 1200);
      /* 🔴 THE MUTATION THIS CATCHES: size the panel to its contents. A
         content-sized popover holding a title, nine rows and a footer measures a
         few hundred px; this requires it to span the whole viewport bar its
         insets — the header clearance above and the float gap below, which are
         the founder's "it should not go over the header" and "it's actually
         floating". Asserted to the pixel against the component's own
         constants, not a remembered number. */
      expect(m.panelH, `panel is ${m.panelH}px in a ${m.viewportH}px viewport at ${v}px`)
        .toBeCloseTo(m.viewportH - PANEL_INSET_TOTAL, 0);
      expect(m.panelH, `panel overflows the viewport at ${v}px`)
        .toBeLessThan(m.viewportH);
    }
  });

  it('🔴 13b-ii · and it is still exactly `w-64` — the width nobody invented', async () => {
    /* THE-332 recorded `w-64` as sidebar.tsx's own SIDEBAR_WIDTH of 16rem, and
       the founder's "too wide" was settled by measuring: at ≥1024px the rem base
       is trimmed to 14.5px, so 16rem lands at 232px, not 256. The RAIL is the
       88px column beside it. Neither number moved in this ticket. */
    for (const v of VIEWPORTS.filter((x) => x >= 1024)) {
      const m = await probe(v, 1200);
      expect(m.panelW, `panel width at ${v}px`).toBeGreaterThan(200);
      expect(m.panelW, `panel width at ${v}px`).toBeLessThanOrEqual(256);
    }
  });

  it('🔴 12 · a nine-tab group SCROLLS on a short viewport instead of clipping', async () => {
    const m = await probe(1280, SHORT_HEIGHT);
    /* The panel still spans the short viewport, less its insets… */
    expect(m.panelH).toBeCloseTo(m.viewportH - PANEL_INSET_TOTAL, 0);
    /* …and the LAST of the nine rows sits inside it, not cut off below the
       fold. `scrollHeight > clientHeight` is only meaningful if the scroller is
       the thing that overflows, which is what makes this the scroll-area's job
       rather than the panel growing past the screen. */
    expect(m.lastRowBottom, 'the ninth row is clipped below the panel')
      .toBeLessThanOrEqual(m.panelBottom + 1);
    expect(m.clientH, 'the section list has no height to scroll in').toBeGreaterThan(0);
  });
});
