// @vitest-environment node
//
// NODE, NOT happy-dom — the same reason THE-346, THE-320 and THE-331 give:
// `happy-dom` HAS NO LAYOUT ENGINE, so `getBoundingClientRect()` returns zeroes
// with the real stylesheet injected and `getComputedStyle(el).display` answers
// `block` for a flex container. A source-only assertion — "the trigger's class
// string contains `min-h-11`" — would PASS ON A BROKEN SCREEN, and #490 measured
// exactly that class at 7.7469px mid-transition. Nothing here needs a DOM: the
// page is rendered to a string and every number comes out of a real Chromium
// over CDP.
//
// ONE `MeasuringBrowser` PER PROCESS — two instances collide on a debugger port.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { CONTROL_DENSITY } from '../layout/form-layout';

/**
 * THE-351 · 🔴 TEST 6 — "TOP RIGHT" EXISTS ON BOTH SHELLS, AND IT IS MEASURED.
 *
 * THE FOUNDER: "Put inbox in all tenants in top right where this will appear."
 *
 * ⚠️ A BADGE IN A HEADER THAT MOBILE DOES NOT RENDER IS NOT SHIPPED. The admin
 * app has TWO headers and they are mutually exclusive by breakpoint:
 *
 *   · DESKTOP (`lg:` and up) — the branded top bar's right cluster, which the
 *     rail (#477/#478) sits beside. The platform bell has always lived here.
 *   · MOBILE (below `lg`) — `AdminScreenHeader`'s right column, which the
 *     desktop bar replaces (`lg:hidden`). The bottom nav was REJECTED for this:
 *     it is not "top right", it is already full, and #492 hides it entirely
 *     inside a conversation.
 *
 * So this measures BOTH, at five widths, and asserts the trigger is
 *   (a) rendered,
 *   (b) in the RIGHT-HAND half of its header,
 *   (c) at or above the 44px tap floor below `sm`,
 * with the class strings READ OUT OF THE SHIPPED SOURCE at run time — never
 * hand-copied, and never found by line number.
 *
 * ⚠️ TRANSITIONS ARE SUPPRESSED IN THE MEASURED PAGE. `#490` measured
 * `min-h-[44px]` at 7.7469px mid-transition and a menu row at
 * 41.79998779296875px — exactly 44 × 0.95 — because two animation frames is
 * well inside a 150ms transition. The resting layout is the one a person sees.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/**
 * Pull one capture out of a file, or throw naming the file and the pattern.
 * 🔴 A DISCOVERY THAT FINDS NOTHING MUST THROW. A fallback would turn "the
 * surface moved" into "the surface is fine", which is the failure mode a
 * discovery guard exists to prevent.
 */
function discover(rel: string, re: RegExp, what: string): string {
  const m = read(rel).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${rel} — the surface moved`);
  return m[1];
}

const DASH = 'src/components/AdminDashboard.tsx';
const HEADER = 'src/components/AdminScreenHeader.tsx';
const INBOX = 'src/components/inbox/TenantInbox.tsx';

/** The desktop top bar's own right-hand cluster. */
const desktopRightCluster = discover(
  DASH,
  /\{\/\* Right: screen action · search · notifications · account \*\/\}\s*\n\s*<div className="([^"]+)">/,
  'the desktop top bar’s right cluster',
);

/** The mobile header's three columns, off `AdminScreenHeader` itself. */
const mobileHeaderRow = discover(
  HEADER,
  /<div className="(relative bg-surface-raised px-3 flex items-center[^"]*min-h-\[52px\][^"]*)">/,
  'the mobile screen header row',
);
const mobileRightColumn = discover(
  HEADER,
  /<div className="(flex items-center gap-2 flex-shrink-0 z-10 justify-end)">/,
  'the mobile header’s right column',
);

/** The inbox trigger's own class string, concatenated exactly as it ships. */
const triggerClass = (() => {
  const src = read(INBOX);
  const m = src.match(/className=\{\s*\n?\s*('relative inline-flex[\s\S]*?)\+ \(triggerClassName \|\| ''\)/);
  if (!m) throw new Error('the inbox trigger’s className could not be read — the surface moved');
  // The source spells it as a `+`-joined run of single-quoted literals.
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('');
})();

/** The row and the Confirm button, likewise. */
const rowClass = discover(INBOX, /data-tenant-inbox-row className="([^"]+)"/, 'an inbox row');

/**
 * 🔴 THE CONFIRM BUTTON'S ABOVE-`sm` HEIGHT IS A SHARED TOKEN, AND THE TEST
 * RESOLVES IT RATHER THAN COPYING IT.
 *
 * The component spends `CONTROL_DENSITY.action` — `form-layout.ts`'s own name
 * for a primary action's density — instead of minting an `h-[40px]` of its own,
 * which is what THE-345's "this ticket mints no height" sweep is for. So the
 * source spells a `+ CONTROL_DENSITY.action` that no string-literal scrape can
 * see; the discovery below requires the button to actually spend it and then
 * appends the REAL value read from the module, so the measured page wears
 * exactly what ships and a change to the token is measured rather than missed.
 */
const confirmClass = (() => {
  const src = read(INBOX);
  const m = src.match(/data-inbox-confirm[\s\S]{0,900}?className=\{\s*\n\s*('min-h-11[\s\S]*?)\n\s*\}/);
  if (!m) throw new Error('the Confirm button’s className could not be read — the surface moved');
  if (!/\+\s*CONTROL_DENSITY\.action/.test(m[1])) {
    throw new Error('the Confirm button no longer spends CONTROL_DENSITY.action — it mints a height');
  }
  const literals = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('');
  return `${literals} ${CONTROL_DENSITY.action}`;
})();

/**
 * THE TWO SCENES.
 *
 * ⚠️ NOT ONE FAKE SCREEN. The two headers never coexist — the desktop bar is
 * `lg:`-only and the mobile one is `lg:hidden` — so stitching them into one
 * page would measure something that does not exist. Each scene is the real
 * header's own structure, wearing the real class strings, with the inbox
 * trigger in the position the source puts it in.
 */
const page = () => (
  <div>
    {/* ── Desktop: the branded top bar ─────────────────────────────────── */}
    <div data-desktop-bar className="hidden lg:flex items-center gap-3 px-4 h-16 border-b border-line bg-surface-raised">
      <div className="flex items-center gap-2 shrink-0"><span>logo</span></div>
      <h1 className="flex-1 text-center truncate px-4">Events</h1>
      <div data-desktop-right className={desktopRightCluster}>
        <button data-desktop-inbox className={triggerClass}>I</button>
        <button data-desktop-account className="w-9 h-9 rounded-full">A</button>
      </div>
    </div>

    {/* ── Mobile: AdminScreenHeader ────────────────────────────────────── */}
    <div data-mobile-header className={mobileHeaderRow}>
      <div className="flex items-center gap-1.5 flex-shrink-0 z-10">
        <button className="p-1 -ml-1">&lt;</button>
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 justify-center">
        <h1 className="font-display text-[17px] font-bold text-strong truncate">Events</h1>
      </div>
      <div data-mobile-right className={mobileRightColumn}>
        <button data-mobile-inbox className={triggerClass}>I</button>
        <button data-mobile-account className="w-9 h-9 rounded-full">A</button>
      </div>
    </div>

    {/* ── The sheet's own controls, at their shipped classes ───────────── */}
    <div data-sheet className="w-full sm:max-w-lg p-4">
      <div data-inbox-row className={rowClass}>
        <div className="flex-1"><p>Dana Okafor</p><p>$50.00 · HV-4KTM9P</p></div>
        <button data-inbox-confirm className={confirmClass}>Confirm</button>
      </div>
    </div>
  </div>
);

interface Box { x: number; y: number; w: number; h: number; right: number; bottom: number; display: string }
interface Reading { viewport: number; scrollWidth: number; boxes: Record<string, Box | null> }

const SELECTORS: Record<string, string> = {
  desktopBar: '[data-desktop-bar]',
  desktopRight: '[data-desktop-right]',
  desktopInbox: '[data-desktop-inbox]',
  mobileHeader: '[data-mobile-header]',
  mobileRight: '[data-mobile-right]',
  mobileInbox: '[data-mobile-inbox]',
  mobileAccount: '[data-mobile-account]',
  row: '[data-inbox-row]',
  confirm: '[data-inbox-confirm]',
};

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();
  const html = renderToStaticMarkup(page());
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the351-'));
  const file = path.join(dir, 'inbox.html');
  writeFileSync(
    file,
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">'
    + `<style>${css}</style>`
    // See the header: an un-suppressed page reports DRIFTING mid-flight values.
    + '<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>'
    + `</head><body>${html}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const r = await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 100) / 100;
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height),
                   right: round(b.right), bottom: round(b.bottom),
                   display: getComputedStyle(el).display };
        };
        const sel = ${JSON.stringify(SELECTORS)};
        const boxes = {};
        for (const k of Object.keys(sel)) boxes[k] = box(sel[k]);
        return { viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, boxes };
      })()`,
      900,
    );
    readings.set(viewport, r);
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}`);
  return r;
};
const box = (v: number, key: string): Box => {
  const b = at(v).boxes[key];
  if (!b) throw new Error(`${key} was not measured at ${v} — the surface did not render`);
  return b;
};

/* ═══ 6 · TOP RIGHT, ON BOTH SHELLS ══════════════════════════════════════ */

describe('6 · the tenant inbox is top right on BOTH shells', () => {
  it('🔴 DESKTOP: it renders in the top bar, and in the RIGHT half of it', () => {
    for (const v of [1024, 1280, 1440]) {
      const bar = box(v, 'desktopBar');
      const inbox = box(v, 'desktopInbox');
      expect(bar.display, `the desktop bar is not laid out at ${v}px`).not.toBe('none');
      expect(inbox.w, `the desktop inbox has no width at ${v}px`).toBeGreaterThan(0);
      // 🔴 RIGHT: its left edge is past the bar's midpoint, and it is inside it.
      expect(inbox.x, `the desktop inbox is in the LEFT half at ${v}px`)
        .toBeGreaterThan(bar.x + bar.w / 2);
      expect(inbox.right, `the desktop inbox overflows the bar at ${v}px`)
        .toBeLessThanOrEqual(bar.right + 0.5);
      // 🔴 TOP: it is inside the bar's own band, not below it.
      expect(inbox.y).toBeGreaterThanOrEqual(bar.y - 0.5);
      expect(inbox.bottom).toBeLessThanOrEqual(bar.bottom + 0.5);
    }
  });

  it('🔴 MOBILE: it renders in the screen header, and in the RIGHT half of it', () => {
    for (const v of [380, 768, 1024]) {
      const header = box(v, 'mobileHeader');
      const inbox = box(v, 'mobileInbox');
      expect(inbox.w, `the mobile inbox has no width at ${v}px`).toBeGreaterThan(0);
      expect(inbox.x, `the mobile inbox is in the LEFT half at ${v}px`)
        .toBeGreaterThan(header.x + header.w / 2);
      expect(inbox.right, `the mobile inbox overflows the header at ${v}px`)
        .toBeLessThanOrEqual(header.right + 0.5);
      expect(inbox.y).toBeGreaterThanOrEqual(header.y - 0.5);
      expect(inbox.bottom).toBeLessThanOrEqual(header.bottom + 0.5);
    }
  });

  it('🔴 and on a phone it sits BESIDE the account menu, not on top of it', () => {
    // THE-334's claim: the account menu is still reachable on mobile. Two
    // overlapping controls in one 52px header is how one of them stops being
    // tappable.
    const inbox = box(380, 'mobileInbox');
    const account = box(380, 'mobileAccount');
    const overlap = Math.min(inbox.right, account.right) - Math.max(inbox.x, account.x);
    expect(overlap, 'the inbox overlaps the account avatar at 380px').toBeLessThanOrEqual(0);
    expect(account.right, 'the account menu is no longer the last thing in the header')
      .toBeGreaterThanOrEqual(inbox.right);
  });

  it('🔴 and nothing scrolls sideways at any width', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).scrollWidth, `the page overflows at ${v}px`).toBeLessThanOrEqual(v + 0.5);
    }
  });
});

/* ═══ 23 · every tappable target ≥44px below `sm` ════════════════════════ */

describe('23 · every tappable target clears 44px below `sm`', () => {
  it('🔴 the trigger, the row and Confirm are all ≥44px at 380px', () => {
    for (const key of ['mobileInbox', 'row', 'confirm']) {
      const b = box(380, key);
      expect(b.h, `${key} is ${b.h}px tall at 380px — below the 44px tap floor`)
        .toBeGreaterThanOrEqual(44);
    }
    // The trigger is a circle, so its WIDTH matters as much as its height.
    expect(box(380, 'mobileInbox').w, 'the inbox trigger is narrower than 44px at 380px')
      .toBeGreaterThanOrEqual(44);
  });

  it('🔴 and `min-h-11` is NOT INERT here — it really is 44px', () => {
    // #490 measured this very class at 7.7469px and at 1.43015px on consecutive
    // runs, mid-transition, and the drifting value was the tell. A stable 44 is
    // the difference between a class that applies and one that is decoration.
    const h = box(380, 'confirm').h;
    expect(h).toBeGreaterThanOrEqual(44);
    expect(h, 'the height is drifting — a transition is still running').toBeLessThan(80);
  });

  it('Rule 4 takes over above `sm` — 38px, not 44', () => {
    for (const v of [768, 1024, 1280]) {
      const b = box(v, 'confirm');
      // Rule 4's density for a primary ACTION is 40px (`DENSITY_PX.action`);
      // 38 is its text-control height. Either way the point is that the phone's
      // 44px floor is released above `sm` and the shared token decides.
      expect(b.h, `Confirm is ${b.h}px at ${v}px — Rule 4's action density is 40px`)
        .toBeGreaterThanOrEqual(38);
      expect(b.h, `Confirm is still at the phone floor at ${v}px`).toBeLessThan(44.5);
    }
  });
});

/* ═══ 22 · THE-308's month view is untouched ═════════════════════════════ */

describe('22 · THE-308’s month view is untouched by this ticket', () => {
  it('🔴 EventMonthView and its own measured suite are byte-identical', () => {
    /**
     * THE-308 measures the month grid in Chromium at 380px and asserts EVERY day
     * cell clears 44px on both axes — the live no-regression, running in this
     * same suite run. What THIS ticket owes is proof that it did not move the
     * thing that suite measures: a second Chromium measuring the same grid would
     * be a copy of THE-308's assertion that could drift away from it.
     */
    expect(sha('src/components/events/EventMonthView.tsx')).toBe(
      '2dee2d960e56dd9a4f1afe51c4b321666632981d68c258a8688fae974c3a7961',
    );
    expect(sha('src/components/__tests__/THE-308.month-view.layout.test.tsx')).toBe(
      'ec28c012fdf569b3738e23dfefb96ef83c8aa36552709f7cfecabba70481dcc4',
    );
  });
});
