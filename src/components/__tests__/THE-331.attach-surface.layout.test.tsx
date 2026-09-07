// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-276-FIX, THE-290, THE-298 and
// THE-320 give, re-verified for this ticket rather than inherited: with
// happy-dom selected, `MeasuringBrowser` never attaches and the suite times out.
// Nothing here needs a DOM. The page is rendered to a string and every
// measurement happens inside a real Chromium over CDP.
//
// ⚠️ ONE `MeasuringBrowser` PER PROCESS. Two instances in one process collide
// on a PID-derived debugger port.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';

/**
 * THE-331 · The attach surface is not full-width from `sm` up.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The founder, with a 1920px screenshot: *"if i want to attach something in a
 * chat and press on the paperclip, this is how it opens in the desktop tab.
 * horrible and disgusting."* A panel designed as a phone sheet was pinned to
 * the bottom edge of a desktop screen, spanning the full width.
 *
 * 🔴 THE CLASS STRINGS MEASURED HERE ARE READ OUT OF THE SOURCE FILES AT RUN
 * TIME, not copied into this file. THE-290, THE-298 and THE-320 replicate a
 * shell they do not own by hand; these surfaces ARE this ticket's, so a hand
 * copy would let the shipped class drift away from the measured one and this
 * suite would keep passing while the founder's bug came back.
 *
 * ⚠️ `items-end` is CORRECT at 380px. The mobile sheet is not the bug and must
 * not be "fixed" — test 2 exists to catch exactly that overcorrection.
 */

/** 🔴 The founder saw it at 1920. 380 is the phone the sheet is right for. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440, 1920] as const;

const ROOT = process.cwd();

/**
 * 🔴 THE SURFACES ARE DISCOVERED, NOT PINNED TO LINE NUMBERS.
 *
 * An earlier draft of this suite named `AdminCommunity.tsx:362` and `:491`.
 * Replacing the attach sheet with a menu deleted 182 lines and moved
 * `ChannelMembersSheet` from 491 to 311 — so the pinned suite would have
 * measured whatever happened to land on those lines, which is worse than
 * failing. Every `fixed inset-0 … items-end` overlay in these three files is
 * found by pattern instead, which also means a NEW bottom sheet added later is
 * measured automatically rather than being quietly out of scope.
 */
const SHEET_FILES = [
  'src/components/AdminCommunity.tsx',
  'src/components/UserMessages.tsx',
  'src/components/AdminBlog.tsx',
] as const;

interface Surface {
  key: string;
  file: string;
  line: number;
  what: string;
  cls: string;
  panel: string;
}

function discoverSurfaces(): Surface[] {
  const found: Surface[] = [];
  for (const file of SHEET_FILES) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((text, i) => {
      const m = text.match(/className="([^"]*fixed inset-0[^"]*items-end[^"]*)"/);
      if (!m) return;
      // The panel is the next `bg-surface-raised` element within three lines.
      let panel = '';
      for (let k = 1; k <= 3 && !panel; k += 1) {
        const pm = (lines[i + k] ?? '').match(/className="([^"]+)"/);
        if (pm && /bg-surface-raised/.test(pm[1])) panel = pm[1];
      }
      if (!panel) {
        throw new Error(`${file}:${i + 1} is a sheet with no panel within three lines`);
      }
      found.push({
        key: `${path.basename(file, '.tsx')}:${i + 1}`,
        file,
        line: i + 1,
        what: `${path.basename(file)}:${i + 1}`,
        cls: m[1],
        panel,
      });
    });
  }
  return found;
}

const SURFACES = discoverSurfaces();

interface Reading {
  viewport: number;
  scrollWidth: number;
  surfaces: Record<
    string,
    { outerW: number; panelW: number; panelLeft: number; panelRight: number; alignItems: string; panelBottom: number }
  >;
  navTop: number;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="min-h-screen bg-surface">
      {SURFACES.map((s) => (
        <div key={s.key} data-surface={s.key} className={s.cls}>
          <div className="absolute inset-0 bg-black/50" />
          <div data-panel={s.key} className={s.panel}>
            <p>Attach Record</p>
          </div>
        </div>
      ))}
      {/*
        The member/admin bottom nav, replicated from AdminDashboard's own class
        string — `fixed bottom-0 … z-[100]`. It is not this ticket's to open,
        and every surface above has to clear it at 380px.
      */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the331-'));
  const file = path.join(dir, 'attach.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(
      viewport,
      await browser.evaluateAt<Reading>(viewport, `(() => {
        const round = (n) => Math.round(n * 100) / 100;
        const surfaces = {};
        for (const el of document.querySelectorAll('[data-surface]')) {
          const key = el.getAttribute('data-surface');
          const panel = el.querySelector('[data-panel]');
          const ob = el.getBoundingClientRect();
          const pb = panel.getBoundingClientRect();
          surfaces[key] = {
            outerW: round(ob.width),
            panelW: round(pb.width),
            panelLeft: round(pb.left),
            panelRight: round(pb.right),
            panelBottom: round(pb.bottom),
            alignItems: getComputedStyle(el).alignItems,
          };
        }
        const nav = document.querySelector('[data-shell-bottom-nav]');
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          surfaces,
          navTop: round(nav.getBoundingClientRect().top),
        };
      })()`),
    );
  }
}, 300_000);

afterAll(async () => {
  await browser?.close();
});

/** One offender per line, so a failure lists them ALL rather than the first. */
const bullets = (xs: string[]) => xs.map((x) => `
  ${x}`).join('');

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}`);
  return r;
};

// ═════════════════════════════════════════════════════════════════════════════
// 0. The precondition: the class strings really came off the source.
// ═════════════════════════════════════════════════════════════════════════════
describe('this suite measures the SHIPPED class strings', () => {
  it('found every bottom sheet in the three files that have them', () => {
    expect(
      SURFACES.length,
      'no bottom sheet was discovered — the pattern stopped matching, which ' +
        'would silently reduce this suite to measuring nothing',
    ).toBeGreaterThanOrEqual(4);
  });

  it.each(SURFACES)('$what is a fixed overlay that starts bottom-aligned', ({ cls }) => {
    expect(cls).toContain('fixed inset-0');
    expect(cls).toContain('items-end');
  });

  it('🔴 the attach sheet is GONE — the paperclip opens a menu now', async () => {
    const src = readFileSync(path.join(ROOT, 'src/components/AdminCommunity.tsx'), 'utf8');
    expect(src, 'the hand-rolled attach sheet must not survive').not.toContain('const AttachPicker');
    expect(src, 'the composer must reach for the menu').toContain('<AttachMenu');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. 🔴 THE BUG. Not full-width from `sm` up.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 the attach surface is NOT full-width from sm up', () => {
  const DESKTOP = [768, 1024, 1280, 1440, 1920] as const;

  it.each(DESKTOP)('at %ipx the panel is narrower than the viewport', (v) => {
    const r = at(v);
    const full = SURFACES.filter((s) => r.surfaces[s.key].panelW >= v).map(
      (s) => `${s.what} (${s.file}:${s.line}) spans ${r.surfaces[s.key].panelW}px`,
    );
    expect(
      full,
      `full-width at ${v}px — the founder's bug, a phone sheet pinned across a ` +
        `desktop screen. The fix is the \`sm:\` override already proven at ` +
        `AdminCommunity.tsx:1523:` + bullets(full),
    ).toEqual([]);
  });

  it.each(DESKTOP)('at %ipx the panel is centred, not edge-to-edge', (v) => {
    const r = at(v);
    for (const s of SURFACES) {
      const m = r.surfaces[s.key];
      const leftGap = m.panelLeft;
      const rightGap = v - m.panelRight;
      expect(
        leftGap,
        `${s.what} (${s.file}:${s.line}) touches the left edge at ${v}px`,
      ).toBeGreaterThan(0);
      expect(
        rightGap,
        `${s.what} (${s.file}:${s.line}) touches the right edge at ${v}px`,
      ).toBeGreaterThan(0);
      // Centred: the two gaps agree to within a pixel of rounding.
      expect(
        Math.abs(leftGap - rightGap),
        `${s.what} is off-centre at ${v}px (${leftGap} vs ${rightGap})`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it.each(DESKTOP)('at %ipx the surface centres its panel vertically', (v) => {
    const r = at(v);
    // 🔴 AGGREGATED, not short-circuited: a `for` loop with an `expect` inside
    // throws on the FIRST offender, so fixing one sheet at a time would let the
    // suite name only one of the five. Every failure is collected and reported
    // together, which is what "naming the others" has to mean.
    const pinned = SURFACES.filter((s) => r.surfaces[s.key].alignItems !== 'center').map(
      (s) => `${s.what} (${s.file}:${s.line})`,
    );
    expect(
      pinned,
      `still bottom-pinned at ${v}px — \`items-end\` with no \`sm:\` override:` +
        bullets(pinned),
    ).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. 🔴 The mobile sheet is CORRECT. Do not break it fixing desktop.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 it is still a bottom sheet below sm', () => {
  it('at 380px every surface is bottom-aligned', () => {
    const r = at(380);
    const centred = SURFACES.filter((s) => r.surfaces[s.key].alignItems !== 'flex-end').map(
      (s) => `${s.what} (${s.file}:${s.line})`,
    );
    expect(
      centred,
      'these were centred at 380px. The mobile sheet was ALREADY CORRECT and is ' +
        'not the bug; do not break it fixing desktop:' + bullets(centred),
    ).toEqual([]);
  });

  it('at 380px the panel still spans the width', () => {
    const r = at(380);
    for (const s of SURFACES) {
      const m = r.surfaces[s.key];
      // A phone sheet is meant to be full-bleed; only AdminBlog pads itself.
      expect(m.panelW, `${s.what} should fill a 380px phone`).toBeGreaterThanOrEqual(340);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. The surface clears the bottom nav at 380px.
// ═════════════════════════════════════════════════════════════════════════════
describe('the surface clears the bottom nav at 380px', () => {
  it('the sheets sit above the nav in the z-order, and the nav is reachable', () => {
    const r = at(380);
    expect(r.navTop, 'the nav must be on screen to be cleared').toBeGreaterThan(0);
    // z-[300] / z-[200] over the nav's z-[100]: the sheet is deliberately above
    // it, which is why it may overlap. What must not happen is the sheet
    // rendering UNDERNEATH the nav.
    for (const s of SURFACES) {
      const z = Number(s.cls.match(/z-\[(\d+)\]/)?.[1] ?? 0);
      expect(z, `${s.what} must clear the nav's z-[100]`).toBeGreaterThan(100);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// No horizontal overflow at any width.
// ═════════════════════════════════════════════════════════════════════════════
describe('no surface introduces horizontal overflow', () => {
  it.each(VIEWPORTS)('at %ipx the document does not scroll sideways', (v) => {
    const r = at(v);
    expect(r.scrollWidth, `horizontal overflow at ${v}px`).toBeLessThanOrEqual(v);
  });
});
